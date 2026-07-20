"""Machine dispatch — the Qoffee-Maker replacement (Quantina phase QN4).

A *dispatcher* forwards a Quantina ``served`` event (docs/quantina.md, "Machine
dispatch") to real hardware through a pluggable adapter. Secrets never reach the
browser: everything here is host-side.

Three adapters, selected in ``dispatch.toml`` next to the other host config
(``branding.toml`` / ``layout.toml`` / ``menu/``):

* ``log`` (default) — the universal dry-run: logs the serve + resolved program,
  actuates nothing.
* ``webhook`` — POSTs ``{served, program|null}`` to a configured URL (cocktail
  robots, Home Assistant, GPIO bridges, …).
* ``homeconnect`` — the Qoffee path: OAuth authorization-code flow against the
  Home Connect API (simulator by default), power the machine on, then
  ``PUT /programs/active`` with the item's program key + options. Mirrors
  quantum-mixer's working implementation
  (``quantum_mixer_backend/usecases/qoffee/usecase.py``).

Safety rails (docs/quantina.md):

* **Disarmed by default.** The armed state is IN-MEMORY ONLY and starts
  ``False`` — never persisted — so a host restart always comes up disarmed.
* Arming is per session: :meth:`Dispatcher.arm` sets an ``armed_until`` deadline
  ``auto_disarm_minutes`` ahead; each successful dispatch pushes it out again;
  it lapses on its own (idle auto-disarm) and :meth:`Dispatcher.disarm` clears
  it at once.
* Per-serve **cooldown**: a serve inside the cooldown window is SKIPPED (logged
  "machine busy", recorded) — never queued.
* Every dispatch or skip is appended to a small in-memory ring log.

REST endpoints (``/api/dispatch/*``) are operator-gated exactly like ``/api/qr``
(the shared :func:`require_operator_key` helper); the OAuth callback is instead
guarded by its single-use random ``state`` parameter (docs/protocol.md).
"""

from __future__ import annotations

import json
import logging
import secrets
import time
import tomllib
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from .menu import load_pack
from .preview import require_operator_key

logger = logging.getLogger("qamposer_host.dispatch")

router = APIRouter()

# --- built-in coffee programs (provenance: shared/menu/builtinPacks.ts) -----
#
# The 8 QoffeeMaker codes mapped to their Home Connect program payloads, kept
# byte-for-byte in step with the ``coffee`` pack in shared/menu/builtinPacks.ts
# (the migrated quantum-mixer usecase). ``000`` (Tea) had the YAML key
# ``NotImplemented`` and so carries no program — it is simply absent here.
_CM = "ConsumerProducts.CoffeeMaker.Program"
_FILL_QUANTITY = "ConsumerProducts.CoffeeMaker.Option.FillQuantity"

BUILTIN_COFFEE_PROGRAMS: dict[str, dict] = {
    "001": {"key": f"{_CM}.Beverage.MilkFroth"},
    "010": {"key": f"{_CM}.Beverage.Espresso",
            "options": [{"key": _FILL_QUANTITY, "value": 50}]},
    "011": {"key": f"{_CM}.Beverage.Coffee"},
    "100": {"key": f"{_CM}.Beverage.Cappuccino"},
    "101": {"key": f"{_CM}.Beverage.LatteMacchiato"},
    "110": {"key": f"{_CM}.CoffeeWorld.WienerMelange"},
    "111": {"key": f"{_CM}.CoffeeWorld.Americano"},
}

#: Home Connect OAuth scopes (quantum-mixer parity).
_HC_SCOPE = "IdentifyAppliance CoffeeMaker"
#: Content type the Home Connect API expects on writes.
_HC_CONTENT_TYPE = "application/vnd.bsh.sdk.v1+json"
_HC_TOKEN_FILE = "homeconnect_token.json"
_HC_APPLIANCE_FILE = "homeconnect_appliance.json"

VALID_ADAPTERS = ("log", "webhook", "homeconnect")

#: Ring-log capacity (recent dispatches/skips shown on the /debug card).
_LOG_CAPACITY = 20


# --- config ----------------------------------------------------------------


@dataclass
class DispatchConfig:
    """Parsed ``dispatch.toml`` (all fields have safe defaults)."""

    adapter: str = "log"
    cooldown_seconds: float = 30.0
    auto_disarm_minutes: float = 30.0
    webhook_url: str | None = None
    hc_client_id: str = ""
    hc_client_secret: str = ""
    hc_simulator: bool = True


def load_dispatch_config(path: Path | str | None) -> DispatchConfig:
    """Load ``dispatch.toml``; a missing/invalid/odd file yields log defaults.

    Never raises: dispatch must always come up in a safe (log-only) state, so any
    read/parse problem is logged and the disarmed log adapter takes over.
    """
    cfg = DispatchConfig()
    if path is None:
        return cfg
    path = Path(path)
    if not path.is_file():
        return cfg
    try:
        with path.open("rb") as fh:
            data = tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError):
        logger.warning("could not read dispatch config %s; using log defaults",
                       path, exc_info=True)
        return cfg

    adapter = data.get("adapter")
    if isinstance(adapter, str) and adapter in VALID_ADAPTERS:
        cfg.adapter = adapter
    elif adapter is not None:
        logger.warning("unknown dispatch adapter %r; using %r", adapter, cfg.adapter)

    cooldown = data.get("cooldown_seconds")
    if isinstance(cooldown, (int, float)) and cooldown >= 0:
        cfg.cooldown_seconds = float(cooldown)
    auto = data.get("auto_disarm_minutes")
    if isinstance(auto, (int, float)) and auto > 0:
        cfg.auto_disarm_minutes = float(auto)

    webhook = data.get("webhook")
    if isinstance(webhook, dict) and isinstance(webhook.get("url"), str):
        cfg.webhook_url = webhook["url"] or None

    hc = data.get("homeconnect")
    if isinstance(hc, dict):
        if isinstance(hc.get("client_id"), str):
            cfg.hc_client_id = hc["client_id"]
        if isinstance(hc.get("client_secret"), str):
            cfg.hc_client_secret = hc["client_secret"]
        if isinstance(hc.get("simulator"), bool):
            cfg.hc_simulator = hc["simulator"]
    return cfg


# --- program resolution -----------------------------------------------------


def resolve_program(config_dir: Path | str, pack_id: str | None,
                    outcome: str | None) -> dict | None:
    """Resolve the Home-Connect-shaped ``program`` for ``pack_id`` + ``outcome``.

    A host custom pack wins: its ``menu/<pack_id>/pack.toml`` item whose ``code``
    equals ``outcome`` supplies the program. Otherwise the built-in ``coffee``
    pack maps the 8 codes via :data:`BUILTIN_COFFEE_PROGRAMS`. Anything else (or
    an item without a program) yields ``None``.
    """
    if not pack_id or not outcome:
        return None
    pack_dir = Path(config_dir) / "menu" / pack_id
    if pack_dir.is_dir():
        pack = load_pack(pack_dir)
        if pack is not None:
            for item in pack.get("items", []):
                if isinstance(item, dict) and item.get("code") == outcome:
                    prog = item.get("program")
                    return prog if isinstance(prog, dict) else None
            return None
    if pack_id == "coffee":
        return BUILTIN_COFFEE_PROGRAMS.get(outcome)
    return None


def _coerce_option_value(value: Any) -> Any:
    """Coerce a numeric option value to ``int`` (the Home Connect API rejects
    numeric strings/floats). Non-numeric values pass through unchanged."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return value


# --- adapters ---------------------------------------------------------------


class LogAdapter:
    """The universal dry-run: log the serve + resolved program, actuate nothing."""

    name = "log"

    async def dispatch(self, served: dict, program: dict | None) -> tuple[bool, str | None]:
        logger.info("dispatch(log): served=%s program=%s", served, program)
        return True, None


class WebhookAdapter:
    """POST ``{served, program|null}`` to a configured URL (5s timeout)."""

    name = "webhook"

    def __init__(self, url: str | None, client_getter: Callable[[], Any]):
        self._url = url
        self._client_getter = client_getter

    async def dispatch(self, served: dict, program: dict | None) -> tuple[bool, str | None]:
        if not self._url:
            logger.warning("dispatch(webhook): no url configured; skipping")
            return False, "no webhook url configured"
        client = self._client_getter()
        if client is None:
            return False, "no http client"
        try:
            resp = await client.post(
                self._url, json={"served": served, "program": program}, timeout=5.0
            )
            status = getattr(resp, "status_code", 0)
            if status >= 300:
                logger.warning("dispatch(webhook): %s -> HTTP %s", self._url, status)
                return False, f"webhook HTTP {status}"
            return True, None
        except Exception:  # never raise into the serve broadcast
            logger.warning("dispatch(webhook): POST %s failed", self._url, exc_info=True)
            return False, "webhook post failed"


class HomeConnectClient:
    """Home Connect OAuth + program dispatch (quantum-mixer parity).

    Doubles as the ``homeconnect`` dispatch adapter *and* the helper the
    ``/api/dispatch/homeconnect/*`` REST endpoints drive. Token JSON is persisted
    at ``<config_dir>/homeconnect_token.json`` and the selected appliance at
    ``<config_dir>/homeconnect_appliance.json`` (so both survive a restart).
    """

    name = "homeconnect"

    def __init__(self, config: DispatchConfig, config_dir: Path | str,
                 client_getter: Callable[[], Any], clock: Callable[[], float]):
        self._config = config
        self._config_dir = Path(config_dir)
        self._client_getter = client_getter
        self._clock = clock

    # -- endpoints / paths -------------------------------------------------

    @property
    def base(self) -> str:
        return ("https://simulator.home-connect.com" if self._config.hc_simulator
                else "https://api.home-connect.com")

    @property
    def _token_path(self) -> Path:
        return self._config_dir / _HC_TOKEN_FILE

    @property
    def _appliance_path(self) -> Path:
        return self._config_dir / _HC_APPLIANCE_FILE

    # -- token persistence -------------------------------------------------

    def _load_token(self) -> dict | None:
        try:
            with self._token_path.open("rb") as fh:
                token = json.load(fh)
        except (OSError, ValueError):
            return None
        return token if isinstance(token, dict) and token.get("access_token") else None

    def _save_token(self, token: dict) -> None:
        token = dict(token)
        token["obtained_at"] = self._clock()
        self._config_dir.mkdir(parents=True, exist_ok=True)
        self._token_path.write_text(json.dumps(token), encoding="utf-8")

    def has_token(self) -> bool:
        return self._load_token() is not None

    # -- appliance selection ----------------------------------------------

    def select_appliance(self, ha_id: str, name: str | None = None) -> dict:
        entry = {"haId": ha_id, "name": name or ha_id}
        self._config_dir.mkdir(parents=True, exist_ok=True)
        self._appliance_path.write_text(json.dumps(entry), encoding="utf-8")
        return entry

    def selected_appliance(self) -> dict | None:
        try:
            with self._appliance_path.open("rb") as fh:
                entry = json.load(fh)
        except (OSError, ValueError):
            return None
        return entry if isinstance(entry, dict) and entry.get("haId") else None

    # -- OAuth -------------------------------------------------------------

    def login_url(self, redirect_uri: str, state: str) -> str:
        params = urlencode({
            "client_id": self._config.hc_client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": _HC_SCOPE,
            "state": state,
        })
        return f"{self.base}/security/oauth/authorize?{params}"

    async def exchange_code(self, code: str, redirect_uri: str) -> bool:
        """Exchange an authorization ``code`` for a token and persist it."""
        client = self._client_getter()
        if client is None:
            return False
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": self._config.hc_client_id,
            "redirect_uri": redirect_uri,
        }
        if self._config.hc_client_secret:
            data["client_secret"] = self._config.hc_client_secret
        try:
            resp = await client.post(f"{self.base}/security/oauth/token", data=data)
            if getattr(resp, "status_code", 0) >= 300:
                logger.warning("home connect token exchange -> HTTP %s",
                               resp.status_code)
                return False
            token = resp.json()
        except Exception:
            logger.warning("home connect token exchange failed", exc_info=True)
            return False
        if not isinstance(token, dict) or not token.get("access_token"):
            return False
        self._save_token(token)
        return True

    async def _access_token(self) -> str | None:
        """Return a usable access token, refreshing an expired one when possible."""
        token = self._load_token()
        if token is None:
            return None
        expires_in = token.get("expires_in")
        obtained = token.get("obtained_at", 0)
        refresh = token.get("refresh_token")
        if (isinstance(expires_in, (int, float)) and refresh
                and self._clock() > obtained + expires_in - 60):
            refreshed = await self._refresh(refresh)
            if refreshed is not None:
                token = refreshed
        return token.get("access_token")

    async def _refresh(self, refresh_token: str) -> dict | None:
        client = self._client_getter()
        if client is None:
            return None
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": self._config.hc_client_id,
        }
        if self._config.hc_client_secret:
            data["client_secret"] = self._config.hc_client_secret
        try:
            resp = await client.post(f"{self.base}/security/oauth/token", data=data)
            if getattr(resp, "status_code", 0) >= 300:
                return None
            token = resp.json()
        except Exception:
            logger.warning("home connect token refresh failed", exc_info=True)
            return None
        if isinstance(token, dict) and token.get("access_token"):
            # Carry the refresh token forward if the response omits it.
            token.setdefault("refresh_token", refresh_token)
            self._save_token(token)
            return token
        return None

    def _auth_headers(self, token: str) -> dict:
        return {
            "Authorization": f"Bearer {token}",
            "Accept": _HC_CONTENT_TYPE,
            "Content-Type": _HC_CONTENT_TYPE,
        }

    async def appliances(self) -> list[dict]:
        """Live appliance list (``[{id, name, type}]``); ``[]`` when no token."""
        token = await self._access_token()
        if token is None:
            return []
        client = self._client_getter()
        if client is None:
            return []
        try:
            resp = await client.get(f"{self.base}/api/homeappliances",
                                    headers=self._auth_headers(token))
            if getattr(resp, "status_code", 0) >= 300:
                return []
            body = resp.json()
        except Exception:
            logger.warning("home connect appliance list failed", exc_info=True)
            return []
        appliances = (body or {}).get("data", {}).get("homeappliances", [])
        return [
            {"id": a.get("haId"), "name": a.get("name"), "type": a.get("type")}
            for a in appliances if isinstance(a, dict)
        ]

    async def _ensure_power(self, token: str, ha_id: str) -> None:
        """Best-effort power-on (failures tolerated — some machines reject it)."""
        client = self._client_getter()
        if client is None:
            return
        body = {"data": {"key": "BSH.Common.Setting.PowerState",
                         "value": "BSH.Common.EnumType.PowerState.On"}}
        try:
            await client.put(
                f"{self.base}/api/homeappliances/{ha_id}/settings/BSH.Common.Setting.PowerState",
                json=body, headers=self._auth_headers(token),
            )
        except Exception:
            logger.debug("home connect power-on failed (tolerated)", exc_info=True)

    async def _start_program(self, token: str, ha_id: str, program: dict) -> bool:
        client = self._client_getter()
        if client is None:
            return False
        options = [
            {"key": o.get("key"), "value": _coerce_option_value(o.get("value"))}
            for o in program.get("options", []) if isinstance(o, dict)
        ]
        body = {"data": {"key": program["key"], "options": options}}
        try:
            resp = await client.put(
                f"{self.base}/api/homeappliances/{ha_id}/programs/active",
                json=body, headers=self._auth_headers(token),
            )
        except Exception:
            logger.warning("home connect start program failed", exc_info=True)
            return False
        return getattr(resp, "status_code", 0) < 300

    async def dispatch(self, served: dict, program: dict | None) -> tuple[bool, str | None]:
        appliance = self.selected_appliance()
        if appliance is None:
            return False, "no selected appliance"
        if program is None:
            return False, "no program for outcome"
        token = await self._access_token()
        if token is None:
            return False, "no home connect token"
        ha_id = appliance["haId"]
        await self._ensure_power(token, ha_id)
        ok = await self._start_program(token, ha_id, program)
        return (True, None) if ok else (False, "start program failed")


# --- dispatcher -------------------------------------------------------------


@dataclass
class LogEntry:
    ts: float
    packId: str | None
    outcome: str | None
    adapter: str
    ok: bool
    reason: str | None = None

    def to_dict(self) -> dict:
        return {
            "ts": self.ts, "packId": self.packId, "outcome": self.outcome,
            "adapter": self.adapter, "ok": self.ok, "reason": self.reason,
        }


class Dispatcher:
    """Owns the armed/cooldown state, the ring log, and the active adapter.

    The armed state is IN-MEMORY ONLY and starts ``False`` — it is never
    persisted, so a host restart always comes up disarmed (the QN4 safety rail).
    The ``clock`` callable (default :func:`time.time`) is injected so tests can
    drive arming/cooldown deterministically.
    """

    def __init__(self, config: DispatchConfig, config_dir: Path | str, *,
                 client_getter: Callable[[], Any] | None = None,
                 clock: Callable[[], float] = time.time):
        self.config = config
        self.config_dir = Path(config_dir)
        self._clock = clock
        self._client_getter = client_getter or (lambda: None)
        self._armed_until = 0.0        # in-memory only; starts disarmed
        self._cooldown_until = 0.0
        self._log: deque[LogEntry] = deque(maxlen=_LOG_CAPACITY)
        self._states: set[str] = set()  # single-use OAuth `state` values
        self.homeconnect = HomeConnectClient(
            config, self.config_dir, self._client_getter, clock
        )
        self.adapter = self._build_adapter()

    def _build_adapter(self):
        if self.config.adapter == "webhook":
            return WebhookAdapter(self.config.webhook_url, self._client_getter)
        if self.config.adapter == "homeconnect":
            return self.homeconnect
        return LogAdapter()

    # -- arming ------------------------------------------------------------

    def arm(self) -> None:
        self._armed_until = self._clock() + self.config.auto_disarm_minutes * 60

    def disarm(self) -> None:
        self._armed_until = 0.0

    @property
    def armed(self) -> bool:
        return self._clock() < self._armed_until

    # -- OAuth state (single-use) -----------------------------------------

    def new_state(self) -> str:
        state = secrets.token_urlsafe(16)
        self._states.add(state)
        return state

    def consume_state(self, state: str | None) -> bool:
        """Validate + burn a ``state`` value (single-use). False when unknown."""
        if not isinstance(state, str) or state not in self._states:
            return False
        self._states.discard(state)
        return True

    # -- serve → dispatch --------------------------------------------------

    async def on_served(self, served: dict) -> None:
        """Dispatch ``served`` through the adapter — a no-op unless armed.

        Resolves the program for ``outcomes[0]`` only; for a multi-outcome
        (shots) serve the remaining outcomes are display-only (logged). A serve
        inside the cooldown window is skipped ("machine busy") and recorded — it
        is never queued.
        """
        if not self.armed:
            return
        now = self._clock()
        outcomes = served.get("outcomes") or []
        outcome = outcomes[0] if outcomes else None
        pack_id = served.get("packId")

        if now < self._cooldown_until:
            logger.info("dispatch skipped: machine busy (cooldown) for %s/%s",
                        pack_id, outcome)
            self._record(pack_id, outcome, ok=False, reason="machine busy (cooldown)")
            return

        if len(outcomes) > 1:
            logger.info("dispatch: outcomes[1:] are display-only (%d extra)",
                        len(outcomes) - 1)

        program = resolve_program(self.config_dir, pack_id, outcome)
        try:
            ok, reason = await self.adapter.dispatch(served, program)
        except Exception:  # defensive: an adapter must never break the serve
            logger.warning("dispatch adapter raised; treated as failure", exc_info=True)
            ok, reason = False, "adapter error"

        self._record(pack_id, outcome, ok=ok, reason=reason)
        if ok:
            # An actuation starts the cooldown and refreshes the arm deadline.
            self._cooldown_until = now + self.config.cooldown_seconds
            self._armed_until = now + self.config.auto_disarm_minutes * 60

    def _record(self, pack_id, outcome, *, ok, reason=None) -> None:
        self._log.append(LogEntry(
            ts=self._clock(), packId=pack_id, outcome=outcome,
            adapter=self.config.adapter, ok=ok, reason=reason,
        ))

    # -- status ------------------------------------------------------------

    def status(self) -> dict:
        now = self._clock()
        armed = now < self._armed_until
        cooling = now < self._cooldown_until
        return {
            "adapter": self.config.adapter,
            "armed": armed,
            "armedUntil": self._armed_until if armed else None,
            "cooldownUntil": self._cooldown_until if cooling else None,
            "appliance": self.homeconnect.selected_appliance(),
            "hasToken": self.homeconnect.has_token(),
            "log": [e.to_dict() for e in reversed(self._log)],
        }


def _dispatcher(request: Request) -> Dispatcher:
    dispatcher = getattr(request.app.state, "dispatcher", None)
    if dispatcher is None:  # pragma: no cover - always wired in create_app
        raise HTTPException(status_code=503, detail={"error": "dispatch_unavailable"})
    return dispatcher


def _callback_uri(request: Request) -> str:
    """The OAuth redirect URI: this host's base + the callback path."""
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/dispatch/homeconnect/callback"


# --- REST endpoints ---------------------------------------------------------


@router.get("/api/dispatch")
async def get_dispatch(request: Request) -> dict:
    require_operator_key(request)
    return _dispatcher(request).status()


@router.post("/api/dispatch/arm")
async def arm(request: Request) -> dict:
    require_operator_key(request)
    dispatcher = _dispatcher(request)
    dispatcher.arm()
    return dispatcher.status()


@router.post("/api/dispatch/disarm")
async def disarm(request: Request) -> dict:
    require_operator_key(request)
    dispatcher = _dispatcher(request)
    dispatcher.disarm()
    return dispatcher.status()


@router.get("/api/dispatch/homeconnect/login")
async def homeconnect_login(request: Request) -> RedirectResponse:
    require_operator_key(request)
    dispatcher = _dispatcher(request)
    state = dispatcher.new_state()
    url = dispatcher.homeconnect.login_url(_callback_uri(request), state)
    return RedirectResponse(url, status_code=307)


@router.get("/api/dispatch/homeconnect/callback")
async def homeconnect_callback(request: Request, code: str = "", state: str = "") -> HTMLResponse:
    # Guarded by the single-use `state` param (NOT the operator key — Home
    # Connect redirects here without it). A wrong/reused state is a 400.
    dispatcher = _dispatcher(request)
    if not dispatcher.consume_state(state):
        raise HTTPException(status_code=400, detail={"error": "invalid_state"})
    ok = await dispatcher.homeconnect.exchange_code(code, _callback_uri(request))
    if not ok:
        return HTMLResponse(
            "<h1>Home Connect</h1><p>Could not complete the connection. "
            "Check the client id / secret and try again.</p>", status_code=502)
    return HTMLResponse(
        "<h1>Home Connect connected</h1>"
        "<p>You can close this tab and return to /debug.</p>")


@router.get("/api/dispatch/homeconnect/appliances")
async def homeconnect_appliances(request: Request) -> dict:
    require_operator_key(request)
    dispatcher = _dispatcher(request)
    return {"appliances": await dispatcher.homeconnect.appliances()}


@router.post("/api/dispatch/homeconnect/select")
async def homeconnect_select(request: Request) -> dict:
    require_operator_key(request)
    dispatcher = _dispatcher(request)
    try:
        body = await request.json()
    except Exception:
        body = None
    ha_id = body.get("haId") if isinstance(body, dict) else None
    if not isinstance(ha_id, str) or not ha_id:
        raise HTTPException(status_code=400, detail={"error": "haId_required"})
    name = body.get("name") if isinstance(body, dict) else None
    dispatcher.homeconnect.select_appliance(ha_id, name if isinstance(name, str) else None)
    return dispatcher.status()
