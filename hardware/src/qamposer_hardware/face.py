"""Pure-geometry description of a tile's top face — no build123d dependency.

Everything here is derived from ``assets.toml`` (via :mod:`qamposer_assets.config`)
and the marker bit matrix (via :func:`qamposer_assets.marker_svg.marker_bit_matrix`),
so the 3D face can never drift from the printed 2D face. :mod:`build` consumes
this to place solids; the test-suite consumes it to assert geometry invariants
without slicing.

Coordinate convention
---------------------
The 2D face (``qamposer_assets``) uses SVG coordinates: origin top-left, ``y``
increasing *downward*. The 3D tile is built with its footprint in the first
quadrant, ``x`` right, ``y`` up, ``z`` up (top face at ``z = height``). The map
is ``X = x_svg`` and ``Y = size - y_svg`` — a vertical flip so a camera looking
straight down the ``-Z`` axis sees the face exactly as the SVG (marker
orientation preserved).
"""

from __future__ import annotations

from dataclasses import dataclass

from qamposer_assets.config import AssetsConfig
from qamposer_assets.marker_svg import marker_bit_matrix
from qamposer_vision.markers import MARKER_TABLE, ROTATION_ANGLES, GateSpec

__all__ = [
    "Rect",
    "ModuleCell",
    "FaceLayout",
    "accent_color_name",
    "face_layout",
    "notch_count",
    "COLOR_NAMES",
]

#: Depth of the coloured top face (last N mm of tile height) — the MMU colour
#: layer. Kept small so the body below stays single-colour white.
FACE_DEPTH = 0.8

#: assets.toml gate hex -> a human filament-slot name (for file names / plates).
COLOR_NAMES: dict[str, str] = {
    "#fa4d56": "red",
    "#002d9c": "blue",
    "#9f1853": "magenta",
    "#33b1ff": "cyan",
}


@dataclass(frozen=True, slots=True)
class Rect:
    """An axis-aligned rectangle in 3D face coordinates (mm), z implied by band."""

    cx: float
    cy: float
    w: float
    h: float

    @property
    def x0(self) -> float:
        return self.cx - self.w / 2.0

    @property
    def x1(self) -> float:
        return self.cx + self.w / 2.0

    @property
    def y0(self) -> float:
        return self.cy - self.h / 2.0

    @property
    def y1(self) -> float:
        return self.cy + self.h / 2.0

    @property
    def area(self) -> float:
        return self.w * self.h


@dataclass(frozen=True, slots=True)
class ModuleCell:
    """One ArUco module: its grid position and its 3D footprint rectangle."""

    row: int
    col: int
    bit: int  # 1 = black module, 0 = white
    rect: Rect


@dataclass(frozen=True, slots=True)
class FaceLayout:
    """Everything :mod:`build` needs to place the top-face colour regions."""

    marker_id: int
    spec: GateSpec
    size: float
    corner_radius: float
    frame_width: float
    band_height: float
    accent_hex: str
    accent_name: str
    white_field: Rect  # rounded, radius = corner_radius - frame_width
    inner_radius: float
    band: Rect  # the gate-colour label band (frame_width has no effect here)
    module_size: float
    modules: tuple[ModuleCell, ...]
    notch_count: int
    notches: tuple[Rect, ...]  # bottom-edge tactile slots (angle differentiation)
    label: str  # band caption text (e.g. "RX π/2"); "" for CNOT tiles

    @property
    def black_cells(self) -> tuple[tuple[int, int], ...]:
        """(row, col) of every black module — mirrors ``marker_bit_matrix``."""
        return tuple((m.row, m.col) for m in self.modules if m.bit == 1)


def _flip_y(size: float, y_svg: float) -> float:
    return size - y_svg


def notch_count(spec: GateSpec) -> int:
    """Tactile-notch count encoding a rotation angle (0 for non-rotation tiles).

    ``1 = π/4, 2 = π/2, 3 = π, 4 = -π/2`` — the index of the angle in
    :data:`qamposer_vision.markers.ROTATION_ANGLES`, plus one. Non-rotation
    gates (no ``parameter``) get 0 notches.
    """
    if spec.parameter is None:
        return 0
    for idx, angle in enumerate(ROTATION_ANGLES):
        if abs(angle - spec.parameter) < 1e-9:
            return idx + 1
    return 0


def accent_color_name(hex_color: str) -> str:
    """Human filament-slot name for a gate hex (falls back to the bare hex)."""
    return COLOR_NAMES.get(hex_color.lower(), hex_color.lstrip("#").lower())


def _notch_rects(
    size: float, count: int, *, width: float = 1.6, depth: float = 1.5, pitch: float = 4.0
) -> tuple[Rect, ...]:
    """`count` slots centred on the bottom edge (y = 0), each cut ``depth`` in.

    Represented as rectangles centred on ``y = 0`` with full height ``2*depth``
    so that, when subtracted from the footprint, they always reach the edge and
    leave a clean ``depth``-deep slot inside the band.
    """
    if count <= 0:
        return ()
    rects: list[Rect] = []
    span = (count - 1) * pitch
    x0 = size / 2.0 - span / 2.0
    for i in range(count):
        cx = x0 + i * pitch
        rects.append(Rect(cx=cx, cy=0.0, w=width, h=2.0 * depth))
    return tuple(rects)


def face_layout(marker_id: int, config: AssetsConfig) -> FaceLayout:
    """Build the :class:`FaceLayout` for a gate tile.

    Raises ``ValueError`` if ``marker_id`` is not a gate tile (corners 0-3 have
    no printable gate face).
    """
    spec = MARKER_TABLE[marker_id]
    if spec.kind != "gate":
        raise ValueError(f"marker {marker_id} is not a gate tile ({spec.label})")

    t = config.tile
    size = t.size
    accent_hex = config.colors.for_gate(spec.gate)
    inner_radius = max(t.corner_radius - t.frame_width, 0.0)

    # White field (SVG: x=frame_width, y=frame_width, w=size-2fw, h=band_top-fw).
    field_w = size - 2 * t.frame_width
    field_h = t.band_top - t.frame_width
    field_cx = size / 2.0
    field_cy = _flip_y(size, t.frame_width + field_h / 2.0)
    white_field = Rect(cx=field_cx, cy=field_cy, w=field_w, h=field_h)

    # Label band (SVG: y in [band_top, size], full width).
    band_cx = size / 2.0
    band_cy = _flip_y(size, t.band_top + t.band_height / 2.0)
    band = Rect(cx=band_cx, cy=band_cy, w=size, h=t.band_height)

    # Marker modules from the exact OpenCV bit matrix.
    matrix = marker_bit_matrix(marker_id, config.aruco_dictionary)
    n = len(matrix)
    module = t.marker_size / n
    cells: list[ModuleCell] = []
    for r, row in enumerate(matrix):
        for c, bit in enumerate(row):
            x0 = t.marker_x + c * module
            y_svg_top = t.marker_y + r * module
            cx = x0 + module / 2.0
            cy = _flip_y(size, y_svg_top + module / 2.0)
            cells.append(
                ModuleCell(
                    row=r,
                    col=c,
                    bit=int(bit),
                    rect=Rect(cx=cx, cy=cy, w=module, h=module),
                )
            )

    nc = notch_count(spec)
    notches = _notch_rects(size, nc)

    label = "" if spec.gate == "CNOT" else _band_label(spec)

    return FaceLayout(
        marker_id=marker_id,
        spec=spec,
        size=size,
        corner_radius=t.corner_radius,
        frame_width=t.frame_width,
        band_height=t.band_height,
        accent_hex=accent_hex,
        accent_name=accent_color_name(accent_hex),
        white_field=white_field,
        inner_radius=inner_radius,
        band=band,
        module_size=module,
        modules=tuple(cells),
        notch_count=nc,
        notches=notches,
        label=label,
    )


def _band_label(spec: GateSpec) -> str:
    """Reuse the 2D face's caption logic so 3D and print never diverge."""
    from qamposer_assets.tile_face import tile_label

    return tile_label(spec)
