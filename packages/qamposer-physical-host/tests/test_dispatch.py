"""Machine dispatch (Quantina QN4): dispatcher safety rails, adapters, program
resolution, and the operator-gated ``/api/dispatch/*`` REST surface.

The dispatcher takes an injected clock (deterministic arming/cooldown) and an
injected httpx-like client (no network), so every path here is hermetic.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from conftest import FakePipeline
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.dispatch import (
    BUILTIN_COFFEE_PROGRAMS,
    DispatchConfig,
    Dispatcher,
    load_dispatch_config,
    resolve_program,
)
from qamposer_host.main import create_app


# --- test doubles ----------------------------------------------------------


class Clock:
    """A movable clock (``clock()`` returns the current ``t``)."""

    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


class FakeResponse:
    def __init__(self, status_code: int = 200, json_data: dict | None = None) -> None:
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}

    def json(self) -> dict:
        return self._json


class FakeHttpxClient:
    """Records every call; returns a canned response by (method, url-fragment)."""

    def __init__(self, responses: dict | None = None) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self._responses = responses or {}
        self.default = FakeResponse()

    def _pick(self, method: str, url: str) -> FakeResponse:
        for (m, frag), resp in self._responses.items():
            if m == method and frag in url:
                return resp
        return self.default

    async def post(self, url, **kwargs):
        self.calls.append(("POST", url, kwargs))
        return self._pick("POST", url)

    async def put(self, url, **kwargs):
        self.calls.append(("PUT", url, kwargs))
        return self._pick("PUT", url)

    async def get(self, url, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return self._pick("GET", url)


def _run(coro):
    return asyncio.run(coro)


def _served(pack_id="coffee", outcomes=("010",), shot_source="ideal") -> dict:
    return {"type": "served", "seq": 1, "packId": pack_id,
            "outcomes": list(outcomes), "shotSource": shot_source}


def _write_custom_pack(config_dir: Path, pack_id: str, toml: str) -> None:
    pack_dir = config_dir / "menu" / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    (pack_dir / "pack.toml").write_text(toml, encoding="utf-8")


# --- config loading --------------------------------------------------------


def test_missing_config_yields_log_defaults(tmp_path):
    cfg = load_dispatch_config(tmp_path / "nope.toml")
    assert cfg.adapter == "log"
    assert cfg.cooldown_seconds == 30.0
    assert cfg.auto_disarm_minutes == 30.0


def test_invalid_adapter_falls_back_to_log(tmp_path):
    p = tmp_path / "dispatch.toml"
    p.write_text('adapter = "teleporter"\ncooldown_seconds = 5\n', encoding="utf-8")
    cfg = load_dispatch_config(p)
    assert cfg.adapter == "log"
    assert cfg.cooldown_seconds == 5.0


def test_config_parses_webhook_and_homeconnect(tmp_path):
    p = tmp_path / "dispatch.toml"
    p.write_text(
        'adapter = "webhook"\n'
        '[webhook]\nurl = "https://hook.test/x"\n'
        '[homeconnect]\nclient_id = "cid"\nsimulator = false\n',
        encoding="utf-8",
    )
    cfg = load_dispatch_config(p)
    assert cfg.adapter == "webhook"
    assert cfg.webhook_url == "https://hook.test/x"
    assert cfg.hc_client_id == "cid"
    assert cfg.hc_simulator is False


# --- arming / cooldown safety rails ----------------------------------------


def test_disarmed_by_default_is_noop(tmp_path):
    d = Dispatcher(DispatchConfig(), tmp_path, clock=Clock())
    assert d.armed is False
    _run(d.on_served(_served()))
    assert d.status()["log"] == []  # nothing dispatched or recorded


def test_arm_and_auto_disarm_expiry(tmp_path):
    clock = Clock(1000.0)
    d = Dispatcher(DispatchConfig(auto_disarm_minutes=30), tmp_path, clock=clock)
    d.arm()
    assert d.armed
    clock.t = 1000.0 + 30 * 60 - 1
    assert d.armed
    clock.t = 1000.0 + 30 * 60 + 1
    assert not d.armed  # idle auto-disarm lapsed


def test_successful_dispatch_extends_armed_until(tmp_path):
    clock = Clock(1000.0)
    d = Dispatcher(DispatchConfig(auto_disarm_minutes=10), tmp_path, clock=clock)
    d.arm()
    first_deadline = d._armed_until
    clock.t = 1000.0 + 5 * 60
    _run(d.on_served(_served()))
    assert d._armed_until > first_deadline  # each serve pushes the deadline out


def test_log_adapter_records_entry(tmp_path):
    d = Dispatcher(DispatchConfig(), tmp_path, clock=Clock())
    d.arm()
    _run(d.on_served(_served(outcomes=["010"])))
    log = d.status()["log"]
    assert len(log) == 1
    assert log[0]["ok"] is True
    assert log[0]["adapter"] == "log"
    assert log[0]["outcome"] == "010"
    assert log[0]["packId"] == "coffee"


def test_cooldown_skip_recorded_and_clears(tmp_path):
    clock = Clock(1000.0)
    d = Dispatcher(DispatchConfig(cooldown_seconds=30), tmp_path, clock=clock)
    d.arm()
    _run(d.on_served(_served(outcomes=["010"])))  # ok → starts a 30s cooldown
    clock.t = 1000.0 + 10  # inside the window
    _run(d.on_served(_served(outcomes=["011"])))
    latest = d.status()["log"][0]  # most-recent first
    assert latest["ok"] is False
    assert latest["reason"] == "machine busy (cooldown)"
    clock.t = 1000.0 + 31  # window elapsed
    _run(d.on_served(_served(outcomes=["011"])))
    assert d.status()["log"][0]["ok"] is True


def test_multi_outcome_dispatches_first_only(tmp_path):
    fake = FakeHttpxClient()
    d = Dispatcher(
        DispatchConfig(adapter="webhook", webhook_url="https://hook.test/x"),
        tmp_path, client_getter=lambda: fake, clock=Clock(),
    )
    d.arm()
    _run(d.on_served(_served(outcomes=["010", "011", "100"])))
    # One dispatch; its program is the first outcome's (espresso).
    assert len(fake.calls) == 1
    assert fake.calls[0][2]["json"]["program"]["key"].endswith("Espresso")


# --- webhook adapter -------------------------------------------------------


def test_webhook_posts_expected_json(tmp_path):
    fake = FakeHttpxClient()
    d = Dispatcher(
        DispatchConfig(adapter="webhook", webhook_url="https://hook.test/x"),
        tmp_path, client_getter=lambda: fake, clock=Clock(),
    )
    d.arm()
    _run(d.on_served(_served(outcomes=["010"], shot_source="noisy")))
    assert len(fake.calls) == 1
    method, url, kwargs = fake.calls[0]
    assert method == "POST" and url == "https://hook.test/x"
    body = kwargs["json"]
    assert body["served"]["outcomes"] == ["010"]
    assert body["served"]["shotSource"] == "noisy"
    assert body["program"]["key"].endswith("Espresso")
    assert d.status()["log"][0]["ok"] is True


def test_webhook_failure_is_swallowed(tmp_path):
    class Boom(FakeHttpxClient):
        async def post(self, url, **kwargs):
            raise RuntimeError("network down")

    d = Dispatcher(
        DispatchConfig(adapter="webhook", webhook_url="https://hook.test/x"),
        tmp_path, client_getter=lambda: Boom(), clock=Clock(),
    )
    d.arm()
    _run(d.on_served(_served()))  # must not raise
    latest = d.status()["log"][0]
    assert latest["ok"] is False
    assert "failed" in latest["reason"]


def test_webhook_program_null_when_none(tmp_path):
    fake = FakeHttpxClient()
    d = Dispatcher(
        DispatchConfig(adapter="webhook", webhook_url="https://hook.test/x"),
        tmp_path, client_getter=lambda: fake, clock=Clock(),
    )
    d.arm()
    _run(d.on_served(_served(outcomes=["000"])))  # Tea → no program
    assert fake.calls[0][2]["json"]["program"] is None


# --- homeconnect adapter ---------------------------------------------------


def _hc_config(**over) -> DispatchConfig:
    base = dict(adapter="homeconnect", hc_client_id="cid", hc_simulator=True)
    base.update(over)
    return DispatchConfig(**base)


def test_homeconnect_exchange_stores_token(tmp_path):
    fake = FakeHttpxClient(responses={
        ("POST", "oauth/token"): FakeResponse(200, {
            "access_token": "AT", "refresh_token": "RT", "expires_in": 3600,
        }),
    })
    d = Dispatcher(_hc_config(), tmp_path, client_getter=lambda: fake, clock=Clock())
    ok = _run(d.homeconnect.exchange_code("code123", "https://host/cb"))
    assert ok
    assert (tmp_path / "homeconnect_token.json").is_file()
    assert d.status()["hasToken"] is True


def test_homeconnect_dispatch_powers_on_then_starts_program(tmp_path):
    fake = FakeHttpxClient()  # default 200 for every PUT
    clock = Clock()
    d = Dispatcher(_hc_config(), tmp_path, client_getter=lambda: fake, clock=clock)
    d.homeconnect._save_token({"access_token": "AT", "expires_in": 3600})
    d.homeconnect.select_appliance("HA-1", "Barista")
    d.arm()
    _run(d.on_served(_served(outcomes=["010"])))  # espresso
    puts = [c for c in fake.calls if c[0] == "PUT"]
    assert len(puts) == 2
    assert "BSH.Common.Setting.PowerState" in puts[0][1]  # power first
    assert puts[1][1].endswith("/programs/active")
    data = puts[1][2]["json"]["data"]
    assert data["key"].endswith("Espresso")
    assert data["options"][0]["value"] == 50
    assert d.status()["log"][0]["ok"] is True


def test_homeconnect_coerces_string_option_to_int(tmp_path):
    # A custom host pack whose option value is a TOML string "50" → coerced to int.
    _write_custom_pack(tmp_path, "bistro", (
        'id = "bistro"\ntitle = "Le Bistro"\n'
        '[[item]]\ncode = "0"\nname = "Ristretto"\n'
        '[item.program]\nkey = "X.Ristretto"\n'
        'options = [{ key = "FillQuantity", value = "50" }]\n'
    ))
    fake = FakeHttpxClient()
    d = Dispatcher(_hc_config(), tmp_path, client_getter=lambda: fake, clock=Clock())
    d.homeconnect._save_token({"access_token": "AT", "expires_in": 3600})
    d.homeconnect.select_appliance("HA-1")
    d.arm()
    _run(d.on_served(_served(pack_id="bistro", outcomes=["0"])))
    prog_put = [c for c in fake.calls if c[0] == "PUT" and c[1].endswith("/programs/active")][0]
    value = prog_put[2]["json"]["data"]["options"][0]["value"]
    assert value == 50 and isinstance(value, int)


def test_homeconnect_no_token_skips(tmp_path):
    fake = FakeHttpxClient()
    d = Dispatcher(_hc_config(), tmp_path, client_getter=lambda: fake, clock=Clock())
    d.homeconnect.select_appliance("HA-1")
    d.arm()
    _run(d.on_served(_served(outcomes=["010"])))
    assert d.status()["log"][0]["reason"] == "no home connect token"
    assert not any(c[0] == "PUT" for c in fake.calls)


def test_homeconnect_no_appliance_skips(tmp_path):
    fake = FakeHttpxClient()
    d = Dispatcher(_hc_config(), tmp_path, client_getter=lambda: fake, clock=Clock())
    d.homeconnect._save_token({"access_token": "AT", "expires_in": 3600})
    d.arm()
    _run(d.on_served(_served(outcomes=["010"])))
    assert d.status()["log"][0]["reason"] == "no selected appliance"


def test_homeconnect_appliances_list(tmp_path):
    fake = FakeHttpxClient(responses={
        ("GET", "/api/homeappliances"): FakeResponse(200, {"data": {"homeappliances": [
            {"haId": "HA-1", "name": "Kitchen", "type": "CoffeeMaker"},
        ]}}),
    })
    d = Dispatcher(_hc_config(), tmp_path, client_getter=lambda: fake, clock=Clock())
    d.homeconnect._save_token({"access_token": "AT", "expires_in": 3600})
    appliances = _run(d.homeconnect.appliances())
    assert appliances == [{"id": "HA-1", "name": "Kitchen", "type": "CoffeeMaker"}]


# --- program resolution ----------------------------------------------------


def test_resolve_builtin_coffee_table(tmp_path):
    esp = resolve_program(tmp_path, "coffee", "010")
    assert esp["key"].endswith("Espresso")
    assert esp["options"][0]["value"] == 50
    assert resolve_program(tmp_path, "coffee", "000") is None  # Tea has none
    # A non-coffee built-in with no host pack has no program.
    assert resolve_program(tmp_path, "cocktails", "000") is None
    # Table sanity: 7 of 8 codes have a program.
    assert len(BUILTIN_COFFEE_PROGRAMS) == 7


def test_resolve_custom_host_pack_item(tmp_path):
    _write_custom_pack(tmp_path, "bistro", (
        'id = "bistro"\ntitle = "Le Bistro"\n'
        '[[item]]\ncode = "0"\nname = "Ristretto"\n'
        '[item.program]\nkey = "X.Ristretto"\n'
        '[[item]]\ncode = "1"\nname = "Plain"\n'  # no program
    ))
    assert resolve_program(tmp_path, "bistro", "0")["key"] == "X.Ristretto"
    assert resolve_program(tmp_path, "bistro", "1") is None  # item without program
    assert resolve_program(tmp_path, "bistro", "9") is None  # no such code


# --- REST surface ----------------------------------------------------------


def _app(tmp_path, dispatcher=None):
    config = HostConfig.from_env(source="replay:none", backend="off",
                                 config_dir=str(tmp_path))
    app = create_app(config, pipeline=FakePipeline())
    if dispatcher is not None:
        app.state.dispatcher = dispatcher
    return app


def test_rest_status_gated_by_operator_key(tmp_path):
    app = _app(tmp_path)
    token = app.state.operator_token
    with TestClient(app) as client:
        assert client.get("/api/dispatch").status_code == 403
        assert client.get("/api/dispatch", params={"key": token}).status_code == 200
        assert client.get("/api/dispatch",
                          headers={"X-Operator-Key": token}).status_code == 200


def test_rest_arm_disarm(tmp_path):
    app = _app(tmp_path)
    token = app.state.operator_token
    with TestClient(app) as client:
        assert client.post("/api/dispatch/arm").status_code == 403  # gated
        armed = client.post("/api/dispatch/arm", params={"key": token}).json()
        assert armed["armed"] is True and armed["armedUntil"] is not None
        disarmed = client.post("/api/dispatch/disarm", params={"key": token}).json()
        assert disarmed["armed"] is False and disarmed["armedUntil"] is None


def test_rest_callback_state_validation(tmp_path):
    fake = FakeHttpxClient(responses={
        ("POST", "oauth/token"): FakeResponse(200, {"access_token": "AT", "expires_in": 3600}),
    })
    dispatcher = Dispatcher(_hc_config(), tmp_path,
                            client_getter=lambda: fake, clock=Clock())
    app = _app(tmp_path, dispatcher=dispatcher)
    with TestClient(app) as client:
        # Unknown state → 400 (no exchange).
        assert client.get("/api/dispatch/homeconnect/callback",
                          params={"code": "c", "state": "nope"}).status_code == 400
        # A minted state works once…
        state = dispatcher.new_state()
        ok = client.get("/api/dispatch/homeconnect/callback",
                        params={"code": "c", "state": state})
        assert ok.status_code == 200 and "connected" in ok.text.lower()
        # …and is single-use: reusing it is a 400.
        assert client.get("/api/dispatch/homeconnect/callback",
                          params={"code": "c", "state": state}).status_code == 400


def test_rest_select_persists_appliance(tmp_path):
    app = _app(tmp_path)
    token = app.state.operator_token
    with TestClient(app) as client:
        assert client.post("/api/dispatch/homeconnect/select",
                           json={"haId": "HA-9"}).status_code == 403  # gated
        r = client.post("/api/dispatch/homeconnect/select", params={"key": token},
                        json={"haId": "HA-9", "name": "Barista"})
        assert r.status_code == 200
        assert r.json()["appliance"] == {"haId": "HA-9", "name": "Barista"}
        assert (tmp_path / "homeconnect_appliance.json").is_file()
        # A later status still reflects the persisted selection.
        status = client.get("/api/dispatch", params={"key": token}).json()
        assert status["appliance"]["haId"] == "HA-9"


def test_rest_login_redirects_to_auth_url(tmp_path):
    dispatcher = Dispatcher(_hc_config(), tmp_path,
                            client_getter=lambda: FakeHttpxClient(), clock=Clock())
    app = _app(tmp_path, dispatcher=dispatcher)
    token = app.state.operator_token
    with TestClient(app) as client:
        r = client.get("/api/dispatch/homeconnect/login", params={"key": token},
                       follow_redirects=False)
        assert r.status_code == 307
        loc = r.headers["location"]
        assert loc.startswith("https://simulator.home-connect.com/security/oauth/authorize")
        assert "client_id=cid" in loc and "state=" in loc


def test_serve_over_ws_reaches_armed_dispatcher(tmp_path):
    """End-to-end: an operator serve drives the wired dispatcher's log."""
    from conftest import authenticate_operator

    app = _app(tmp_path)
    with TestClient(app) as client:
        app.state.dispatcher.arm()  # in-memory arm for this test
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_menu", "pack": "coffee"})
            for _ in range(5):
                if ws.receive_json().get("type") == "layout":
                    break
            ws.send_json({"type": "serve", "outcomes": ["010"], "shotSource": "ideal"})
            for _ in range(5):
                if ws.receive_json().get("type") == "served":
                    break
    log = app.state.dispatcher.status()["log"]
    assert log and log[0]["outcome"] == "010" and log[0]["ok"] is True
