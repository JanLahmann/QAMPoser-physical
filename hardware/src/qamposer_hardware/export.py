"""Write tile solids to disk: per-colour STL parts, a coloured 3MF, and plates.md.

Per-colour STLs share one coordinate frame so PrusaSlicer's "import as single
object with parts" reassembles the tile with each part on its own filament. The
3MF bundles the same parts with their gate colours baked in (via ``lib3mf``),
which slicers open directly as a multi-material object.
"""

from __future__ import annotations

from pathlib import Path

from build123d import Mesher, export_stl
from qamposer_assets.config import AssetsConfig
from qamposer_vision.markers import MARKER_TABLE, GateSpec, pretty_angle

from .build import DoubleTileParts, TileParts
from .face import accent_color_name, double_color_name

__all__ = [
    "tile_slug",
    "double_slug",
    "export_tile_stls",
    "export_tile_3mf",
    "export_double_tile_stls",
    "export_double_tile_3mf",
    "write_plates_md",
    "double_plate_assignment",
    "write_double_plates_md",
]

#: Named filament slots that are constant across every plate.
WHITE_HEX = "#ffffff"
BLACK_HEX = "#000000"


def _angle_slug(param: float) -> str:
    label = pretty_angle(param)  # e.g. "π/2", "-π/2", "π"
    return (
        label.replace("π", "pi")
        .replace("/", "")
        .replace("-", "neg")
        .replace(".", "p")
    )


def tile_slug(spec: GateSpec) -> str:
    """Filename-safe identifier for a gate tile (ASCII, lowercase)."""
    if spec.gate == "CNOT":
        return f"cnot-{spec.role}"
    if spec.parameter is not None:
        return f"{spec.gate.lower()}-{_angle_slug(spec.parameter)}"
    return spec.gate.lower()


def _compact_angle(param: float) -> str:
    """Short angle code for double-piece filenames: π/2→p2, -π/2→m2, π/4→p4, π→p1."""
    label = pretty_angle(param)  # "π/2", "-π/2", "π", "π/4"
    sign = "m" if label.startswith("-") else "p"
    core = label.lstrip("-")
    denom = core.split("/")[1] if "/" in core else "1"
    return f"{sign}{denom}"


def _face_slug(spec: GateSpec) -> str:
    """Compact per-face identifier used in double-piece filenames."""
    if spec.gate == "CNOT":
        return "cnot-ctrl" if spec.role == "control" else "cnot-tgt"
    if spec.parameter is not None:
        return f"{spec.gate.lower()}-{_compact_angle(spec.parameter)}"
    return spec.gate.lower()


def double_slug(spec_a: GateSpec, spec_b: GateSpec) -> str:
    """Filename stem for a double-faced piece, e.g. ``rx-p2+rx-m2`` or ``h+x``."""
    return f"{_face_slug(spec_a)}+{_face_slug(spec_b)}"


def _apply_object_color(mesher: Mesher, hex_color: str, name: str) -> None:
    """Attach a base-material colour to the last mesh object added to ``mesher``.

    Uses the lib3mf model directly (the ``Mesher.model``/``.wrapper``/``.meshes``
    handles build123d already exposes) so the colour lands on the real mesh
    object rather than the throwaway copy ``add_shape`` colours internally.
    """
    mesh_obj = mesher.meshes[-1]
    r, g, b = _hex_rgb01(hex_color)
    group = mesher.model.AddBaseMaterialGroup()
    color = mesher.wrapper.FloatRGBAToColor(r, g, b, 1.0)
    material_id = group.AddMaterial(Name=name, DisplayColor=color)
    mesh_obj.SetObjectLevelProperty(group.GetResourceID(), material_id)
    mesh_obj.SetName(name)


def _hex_rgb01(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def _part_color_hex(role: str, layout) -> str:
    if role == "body":
        return WHITE_HEX
    if role == "marker":
        return BLACK_HEX
    return layout.accent_hex


def export_tile_stls(parts: TileParts, out_dir: Path) -> list[Path]:
    """Write ``<slug>-<role>-<colour>.stl`` for each colour part."""
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = tile_slug(parts.layout.spec)
    written: list[Path] = []
    for role, color_name, solid in parts.named_parts():
        path = out_dir / f"{slug}-{role}-{color_name}.stl"
        export_stl(solid, str(path))
        written.append(path)
    return written


def export_tile_3mf(parts: TileParts, out_dir: Path) -> Path | None:
    """Write a single coloured ``<slug>.3mf`` with each part on its gate colour.

    Returns the path, or ``None`` if the 3MF backend is unavailable.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = tile_slug(parts.layout.spec)
    path = out_dir / f"{slug}.3mf"
    mesher = Mesher()
    try:
        for role, color_name, solid in parts.named_parts():
            mesher.add_shape(solid)
            # build123d 0.11.1 drops a Solid's `.color` inside add_shape (it
            # re-iterates the Solid into a fresh, colour-less copy), so set the
            # base-material colour directly on the mesh object it just created.
            _apply_object_color(
                mesher,
                _part_color_hex(role, parts.layout),
                f"{slug}-{role}-{color_name}",
            )
        mesher.write(str(path))
    except (RuntimeError, ValueError):
        # lib3mf rejects a mesh it considers non-manifold; the per-colour STLs
        # are still written, so 3MF is genuinely best-effort here.
        if path.exists():
            path.unlink()
        return None
    return path


def export_double_tile_stls(parts: DoubleTileParts, out_dir: Path) -> list[Path]:
    """Write ``<a>+<b>-<role>-<colour>.stl`` for each colour part of a double piece."""
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = double_slug(parts.layout_a.spec, parts.layout_b.spec)
    written: list[Path] = []
    for role, color_name, _hex, solid in parts.named_parts():
        path = out_dir / f"{slug}-{role}-{color_name}.stl"
        export_stl(solid, str(path))
        written.append(path)
    return written


def export_double_tile_3mf(parts: DoubleTileParts, out_dir: Path) -> Path | None:
    """Write a single coloured ``<a>+<b>.3mf`` (3 or 4 parts by colour count)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = double_slug(parts.layout_a.spec, parts.layout_b.spec)
    path = out_dir / f"{slug}.3mf"
    mesher = Mesher()
    try:
        for role, color_name, hexc, solid in parts.named_parts():
            mesher.add_shape(solid)
            _apply_object_color(mesher, hexc, f"{slug}-{role}-{color_name}")
        mesher.write(str(path))
    except (RuntimeError, ValueError):
        if path.exists():
            path.unlink()
        return None
    return path


# --------------------------------------------------------------------------- #
# plates.md — MMU plate groupings
# --------------------------------------------------------------------------- #


def _gate_tiles() -> list[tuple[int, GateSpec]]:
    return sorted(
        ((mid, spec) for mid, spec in MARKER_TABLE.items() if spec.kind == "gate"),
        key=lambda kv: kv[0],
    )


def write_plates_md(config: AssetsConfig, out_dir: Path) -> Path:
    """Emit ``plates.md``: two MMU plates (≤5 slots) with per-slot hex + tiles."""
    out_dir.mkdir(parents=True, exist_ok=True)

    # accent hex -> [tile labels]
    by_accent: dict[str, list[str]] = {}
    accent_order: list[str] = []
    for _mid, spec in _gate_tiles():
        hexc = config.colors.for_gate(spec.gate)
        if hexc not in by_accent:
            by_accent[hexc] = []
            accent_order.append(hexc)
        by_accent[hexc].append(spec.label)

    # Fixed slots white + black leave 3 free MMU slots per plate → chunk accents.
    free_slots = 3
    chunks = [
        accent_order[i : i + free_slots]
        for i in range(0, len(accent_order), free_slots)
    ]

    lines: list[str] = [
        "# MMU plate groupings — Entangible gate tiles",
        "",
        "Prusa Core One MMU has 5 filament slots. Every plate reserves slot 1",
        "for **white** (bodies) and slot 2 for **black** (markers), leaving 3",
        "slots for gate accent colours. The gate set uses "
        f"{len(accent_order)} accent colours, so tiles split across "
        f"{len(chunks)} plate(s) below.",
        "",
        "Load filaments into these slots, then print the listed tiles on that",
        "plate (any height variant). Hex values come straight from `assets.toml`.",
        "",
    ]

    for pi, chunk in enumerate(chunks, start=1):
        lines.append(f"## Plate {pi}")
        lines.append("")
        lines.append("| Slot | Filament | Hex |")
        lines.append("| ---- | -------- | --- |")
        lines.append(f"| 1 | white (bodies) | `{WHITE_HEX}` |")
        lines.append(f"| 2 | black (markers) | `{BLACK_HEX}` |")
        for si, hexc in enumerate(chunk, start=3):
            lines.append(f"| {si} | {accent_color_name(hexc)} | `{hexc}` |")
        lines.append("")
        lines.append("Tiles on this plate:")
        lines.append("")
        for hexc in chunk:
            tiles = ", ".join(by_accent[hexc])
            lines.append(f"- **{accent_color_name(hexc)}** (`{hexc}`): {tiles}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(
        "Each tile's STL parts (`*-body-white.stl`, `*-marker-black.stl`, "
        "`*-accent-<colour>.stl`) share one coordinate frame — in PrusaSlicer, "
        "select them and *Right-click → Import as single object / parts*, then "
        "assign each part to its slot above. The bundled `<tile>.3mf` already "
        "carries these colours."
    )
    lines.append("")

    path = out_dir / "plates.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# plates.md — double-faced kit (pieces may span two accent families)
# --------------------------------------------------------------------------- #

#: Max accent filaments per plate (5 MMU slots − white − black).
_DOUBLE_FREE_SLOTS = 3


def _piece_families(a: int, b: int | None, config: AssetsConfig) -> list[str]:
    """Ordered, de-duplicated accent hexes a double piece needs (face A, then B)."""
    mb = a if b is None else b
    ha = config.colors.for_gate(MARKER_TABLE[a].gate)
    hb = config.colors.for_gate(MARKER_TABLE[mb].gate)
    fams = [ha]
    if hb.lower() != ha.lower():
        fams.append(hb)
    return fams


def double_plate_assignment(
    config: AssetsConfig, kit: list[tuple[int, int | None, int]]
) -> list[dict]:
    """Greedy first-fit packing of double pieces into ≤3-accent-family plates.

    Every piece (≤2 families) is placed on the first plate whose family union
    stays ≤ :data:`_DOUBLE_FREE_SLOTS`; otherwise a new plate opens. The
    invariant "plate accent-family count ≤ 3" therefore holds by construction.
    Returns a list of ``{"families": [hex...], "pieces": [(a, b, qty)]}``.
    """
    plates: list[dict] = []
    for a, b, qty in kit:
        fams = _piece_families(a, b, config)
        placed = False
        for plate in plates:
            union = list(plate["families"])
            lowered = {f.lower() for f in union}
            for f in fams:
                if f.lower() not in lowered:
                    union.append(f)
                    lowered.add(f.lower())
            if len(union) <= _DOUBLE_FREE_SLOTS:
                plate["families"] = union
                plate["pieces"].append((a, b, qty))
                placed = True
                break
        if not placed:
            plates.append({"families": list(fams), "pieces": [(a, b, qty)]})
    return plates


def _piece_label(a: int, b: int | None, qty: int) -> str:
    mb = a if b is None else b
    slug = double_slug(MARKER_TABLE[a], MARKER_TABLE[mb])
    return f"{slug} ×{qty}"


def write_double_plates_md(
    config: AssetsConfig,
    kit: list[tuple[int, int | None, int]],
    out_dir: Path,
) -> Path:
    """Emit ``plates.md`` for the double-faced kit (pieces may span two families)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    plates = double_plate_assignment(config, kit)
    total = sum(qty for _a, _b, qty in kit)

    lines: list[str] = [
        "# MMU plate groupings — double-faced Entangible pieces",
        "",
        f"The double-faced kit has **{total} pieces**. Each piece carries two "
        "gate faces (flip to switch); a cross-family piece (mixed H/X/Y/Z) needs "
        "**two** accent filaments, one per face.",
        "",
        "Prusa Core One MMU has 5 filament slots. Every plate reserves slot 1 for "
        "**white** (bodies) and slot 2 for **black** (markers), leaving 3 slots "
        "for accent colours — so a plate can host any pieces whose **combined** "
        f"accent families number ≤ 3. Greedy packing uses **{len(plates)} plate(s)**.",
        "",
    ]

    for pi, plate in enumerate(plates, start=1):
        fams = plate["families"]
        lines.append(f"## Plate {pi}")
        lines.append("")
        lines.append("| Slot | Filament | Hex |")
        lines.append("| ---- | -------- | --- |")
        lines.append(f"| 1 | white (bodies) | `{WHITE_HEX}` |")
        lines.append(f"| 2 | black (markers) | `{BLACK_HEX}` |")
        for si, hexc in enumerate(fams, start=3):
            lines.append(f"| {si} | {double_color_name(hexc)} | `{hexc}` |")
        lines.append("")
        lines.append("Pieces on this plate:")
        lines.append("")
        for a, b, qty in plate["pieces"]:
            mb = a if b is None else b
            names = " | ".join(
                double_color_name(config.colors.for_gate(MARKER_TABLE[m].gate))
                for m in (a, mb)
            )
            lines.append(f"- `{_piece_label(a, b, qty)}` — accents: {names}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(
        "Each piece's STL parts (`*-body-white.stl`, `*-marker-black.stl`, and "
        "one `*-accent-<colour>.stl` **per accent colour** — two for a "
        "cross-family piece) share one coordinate frame. In PrusaSlicer select "
        "them and *Right-click → Import as single object / parts*, then assign "
        "each part to its slot above. The bundled `<a>+<b>.3mf` already carries "
        "these colours."
    )
    lines.append("")

    path = out_dir / "plates.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
