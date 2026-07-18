"""Turn a :class:`~qamposer_hardware.face.FaceLayout` into build123d solids.

Produces three MMU colour parts per tile — ``body`` (white), ``marker`` (black)
and ``accent`` (the gate colour) — all in one common coordinate frame so a
slicer merges them by "import as single object with parts". The parts are
manifold and share exact Z planes (the colour layer is the top ``face_depth``
mm of height), which is what per-layer MMU colour needs.

The band's caption glyphs are cut out of the accent part and left standing in
the white body, so they read white-on-colour exactly like the 2D face — there
is no separate glyph part.
"""

from __future__ import annotations

from dataclasses import dataclass

from build123d import (
    Align,
    Axis,
    Box,
    Circle,
    Cylinder,
    FontStyle,
    Location,
    Pos,
    Rectangle,
    RectangleRounded,
    Solid,
    Text,
    chamfer,
    extrude,
)
from qamposer_assets.config import AssetsConfig

from .face import FaceLayout, face_layout
from .params import HardwareParams

__all__ = ["TileParts", "build_tile", "footprint_area"]

#: Font used for the band caption. IBM Plex Sans (the print font) if the host
#: has it, else the same Helvetica/Arial fallback the 2D face declares.
_FONT = "Helvetica"
_CAP_TO_EM = 1.0 / 0.72


@dataclass(slots=True)
class TileParts:
    """The three colour solids of one tile plus the layout that produced them."""

    layout: FaceLayout
    variant: str
    height: float
    body: Solid  # white
    marker: Solid  # black
    accent: Solid  # gate colour

    def named_parts(self) -> list[tuple[str, str, Solid]]:
        """``(role, colour_name, solid)`` for each part, in print order."""
        return [
            ("body", "white", self.body),
            ("marker", "black", self.marker),
            ("accent", self.layout.accent_name, self.accent),
        ]


# --------------------------------------------------------------------------- #
# Sketch / solid helpers (algebra API)
# --------------------------------------------------------------------------- #


def _footprint(layout: FaceLayout):
    """Rounded 60x60 tile outline with the tactile bottom-edge notches removed."""
    prof = Pos(layout.size / 2.0, layout.size / 2.0) * RectangleRounded(
        layout.size, layout.size, layout.corner_radius
    )
    for nr in layout.notches:
        prof = prof - Pos(nr.cx, nr.cy) * Rectangle(nr.w, nr.h)
    return prof


def footprint_area(layout: FaceLayout) -> float:
    """Planar area (mm²) of the tile footprint (rounded corners, notches removed)."""
    return _footprint(layout).area


def _white_field_sketch(layout: FaceLayout):
    wf = layout.white_field
    if layout.inner_radius > 1e-6:
        shape = RectangleRounded(wf.w, wf.h, layout.inner_radius)
    else:
        shape = Rectangle(wf.w, wf.h)
    return Pos(wf.cx, wf.cy) * shape


def _extrude_top(sketch, height: float, face_depth: float) -> Solid:
    """Extrude a face sketch through the top ``face_depth`` mm of the tile."""
    return Pos(0.0, 0.0, height - face_depth) * extrude(sketch, amount=face_depth)


def _marker_solid(
    layout: FaceLayout, height: float, face_depth: float, bleed: float
) -> Solid:
    m = layout.module_size + 2.0 * bleed
    solid: Solid | None = None
    for cell in layout.modules:
        if cell.bit != 1:
            continue
        box = Box(m, m, face_depth, align=(Align.CENTER, Align.CENTER, Align.MIN))
        box = Pos(cell.rect.cx, cell.rect.cy, height - face_depth) * box
        solid = box if solid is None else solid + box
    if solid is None:  # no black modules should never happen for a real marker
        raise ValueError(f"marker {layout.marker_id} produced no black modules")
    return solid


def _fit_text(label: str, cap: float, max_w: float, max_h: float):
    """A bold text sketch of ~``cap`` cap-height, scaled to fit ``max_w``x``max_h``.

    Returned recentred on its bounding box so it can be placed by centre point.
    """
    fs = cap * _CAP_TO_EM
    sk = Text(label, font_size=fs, font=_FONT, font_style=FontStyle.BOLD)
    bb = sk.bounding_box()
    sw, sh = bb.size.X, bb.size.Y
    factor = 1.0
    if sw > 0:
        factor = min(factor, max_w / sw)
    if sh > 0:
        factor = min(factor, max_h / sh)
    if factor < 1.0:
        sk = Text(label, font_size=fs * factor, font=_FONT, font_style=FontStyle.BOLD)
        bb = sk.bounding_box()
    c = bb.center()
    return Pos(-c.X, -c.Y) * sk


def _glyph_sketch(layout: FaceLayout, config: AssetsConfig):
    """Band caption as a face sketch (letters, or CNOT glyph + word); or None."""
    spec = layout.spec
    size = layout.size
    band_cy = layout.band.cy
    cap = config.typography.band_cap_height

    if spec.gate == "CNOT":
        glyph_r = layout.band_height * 0.30
        glyph_cx = size * 0.26
        word = "CONTROL" if spec.role == "control" else "TARGET"
        word_x = size * 0.60
        if spec.role == "control":
            glyph = Pos(glyph_cx, band_cy) * Circle(glyph_r)
        else:
            stroke = 0.12 * (2.0 * glyph_r)
            ring = Circle(glyph_r) - Circle(glyph_r - stroke)
            horiz = Rectangle(2.0 * glyph_r, stroke)
            vert = Rectangle(stroke, 2.0 * glyph_r)
            glyph = Pos(glyph_cx, band_cy) * (ring + horiz + vert)
        word_sk = Pos(word_x, band_cy) * _fit_text(
            word, cap * 0.72, size * 0.46, layout.band_height - 2.0
        )
        return glyph + word_sk

    if not layout.label:
        return None
    max_w = size - 2.0 * layout.frame_width - 3.0
    return Pos(size / 2.0, band_cy) * _fit_text(
        layout.label, cap, max_w, layout.band_height - 2.0
    )


def _chamfer_bottom(body: Solid, amount: float) -> Solid:
    if amount <= 0:
        return body
    bottom_face = body.faces().sort_by(Axis.Z)[0]
    return chamfer(bottom_face.edges(), amount)


def _hollow(body: Solid, layout: FaceLayout, params: HardwareParams, height: float) -> Solid:
    inset = params.wall
    cav_w = layout.size - 2.0 * inset
    cav_r = max(layout.corner_radius - inset, 0.0)
    if cav_r > 1e-6:
        sk = RectangleRounded(cav_w, cav_w, cav_r)
    else:
        sk = Rectangle(cav_w, cav_w)
    sk = Pos(layout.size / 2.0, layout.size / 2.0) * sk
    cavity = Pos(0.0, 0.0, inset) * extrude(sk, amount=height - 2.0 * inset)
    return body - cavity


def _magnet_pockets(body: Solid, layout: FaceLayout, params: HardwareParams) -> Solid:
    r = params.magnet_diameter / 2.0
    cy = layout.size / 2.0
    for sx in (
        layout.size / 2.0 - params.magnet_offset,
        layout.size / 2.0 + params.magnet_offset,
    ):
        hole = Cylinder(
            radius=r,
            height=params.magnet_depth,
            align=(Align.CENTER, Align.CENTER, Align.MIN),
        )
        body = body - Pos(sx, cy, 0.0) * hole
    return body


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #


def build_tile(
    marker_id: int,
    config: AssetsConfig,
    *,
    variant: str,
    height: float,
    params: HardwareParams | None = None,
    magnets: bool = False,
) -> TileParts:
    """Build the three colour solids for one gate tile."""
    params = params or HardwareParams()
    layout = face_layout(marker_id, config)
    fd = params.face_depth

    # --- solid body (white), with relief / hollow / magnets ------------------
    body = extrude(_footprint(layout), amount=height)
    body = _chamfer_bottom(body, params.bottom_chamfer)
    if height > params.hollow_min_height:
        body = _hollow(body, layout, params, height)
    if magnets:
        body = _magnet_pockets(body, layout, params)

    # --- top colour face: accent = slab - white-field - glyphs ---------------
    slab = _extrude_top(_footprint(layout), height, fd)
    white_field = _extrude_top(_white_field_sketch(layout), height, fd)
    accent = slab - white_field
    glyph_sk = _glyph_sketch(layout, config)
    glyph_solid = _extrude_top(glyph_sk, height, fd) if glyph_sk is not None else None
    if glyph_solid is not None:
        accent = accent - glyph_solid

    marker = _marker_solid(layout, height, fd, params.marker_bleed)

    # White body = everything that is neither accent nor marker.
    white_body = body - accent - marker

    return TileParts(
        layout=layout,
        variant=variant,
        height=height,
        body=white_body,
        marker=marker,
        accent=accent,
    )
