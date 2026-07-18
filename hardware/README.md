# qamposer-hardware — 3D-printable Entangible gate tiles

Multi-colour 3D gate tiles for the Entangible physical quantum-circuit composer,
generated parametrically from `assets.toml` and the shared `MARKER_TABLE`, so the
printed marker, colours and face layout can never drift from the printed-paper
kit or the vision detector.

Built with [build123d](https://github.com/gumyr/build123d) (OpenCASCADE). Output
is one **MMU colour part per filament** plus a bundled coloured **3MF**, aimed at
a **Prusa Core One with the MMU** (per-layer multi-colour).

## What it makes

For every gate tile in `MARKER_TABLE` (IDs 10-15, 20-31, 40, 41 — H, X, Y, Z,
CNOT control/target, RX/RY/RZ × {π/4, π/2, π, −π/2}, S, T; board corners 0-3 are
*not* tiles):

- Footprint **60 × 60 mm**, corner radius 4 mm (from `assets.toml`).
- Two height variants: **`tile`** (H = 6 mm) and **`cube`** (H = 60 mm).
- A **colour top face** — the last 0.8 mm of height — split into regions that
  match the 2D tile face exactly:
  - **white** field,
  - **black** ArUco marker (the 6 × 6 module grid straight from
    `qamposer_assets.marker_bit_matrix`),
  - the **gate-colour** frame (2.5 mm) + label band (9 mm), with the band's
    caption standing white inside it.
- White body below the face. The **cube** variant is hollowed (3 mm walls, no
  top/bottom perforation) to save filament; the **tile** variant is solid.
- A 0.4 mm bottom chamfer (elephant-foot relief).
- Optional magnet pockets (`--magnets`).

## Generate

```bash
uv run qamposer-hardware generate --variant all --gates all
# a few tiles, tile variant only:
uv run qamposer-hardware generate --variant tile --gates H,S,CNOT
# with magnet pockets:
uv run qamposer-hardware generate --variant cube --gates H --magnets
```

Options: `--variant tile|cube|all`, `--gates H,X,RX,CNOT,...|<marker-id>,...|all`,
`--magnets`, `--out DIR` (default `out/hardware`, git-ignored).

Output per variant lands in `out/hardware/<variant>/`:

- `<gate>-body-white.stl`, `<gate>-marker-black.stl`, `<gate>-accent-<colour>.stl`
  — the three colour parts in one shared coordinate frame.
- `<gate>.3mf` — the same parts bundled with their gate colours baked in.
- `plates.md` — the MMU plate groupings (see below).

The band caption reads white on the gate colour because the glyphs are cut out of
the accent part and left standing in the white body; there is **no** separate
glyph part.

## Printing on a Prusa Core One + MMU

- **Material:** matte PLA (matte kills glare, which is what the ArUco detector
  needs). Any brand; the marker just needs pure **black on white**.
- **Layer height:** 0.2 mm. The colour face is 0.8 mm = 4 layers, so colour
  changes land on clean layer boundaries.
- **Orientation:** print **face UP**. The coloured top face is the camera-facing
  face; printing it up gives the crispest marker and lets you iron it.
- **Ironing:** enable **ironing on the top surface only**. A smooth, matte top
  face markedly improves marker contrast and detection.
- **Seam:** set the seam to **Rear** (or paint it onto a body side) so it never
  lands on the marker face.
- **First layer:** the 0.4 mm bottom chamfer already relieves elephant-foot;
  keep a slightly reduced first-layer extrusion / correct Z-offset. Brim only if
  a cube tips.
- **Import into PrusaSlicer:** either open `<gate>.3mf` directly (colours come
  in), **or** select the three `*.stl` parts, right-click →
  *Import as single object / parts*, and assign each part to its slot per
  `plates.md`.

### Filament slots / plates

`plates.md` (regenerated on every run) lists the MMU plate groupings. The MMU has
5 slots; every plate uses slot 1 = **white** (`#ffffff`) bodies, slot 2 =
**black** (`#000000`) markers, leaving 3 slots for gate accent colours. The gate
set uses **4** accent colours, so tiles split across **2 plates**:

| Filament | Hex | Gates |
| -------- | --- | ----- |
| white | `#ffffff` | all bodies |
| black | `#000000` | all markers |
| red | `#fa4d56` | H |
| blue | `#002d9c` | X, CNOT |
| magenta | `#9f1853` | Y, RX, RY |
| cyan | `#33b1ff` | Z, RZ, S, T |

Hex values are read from `assets.toml` — they are exactly `@qamposer/react`'s
`GATE_COLORS`, so a tile in hand matches its gate on screen.

## Rotation-angle tactile notches

Rotation tiles (RX/RY/RZ) carry the full angle in the band caption (`RX π/2`,
`RY -π/2`, …). As a **tactile** backup so angle variants are also distinguishable
by hand, the bottom band edge carries small notches encoding the angle:

| Angle | Notches |
| ----- | ------- |
| π/4 | 1 |
| π/2 | 2 |
| π | 3 |
| −π/2 | 4 |

The count is the angle's index in `qamposer_vision.markers.ROTATION_ANGLES`.
Non-rotation tiles have no notches. The notches are shallow slots in the band
edge and do not affect the 60 × 60 footprint bounding box.

## Cube parallax caveat

The `cube` variant puts the marker face **60 mm above the board plane**. The
board homography is solved on the mat's corner markers, which lie *on* the board.
A camera that is not looking straight down therefore sees a cube's top face
shifted **laterally** relative to where a flat tile would sit (parallax grows
with height and viewing angle). At steep camera angles this lateral shift can
push a cube's detected centre outside the grid tolerance and the tile may be
**rejected as off-grid**. Cubes want a **near-vertical camera**; if you use them,
mount the camera high and centred, or prefer the flat `tile` variant for
oblique-camera booths.

## Magnets

`--magnets` adds two Ø6.2 mm × 2.1 mm pockets to the underside (for 6 mm × 2 mm
disc magnets). Press-fit or glue a magnet into each pocket **after** printing;
mind polarity if you want tiles to stack or snap to a steel board consistently.
Default is **off**.

## Validate: print one H tile first

Before printing a whole kit, print a single **H** tile and confirm the detector
reads it:

```bash
uv run qamposer-hardware generate --variant tile --gates H
# print out/hardware/tile/h-*.stl (or h.3mf), then photograph it on the mat and:
uv run qamposer-vision detect --image path/to/photo.jpg --json
```

You should see marker ID 10 (H) detected at the cell you placed it on. If not,
check: matte surface (no glare), pure black/white marker, top face ironed, and
the camera roughly overhead. Once one H tile detects cleanly, print the rest.
