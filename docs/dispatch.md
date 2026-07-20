# Machine dispatch (the Qoffee-Maker replacement)

Quantina's **dispatch** layer forwards a serve to real hardware: a visitor
programs a circuit, presses serve, one shot is measured, and — if a booth wants
it — a machine acts on the result (a coffee brews, a webhook fires, a lamp
changes colour). This is the QN4 phase of [`quantina.md`](quantina.md) and the
native replacement for the standalone Qoffee-Maker Jupyter app.

Dispatch is **host-side only**: secrets (Home Connect client ids, tokens) never
reach a browser. It is also **off by the strongest default** — the log adapter,
disarmed — so a fresh booth actuates nothing until an operator both configures
an adapter and arms it.

## The three adapters

Pick one in `dispatch.toml` (below). All three resolve the item's **program**
payload for `outcomes[0]` (the first measured bitstring); for a `shots` serve
the remaining outcomes are display-only.

- **`log`** (default) — the universal dry-run. Logs the serve and the resolved
  program; actuates nothing. Use it to rehearse a booth end-to-end (serve →
  reveal on every screen) with zero hardware.
- **`webhook`** — POSTs the serve to a URL you control. The catch-all for
  cocktail robots, Home Assistant, GPIO bridges, smart lights, ice-cream
  machines — anything that speaks HTTP. Body:

  ```jsonc
  {
    "served":  { "type": "served", "seq": 7, "packId": "coffee",
                 "outcomes": ["010"], "shotSource": "ideal" },
    "program": { "key": "ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso",
                 "options": [{ "key": "…FillQuantity", "value": 50 }] }
  }
  ```

  `program` is `null` when the served item carries none (e.g. coffee's Tea).
  The POST has a 5-second timeout; any failure is logged and swallowed — a
  broken webhook never breaks the serve broadcast.
- **`homeconnect`** — the Qoffee path, mirroring quantum-mixer's working
  implementation: an OAuth authorization-code flow against the Home Connect
  API (the **simulator** by default), machine selection from the live appliance
  list, then power-on + `PUT /programs/active` with the item's program. See the
  walkthrough below.

## Safety rails

Every rail is on by default; none can be disabled from a browser.

- **Disarmed on start.** The armed state is in-memory only and starts `false`.
  It is *never* persisted, so a host restart always comes up disarmed.
- **Arming is per session.** An operator arms from the `/debug` Dispatch card.
  Arming sets a deadline `auto_disarm_minutes` ahead; the booth **auto-disarms**
  when idle past it. Each successful dispatch pushes the deadline out again, and
  Disarm clears it immediately.
- **Per-serve cooldown.** After an actuation the machine is in cooldown for
  `cooldown_seconds`; a serve inside that window is **skipped** ("machine
  busy") and recorded — never queued.
- **Everything is logged.** The last ~20 dispatches and skips (timestamp, pack,
  outcome, adapter, ok/reason) are kept in memory and shown on the Dispatch
  card.

## `dispatch.toml` reference

Drop it next to the other host config files (`branding.toml`, `layout.toml`,
`menu/`) in the config dir (default `~/.qamposer-physical/`). A missing or
invalid file falls back to the disarmed log adapter.

```toml
adapter = "log"                    # "log" (default) | "webhook" | "homeconnect"
cooldown_seconds = 30              # min seconds between actuations (default 30)
auto_disarm_minutes = 30           # idle auto-disarm (default 30)

[webhook]
url = "https://example.org/hook"   # required for the webhook adapter

[homeconnect]
client_id = "…"                    # Home Connect developer client id
client_secret = ""                 # optional (simulator flows work without it)
simulator = true                   # default true → simulator.home-connect.com
```

## Program payloads

The program is where a pack meets a machine. Built-in `coffee` items carry Home
Connect program keys (kept in `shared/menu/builtinPacks.ts`); a custom host pack
declares `[item.program]` in its `pack.toml` (see
[`menu-packs.md`](menu-packs.md)):

```toml
[[item]]
code = "010"
name = "Espresso"
[item.program]
key     = "ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso"
options = [{ key = "…FillQuantity", value = 50 }]
```

Resolution order for `served.packId` + `outcomes[0]`: a host custom pack's item
program wins; otherwise the built-in `coffee` table maps its 8 codes (Tea has
none). No program → the log adapter still logs and the webhook still posts
(`program: null`), but Home Connect skips (nothing to brew). Numeric option
values are coerced to `int` where the Home Connect API demands it.

## Home Connect walkthrough

1. **Developer account.** Register at
   [developer.home-connect.com](https://developer.home-connect.com), create an
   application, and note its **client id**. For a redirect URI, register your
   booth's callback: `https://<booth-host>:8443/api/dispatch/homeconnect/callback`.
   Start with the **simulator** — it needs no real appliance.
2. **Configure.** Set `adapter = "homeconnect"` and `[homeconnect] client_id`
   in `dispatch.toml`; leave `simulator = true`. Restart the host.
3. **Connect.** Open `/debug` (operator key), find the **Dispatch** card, and
   click **Connect Home Connect**. You are redirected to Home Connect's login;
   authorize, and the callback lands back on the booth ("connected — you can
   close this tab"). The token is stored at
   `<config_dir>/homeconnect_token.json`.
4. **Select the machine.** Back on the Dispatch card, click **List appliances**
   and **select** your coffee machine. The choice is saved next to the token so
   it survives a restart.
5. **Arm and serve.** Click **Arm**. Switch to `quantina` mode with the `coffee`
   pack, build a circuit, and serve from the Quantina card (or a provisioned
   kiosk's touch button). The measured outcome resolves to a program, the
   machine powers on, and the drink brews. The card's log shows each dispatch.
6. **Go live.** When the simulator loop works, set `simulator = false`, connect
   again against a real appliance, and repeat.

## Troubleshooting

- **"Serve does nothing."** The dispatcher is disarmed (the default, and after
  a restart or idle auto-disarm). Click **Arm**.
- **"machine busy (cooldown)" in the log.** A serve landed inside the cooldown
  window — expected; wait it out or lower `cooldown_seconds`.
- **Home Connect skips with "no program for outcome."** The served item has no
  `program` (e.g. coffee's Tea, or a custom item without `[item.program]`).
- **"no home connect token" / "no selected appliance."** Finish the Connect flow
  and select a machine on the Dispatch card.
- **Callback fails with `invalid_state`.** The OAuth `state` is single-use and
  in-memory; a stale/reused callback URL or a host restart between login and
  callback invalidates it. Start the Connect flow again.
- **Redirect URI mismatch at login.** The booth derives the callback from the
  request's base URL; register that exact origin (scheme, host, port) with your
  Home Connect application.
- **Webhook silence.** Failures are swallowed by design (never break a serve) —
  check the host log for the POST error and confirm `[webhook] url`.

## Security

`/api/dispatch/*` is operator-gated exactly like `/api/qr` (`?key=` or an
`X-Operator-Key` header; see [`protocol.md`](protocol.md)). The one exception is
the OAuth callback, which Home Connect calls without the operator key — it is
guarded instead by its single-use random `state` parameter. No API key or Home
Connect credential is ever entered in, or sent to, a browser.
