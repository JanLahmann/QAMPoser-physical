# Sunset drafts — Qoffee-Maker & quantum-mixer (QN5)

> Status: DRAFTS awaiting Jan's review. Phase QN5 (docs/quantina.md) sunsets
> the two predecessor repos now that Quantina ships their functionality
> natively. Nothing here has been posted anywhere — these are ready-to-paste
> texts for repos Jan owns, plus the decision list for qoffee-maker.org.
> Everything Quantina-side they depend on is implemented (QN0–QN4).

## 1. quantum-mixer — README banner (paste at the very top)

```markdown
> [!IMPORTANT]
> **quantum-mixer has been superseded by
> [Quantina](https://github.com/JanLahmann/entangible/blob/main/docs/quantina.md)**,
> the built-in menu/serving mode of [Entangible](https://entangible.org), the
> physical quantum circuit composer. Quantina carries everything this app did —
> the QoffeeMaker / Qocktail / IceQream scenarios ship as built-in menu packs,
> custom scenarios are simple TOML
> [menu packs](https://github.com/JanLahmann/entangible/blob/main/docs/menu-packs.md)
> (no rebuild), simulation runs noise-aware in the browser (no backend, no API
> keys), and machine control is an optional host-side dispatch adapter
> (webhook / Home Connect). Try it right now:
> **[entangible.org?menu=cocktails](https://entangible.org/?menu=cocktails)**.
>
> This repository is kept for reference and is no longer maintained.
```

Repo settings once the banner is merged: add the archived badge by archiving
the repo (Settings → Archive), or keep it unarchived if PRs should stay open.

## 2. Qoffee-Maker — README banner (paste at the very top)

```markdown
> [!IMPORTANT]
> **Qoffee-Maker has been superseded by
> [Quantina](https://github.com/JanLahmann/entangible/blob/main/docs/quantina.md)**,
> the built-in menu/serving mode of [Entangible](https://entangible.org), the
> physical quantum circuit composer. The coffee menu ships as Quantina's
> built-in `coffee` pack (the original Home Connect program payloads included),
> and the coffee-machine control lives on as the host-side `homeconnect`
> dispatch adapter — no Docker, no Jupyter, no IBMQ API key, and visitors can
> build the circuit from physical tiles. Order a quantum coffee right now:
> **[entangible.org?menu=coffee](https://entangible.org/?menu=coffee)**.
>
> This repository is kept for reference and is no longer maintained.
```

## 3. qoffee-maker.org — options (pick one)

1. **Redirect** (cleanest): point the domain at
   `https://entangible.org/?menu=coffee` (registrar-level 301 or a one-line
   meta-refresh page). History is preserved by the archived repo.
2. **Banner**: keep the current site, add a top banner with the same text as
   the README notice. More work to host, only worth it if the site's docs
   should stay browsable at their old URLs.

## 4. Checklist (Jan)

- [ ] Review/edit the two banners above.
- [ ] Merge them into the two READMEs (direct push or PR — both repos are
      JanLahmann-owned).
- [ ] Decide archive vs. keep-open for each repo.
- [ ] qoffee-maker.org: redirect or banner (option 1 recommended).
- [ ] Optional: transfer any open issues worth keeping to the entangible repo.
