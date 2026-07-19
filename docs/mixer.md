# Quantum Mixer — the unified Qoffee-Maker / quantum-mixer successor (task #35)

> Status: PLANNED (this document is the approved-pending-review plan; no code
> yet). Phases MX0–MX5 below. Per Jan 2026-07-19: replace qoffee-maker and
> quantum-mixer with native Entangible functionality; **start with mixer**
> (display-only serving — cocktails/ice cream/juice), machine control (the
> Qoffee coffee-machine path) follows as a later phase.

## Why

[Qoffee-Maker](https://qoffee-maker.org) and quantum-mixer share one idea:
**order something by programming a quantum computer.** N menu items are encoded
as the binary measurement outcomes of ⌈log₂ N⌉ qubits (Qoffee: 8 beverages ↔
3 qubits, `000`…`111`); the visitor builds a circuit until the histogram peaks
on the item they want, presses a button, ONE shot is measured, and the item that
comes out is served — by a Home-Connect coffee machine in Qoffee's case, by a
human mixing the cocktail/ice cream in the mixer case. The uncertainty is the
lesson: if your state isn't sharp, you get *a* drink, not *your* drink.

Both are standalone stacks (Jupyter/voila + custom frontends) maintained apart
from Entangible. Entangible already has everything expensive: circuit input
(tiles + camera, manual on-screen editing via `ManualEditSource`, replay),
ideal + noisy simulation in the browser, a shared histogram, kiosk/viewer/
camera/operator roles with WS state sync, a branding slot, attract mode, and
the take-it-home Composer transfer. What's missing is a thin layer: a menu
overlay, a one-shot "serve" event, a config format, and (later) machine
dispatch. So the successor is a **mode of Entangible One**, not a new app —
one more entry in the existing mode system, exactly like `golf`.

## Concept

- A **menu pack** (config package) defines a scenario: coffee, ice cream,
  cocktails, juice, anything — its items, pictures, branding, and (optionally)
  machine programs. Packs are data, not code; events/users make their own.
- A pack declares one of three **serve modes** (per Jan 2026-07-19 — a serve
  may pick multiple things, e.g. several ice-cream scoops or a cocktail's
  ingredients):
  - **`single`** (the Qoffee classic): item count fixes the qubit count
    ⌈log₂ N⌉ (≤ 5 — the board has 5 rows; 32 items max); one shot = one item.
  - **`shots`**: same encoding, but a serve draws `shots = k` independent
    shots — k scoops, duplicates welcome ("2× vanilla, 1× mango" from a
    lopsided distribution is the honest outcome).
  - **`subset`**: each item is bound to ONE qubit (≤ 5 items); a single shot's
    bitstring selects the subset — set bits are the ingredients in the glass.
    Superposition = "maybe"-ingredients; **entanglement = ingredients that
    always (or never) arrive together** — a Bell pair on gin+tonic is the
    best entanglement demo in the family.
- The menu view shows every item with its binary code and its **live
  probability** derived from the same probability vector the histogram shows
  (ideal, or noisy when a noise preset is active). In `subset` mode the
  per-item number is the qubit's *marginal* P(bit=1); `shots` mode shows the
  expected share of scoops.
- **Serve**: sample the active distribution (once, or k times). Reveal
  animation → order card ("You ordered: Cappuccino — `100` at 87%" / a scoop
  list / an ingredient list). With a noise preset on, shots are sampled from
  the *noisy* distribution — "real hardware might make you an espresso
  instead" is the best teaching moment in the family.
- Dispatch (later): the host can forward a serve to a real machine (Home
  Connect coffee machine, webhook for anything else) — operator-armed only.

## Menu packs (the config package)

One canonical **JSON wire schema** (TS types + validator in `shared/menu/`);
host-side packs are authored as TOML for consistency with `branding.toml` /
`layout.toml` and converted to the wire schema when served.

```toml
# menu/cocktails/pack.toml
id      = "cocktails"
title   = "Quantum Bar"
tagline = "Mix your drink with a quantum computer"

[serve]                      # optional; default mode = "single"
mode  = "single"             # "single" | "shots" | "subset"
shots = 3                    # only for mode = "shots" (1–10)

[theme]                      # optional branding overrides (CSS vars on tokens.css)
accent     = "#e91e63"
background = "bar.jpg"       # relative to the pack dir
logo       = "logo.svg"

[[item]]
code     = "000"             # single/shots modes; subset mode uses `qubit = 0` instead
name     = "Tropical Sunrise"
subtitle = "orange · mango · grenadine"
image    = "sunrise.jpg"     # relative path; emoji used when absent
emoji    = "🍹"
program  = ""                # optional dispatch payload (MX4)
# … one [[item]] per code
```

Rules (enforced by the loader, mirrored in tests):
- `single`/`shots`: `2 ≤ items ≤ 32`; qubit count = ⌈log₂ N⌉; codes are unique
  bitstrings of that width, using the same bit-order convention as the shared
  histogram labels (single source: `shared/display/outcomes.ts` — no second
  convention). `subset`: `2 ≤ items ≤ 5`, each item names a unique `qubit`
  0–4; qubit count = item count.
- Packs SHOULD fill all 2^q codes; unfilled codes are auto-padded with a
  "Surprise me ✨" house item (an honest answer to leftover amplitude — never
  re-roll, never remap: the measurement is the measurement).
- Images optional; every item has an emoji fallback so a pack with zero image
  files still looks intentional. Built-in packs are emoji+SVG-card only (no
  photo licensing burden); real photos arrive via custom packs.
- `theme` is optional; defaults inherit the standard Entangible look. Event
  branding (`branding.toml`) stays separate and composes: topbar = event,
  menu = pack.

**Built-in packs** (bundled in the app, work standalone/offline):
`coffee` (the classic Qoffee 8: Espresso … Americano), `cocktails`,
`icecream`, and `demo` (emoji food, 4 items / 2 qubits — the docs/test pack).

**Custom packs**: host-side directory next to the other config files
(`menu/<id>/pack.toml` + images), served at `/api/menu/packs` (list) and
`/api/menu/pack/{id}` (wire JSON with image URLs, images streamed like
`/api/branding/logo`). Standalone app additionally accepts `?menupack=<url>`
pointing at a hosted wire-JSON pack (CORS permitting) — zero-install custom
menus at entangible.org.

## Architecture & touchpoints

Follows the noise-model / golf playbook: shared math + classPrefix components,
a mode, a layout field, an operator `select_*`, host validation + persistence.

- **`shared/menu/`** — `pack.ts` (types, validation, code↔item mapping,
  padding, serve modes), `sample.ts` (`sampleOutcome(probs, rng)` +
  `sampleShots(probs, k, rng)` + `marginals(probs)` for subset mode;
  injectable RNG — seeded mulberry32 in tests, crypto random in the UI),
  `builtinPacks.ts`,
  `MenuGrid.tsx` + `OrderCard.tsx` + `ServeReveal.tsx` (classPrefix-shared,
  themed via CSS vars).
- **Pocket (standalone)** — a Mixer surface like Golf's: pack picker in the
  settings drawer + `?menu=<id>` / `?menupack=<url>` URL params; local serve
  (no host). Wire count displays ⌈log₂ N⌉ via the existing `compact` wires.
- **Kiosk/booth** — new mode `mixer` in `layout.py` `MODE_PANELS`
  (`mixer: ["menu", "order", "results"]`): circuit stays on stage, sidebar
  shows the menu grid with live probabilities + the last order card. Attract
  mode gains a menu line ("Order your coffee with a quantum computer").
  Panel registry gains `menu` and `order` (unknown names already pass through
  clients — forward-compatible).
- **Protocol** (additive; `docs/protocol.md` ⇄ `ws/messages.ts` parity test
  updated in lockstep):
  - `layout` gains `menu: string | null` (active pack id).
  - client `select_menu {pack}` — operator-only, validated + persisted +
    replayed like `select_noise`.
  - client `serve {outcomes}` — sent by the serving surface (kiosk touch or
    `/debug`), operator-standing required; the sampler runs where the
    simulation runs (the client), the host is the authority that stamps and
    fans out. `outcomes` is a bitstring list: length 1 for `single`/`subset`,
    length k for `shots`.
  - server `served {seq, packId, outcomes, shotSource: 'ideal'|'noisy'}` —
    broadcast to all clients (viewers' phones show the same reveal, in sync),
    latest replayed to late joiners; clients resolve outcomes → items/scoop
    counts/ingredient subset via the shared pack mapping.
  - The existing policy test extends: `select_menu`/`serve` send-sites pinned
    to operator surfaces.
- **Host** — `layout.py` grows the `menu` field + `select_menu`; a new
  `menu.py` (pack directory loader/validator + REST endpoints); `ws_state.py`
  routes `serve` → `served`. All persistence TOML, same patterns.

## Machine dispatch (Qoffee parity — MX4)

Host-side only (secrets never reach the browser): `dispatch.py` with pluggable
adapters, configured per pack or in a host-level `dispatch.toml`:
- `log` (default) — serve events logged, nothing actuates. Dry-run for every
  pack.
- `webhook` — POST the `served` JSON to a configured URL. The universal
  adapter: cocktail robots, Home Assistant, GPIO bridges, ice-cream machines.
- `homeconnect` — the Qoffee path: OAuth (device flow) against the Home
  Connect API, item `program` = HomeConnect program key, start program on
  serve. Needs a developer-account client id; the Home Connect simulator
  works for CI-less manual testing.

Safety rails: dispatch is **disarmed by default**, armed from `/debug`
(operator token), auto-disarms after a configurable idle period; per-serve
cooldown (machine busy = queue nothing, show "machine is busy"); every
dispatch logged.

## Phases (each independently demoable, repo convention)

1. **MX0 — menu core**: `shared/menu/` types + validator + padding + sampler +
   built-in packs; unit tests (validation matrix, seeded-RNG distribution
   sanity, histogram-parity of displayed probabilities). *Demo: none (pure
   lib), tests green.*
2. **MX1 — standalone mixer (quantum-mixer replaced)**: pocket Mixer surface,
   pack picker + URL params, live menu probabilities, serve + reveal + order
   card, noise-aware shots. *Demo: entangible.org?menu=cocktails, build H⊗H⊗H,
   serve, get a random drink.*
3. **MX2 — booth mixer**: `mixer` mode + panels, `select_menu`/`serve`/`served`
   protocol + host validation/persistence/replay, `/debug` pack control,
   viewer-synced reveals, attract-mode line, policy + parity tests.
   *Demo: `make demo`, switch mode to mixer from /debug, tiles pick the drink.*
4. **MX3 — custom packs**: host pack directory + REST, `?menupack=` remote
   packs, pack-authoring docs (`docs/menu-packs.md`) with the TOML schema and
   a checklist (image sizes, code table). *Demo: drop a folder, new themed
   menu appears without rebuilding.*
5. **MX4 — dispatch (Qoffee replaced)**: `dispatch.py` + `log`/`webhook`/
   `homeconnect` adapters, arming UX in `/debug`, cooldowns, docs incl. Home
   Connect setup. *Demo: serve → webhook fires / simulator brews.*
6. **MX5 — sunset the old repos** (upstream track, outside this repo):
   archive/deprecation notes in Qoffee-Maker and quantum-mixer READMEs
   pointing here; qoffee-maker.org redirect or banner; migrate any drink
   menus worth keeping into packs. Coordinate with Jan.

## Verification

- Unit: pack validation matrix (counts, dup codes/qubits, width, padding,
  serve-mode rules), sampler statistics under a seeded RNG (χ² sanity vs the
  input distribution; multi-shot draws), marginal math vs closed-form cases
  (Bell → both ingredients perfectly correlated), menu probabilities
  byte-identical to the histogram's vector, theme CSS-var application.
- Protocol: `messages.test.ts` parity vs `docs/protocol.md` (new messages);
  static policy test for the new `select_menu`/`serve` send-sites; host tests
  for validation/persistence/replay of `menu` + `served`.
- E2E without hardware: `make demo` replay drives a known circuit → menu
  probabilities match goldens; serve with seeded RNG → deterministic item in
  test mode.
- Manual: iPhone standalone (`?menu=icecream`), booth kiosk + viewer phones
  see the same reveal, dispatch dry-run log.

## Open questions (for Jan, before/during MX1)

1. **quantum-mixer feature audit** — this plan is grounded in the Qoffee
   concept and Entangible's architecture; the quantum-mixer repo couldn't be
   read from this session (repo access needs an interactive approval). Add
   both repos to a session (or point me at them) for a quick parity pass —
   anything beyond menu/serve/branding there (sound? multi-shot modes?
   leaderboards?) gets folded into MX1/MX3.
2. **Serve authority in the booth** — plan says: the surface that simulates
   samples, the host stamps + broadcasts. OK, or should the kiosk be the only
   sampler?
3. **Big-menu ambition** — cap at 32 items (5 qubits) is the board's natural
   limit; fine?
4. **Home Connect** — is the original Qoffee developer account / machine still
   available for MX4 testing, or should webhook be the only v1 adapter?
5. **Naming** — mode key `mixer`, feature name "Quantum Mixer", packs =
   "menu packs". Blessing or better ideas?
6. **Shots count** — fixed per pack (`shots = 3`) as planned, or
   visitor-choosable at serve time ("how many scoops?"), which adds a UI
   step but is friendlier at an ice-cream booth?
