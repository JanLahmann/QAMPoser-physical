"""Compose one 60×60 mm gate tile SVG from a marker ID.

Layout follows ``docs/assets-design.md`` and every number comes from
``assets.toml`` via :mod:`config`. The SVG carries three semantic groups so M6
can extrude STLs from the same faces:

* ``#outline`` — tile edge, coloured frame and the white marker field.
* ``#marker``  — the vector ArUco module rects.
* ``#symbol``  — the label band's text and CNOT glyphs.

Gate colours are the frame *and* the bottom label band (same colour), so the
object in a visitor's hand matches the gate on screen.
"""

from __future__ import annotations

from qamposer_vision.markers import MARKER_TABLE, GateSpec

from .config import AssetsConfig
from .marker_svg import marker_group
from .svgbase import esc, rect, svg_document
from .symbols import control_dot, target_cross, text

__all__ = [
    "gate_marker_ids",
    "tile_label",
    "tile_body",
    "tile_svg",
]

# Cap height ≈ 0.72 · em for IBM Plex Sans / Helvetica; invert to get font-size.
_CAP_TO_EM = 1.0 / 0.72
# Thin space between a rotation gate and its angle, e.g. "RX␉π/2".
_THIN_SPACE = " "


def gate_marker_ids() -> list[int]:
    """Sorted marker IDs of every printable gate tile (``kind == 'gate'``)."""
    return sorted(mid for mid, spec in MARKER_TABLE.items() if spec.kind == "gate")


def tile_label(spec: GateSpec) -> str:
    """The band caption for a gate.

    * single-qubit: the gate letter (``H``/``X``/``Y``/``Z``)
    * rotation: gate + thin space + pretty angle (``RX π/2``, ``RY -π/2``)
    * CNOT: ``CONTROL`` / ``TARGET`` (the ●/⊕ glyph is drawn separately)
    """
    if spec.gate == "CNOT":
        return "CONTROL" if spec.role == "control" else "TARGET"
    if spec.param_label is not None:
        return f"{spec.gate}{_THIN_SPACE}{spec.param_label}"
    return spec.gate


def _fit_font(content: str, max_width: float, base_size: float) -> float:
    """Shrink ``base_size`` so ``content`` fits within ``max_width`` (mm)."""
    # Bold sans-serif average advance ≈ 0.62 em; keep a small safety margin.
    est = len(content) * base_size * 0.62
    if est > max_width and est > 0:
        return base_size * (max_width / est)
    return base_size


def tile_body(marker_id: int, config: AssetsConfig) -> str:
    """Inner SVG (the three groups) for the tile, without a root ``<svg>``.

    Usable both standalone (see :func:`tile_svg`) and embedded in a cut-sheet
    under a ``<g transform="translate(...)">``.
    """
    spec = MARKER_TABLE[marker_id]
    if spec.kind != "gate":
        raise ValueError(f"marker {marker_id} is not a gate tile ({spec.label})")

    t = config.tile
    color = config.colors.for_gate(spec.gate)
    inner_radius = max(t.corner_radius - t.frame_width, 0.0)
    font_family = config.typography.font_family

    # --- #outline: coloured tile + white marker field -----------------------
    field_h = t.band_top - t.frame_width
    outline = (
        '<g id="outline">'
        + rect(0, 0, t.size, t.size, fill=color, rx=t.corner_radius)
        + rect(
            t.frame_width,
            t.frame_width,
            t.size - 2 * t.frame_width,
            field_h,
            fill="#ffffff",
            rx=inner_radius,
        )
        + "</g>"
    )

    # --- #marker: vector ArUco ---------------------------------------------
    marker = marker_group(
        marker_id,
        t.marker_x,
        t.marker_y,
        t.marker_size,
        dictionary=config.aruco_dictionary,
        group_id="marker",
        with_background=False,  # field is already pure white
    )

    # --- #symbol: band caption ---------------------------------------------
    band_cy = t.band_top + t.band_height / 2.0
    symbol = _render_symbol(spec, config, band_cy, color, font_family)

    return f'<g id="tile-{marker_id}">{outline}{marker}{symbol}</g>'


def _render_symbol(
    spec: GateSpec,
    config: AssetsConfig,
    band_cy: float,
    color: str,
    font_family: str,
) -> str:
    t = config.tile
    base_font = config.typography.band_cap_height * _CAP_TO_EM
    label = tile_label(spec)

    if spec.gate == "CNOT":
        # Glyph on the left, small-caps word to its right.
        glyph_r = t.band_height * 0.30
        glyph_cx = t.size * 0.26  # keep clear air between glyph and word
        word = "CONTROL" if spec.role == "control" else "TARGET"
        word_font = _fit_font(word, t.size * 0.46, base_font * 0.72)
        word_x = t.size * 0.60
        if spec.role == "control":
            glyph = control_dot(glyph_cx, band_cy, glyph_r, fill="#ffffff")
        else:
            glyph = target_cross(glyph_cx, band_cy, glyph_r, color="#ffffff")
        caption = text(
            word_x,
            band_cy,
            word,
            size=word_font,
            color="#ffffff",
            family=font_family,
            letter_spacing=word_font * 0.06,
        )
        return f'<g id="symbol">{glyph}{caption}</g>'

    max_w = t.size - 2 * t.frame_width - 3.0
    font = _fit_font(label, max_w, base_font)
    caption = text(
        t.size / 2.0,
        band_cy,
        label,
        size=font,
        color="#ffffff",
        family=font_family,
    )
    return f'<g id="symbol">{caption}</g>'


def tile_svg(marker_id: int, config: AssetsConfig) -> str:
    """A standalone tile SVG document."""
    spec = MARKER_TABLE[marker_id]
    body = tile_body(marker_id, config)
    return svg_document(
        config.tile.size, config.tile.size, body, title=f"Tile {esc(spec.label)}"
    )
