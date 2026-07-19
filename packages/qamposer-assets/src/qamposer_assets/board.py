"""Render the board mat — the play surface that reads like an empty circuit.

Two variants:

* :func:`board_svg` — the full 720×500 mm mat as a single page (print shops, A1).
* :func:`board_tiled_svgs` — the same mat sliced across A4/A3 pages with a 2 mm
  overlap and registration marks, for printing at home and taping together.

Neutral IBM-Carbon greys keep the structure quiet so the coloured tiles pop.
Corner ArUco markers (IDs 0-3) define the homography rectangle for the vision
pipeline; their geometry comes straight from ``assets.toml``.
"""

from __future__ import annotations

import math

from qamposer_vision.markers import CORNER_IDS

from .config import AssetsConfig
from .marker_svg import marker_group
from .paper import page_size
from .svgbase import (
    fmt,
    line,
    rect,
    registration_marks,
    svg_document,
)
from .symbols import control_dot, ket_zero, target_cross, text

__all__ = ["board_body", "board_svg", "board_tiled_svgs"]

# Grid dash: 1 pt ≈ 0.35 mm line, dashed.
_GRID_STROKE = 0.35
_WIRE_STROKE = 1.2


def _corner_positions(cfg: AssetsConfig) -> dict[int, tuple[float, float]]:
    """Top-left (x, y) of each corner marker keyed by marker ID (0-3)."""
    b = cfg.board
    m, s = b.corner_margin, b.corner_marker_size
    right = b.mat_width - m - s
    bottom = b.mat_height - m - s
    # CORNER_IDS: 0=TL, 1=TR, 2=BR, 3=BL
    return {
        0: (m, m),
        1: (right, m),
        2: (right, bottom),
        3: (m, bottom),
    }


def _grid_group(cfg: AssetsConfig) -> str:
    b = cfg.board
    n = cfg.colors.neutral
    parts = ['<g id="grid">']
    for r in range(b.rows):
        for c in range(b.cols):
            ox, oy = cfg.board.cell_origin(r, c)
            parts.append(
                rect(
                    ox,
                    oy,
                    b.cell_size,
                    b.cell_size,
                    fill="#ffffff",
                    stroke=n.grid,
                    stroke_width=_GRID_STROKE,
                    rx=1.0,
                    dash="2,2",
                )
            )
    parts.append("</g>")
    return "".join(parts)


def _wires_group(cfg: AssetsConfig) -> str:
    b = cfg.board
    n = cfg.colors.neutral
    x0 = b.grid_offset_x
    x1 = b.grid_offset_x + b.grid_width
    parts = ['<g id="wires">']
    for r in range(b.rows):
        _, cy = cfg.board.cell_center(r, 0)
        parts.append(
            line(x0, cy, x1, cy, stroke=n.wire, stroke_width=_WIRE_STROKE)
        )
    parts.append("</g>")
    return "".join(parts)


def _labels_group(cfg: AssetsConfig) -> str:
    b = cfg.board
    n = cfg.colors.neutral
    fam = cfg.typography.font_family
    cap = cfg.typography.row_label_cap_height
    font = cap / 0.72
    parts = ['<g id="labels">']

    # Row labels: "q0 |0⟩" … right-aligned just left of the grid. The ket is
    # drawn as vector shapes (U+27E9 tofus in most print fonts).
    label_right = b.grid_offset_x - 6.0
    ket_cap = cap * 0.92
    for r in range(b.rows):
        _, cy = cfg.board.cell_center(r, 0)
        ket_svg, ket_w = ket_zero(0.0, cy, ket_cap, color=n.label)
        ket_x = label_right - ket_w
        ket_svg, _ = ket_zero(ket_x, cy, ket_cap, color=n.label)
        parts.append(ket_svg)
        parts.append(
            text(
                ket_x - 0.45 * cap,
                cy,
                f"q{r}",
                size=font,
                color=n.label,
                family=fam,
                anchor="end",
            )
        )

    # Column numbers 1..8 above the grid.
    col_font = 5.0 / 0.72
    col_y = b.grid_offset_y - 7.0
    for c in range(b.cols):
        cx, _ = cfg.board.cell_center(0, c)
        parts.append(
            text(
                cx,
                col_y,
                str(c + 1),
                size=col_font,
                color=n.faint,
                family=fam,
                weight="normal",
            )
        )
    parts.append("</g>")
    return "".join(parts)


def _corners_group(cfg: AssetsConfig) -> str:
    b = cfg.board
    parts = ['<g id="corners">']
    for marker_id, (x, y) in _corner_positions(cfg).items():
        parts.append(
            marker_group(
                marker_id,
                x,
                y,
                b.corner_marker_size,
                dictionary=cfg.aruco_dictionary,
                group_id=f"corner-{CORNER_IDS[marker_id]}",
                with_background=True,
            )
        )
    parts.append("</g>")
    return "".join(parts)


def _header_group(cfg: AssetsConfig) -> str:
    b = cfg.board
    n = cfg.colors.neutral
    fam = cfg.typography.font_family
    cx = b.mat_width / 2.0
    word_font = 24.0 / 0.72  # 24 mm caps
    parts = [
        '<g id="header">',
        text(cx, 28.0, "Entangible", size=word_font, color=n.ink, family=fam),
        text(
            cx,
            48.0,
            "the QAMPoser physical quantum circuit composer",
            size=5.0,
            color=n.label,
            family=fam,
            weight="normal",
        ),
        "</g>",
    ]
    return "".join(parts)


def _footer_group(cfg: AssetsConfig) -> str:
    b = cfg.board
    n = cfg.colors.neutral
    c = cfg.colors
    fam = cfg.typography.font_family
    cx = b.mat_width / 2.0
    # Vertical band between the grid bottom and the bottom corner markers.
    grid_bottom = b.grid_offset_y + b.grid_height
    y = grid_bottom + (b.mat_height - b.corner_margin - grid_bottom) / 2.0

    rule = "placed in the same column link into a CNOT"
    rule_font = 4.6
    r = 1.8
    # Glyph cluster ●—⊕ then the text, centred as one line.
    cluster_w = 2 * r + 5.0 + 2 * r  # dot + dash + cross
    text_w = len(rule) * rule_font * 0.52
    start_x = cx - (cluster_w + 3.0 + text_w) / 2.0
    ry = y - 3.0
    dot_cx = start_x + r
    cross_cx = start_x + cluster_w - r
    dot = control_dot(dot_cx, ry, r, fill=c.CNOT)
    cross = target_cross(cross_cx, ry, r, color=c.CNOT)
    dash = line(dot_cx + r, ry, cross_cx - r, ry, stroke=c.CNOT, stroke_width=0.6)
    parts = [
        '<g id="footer">',
        dot,
        dash,
        cross,
        text(
            start_x + cluster_w + 3.0,
            ry,
            rule,
            size=rule_font,
            color=n.label,
            family=fam,
            weight="normal",
            anchor="start",
        ),
        text(
            cx,
            y + 6.0,
            "entangible.org   ·   qamposer.org   ·   rasqberry.org",
            size=4.0,
            color=n.faint,
            family=fam,
            weight="normal",
        ),
        "</g>",
    ]
    return "".join(parts)


def board_body(cfg: AssetsConfig) -> str:
    """Inner SVG for the mat (no root ``<svg>``), origin at the mat top-left."""
    b = cfg.board
    background = rect(0, 0, b.mat_width, b.mat_height, fill="#ffffff")
    return (
        f'<g id="board">{background}'
        + _grid_group(cfg)
        + _wires_group(cfg)
        + _labels_group(cfg)
        + _header_group(cfg)
        + _footer_group(cfg)
        + _corners_group(cfg)
        + "</g>"
    )


def board_svg(cfg: AssetsConfig) -> str:
    """The full mat as a single-page SVG document (720×500 mm)."""
    b = cfg.board
    return svg_document(
        b.mat_width, b.mat_height, board_body(cfg), title="Entangible board mat"
    )


def board_tiled_svgs(
    cfg: AssetsConfig,
    page_format: str = "A4",
    *,
    overlap: float = 2.0,
    margin: float = 10.0,
) -> list[str]:
    """Slice the mat across pages of ``page_format`` (landscape).

    Each page shows a window of the mat, offset by (content − ``overlap``) from
    its neighbours, with registration marks (crop marks + centrelines) in the
    margin so pages can be trimmed and aligned edge-to-edge.
    """
    b = cfg.board
    pw, ph = page_size(page_format, landscape=True)
    content_w = pw - 2 * margin
    content_h = ph - 2 * margin
    step_x = content_w - overlap
    step_y = content_h - overlap

    ncols = max(1, math.ceil((b.mat_width - overlap) / step_x))
    nrows = max(1, math.ceil((b.mat_height - overlap) / step_y))

    fam = cfg.typography.font_family
    ink = cfg.colors.neutral.label
    body = board_body(cfg)

    pages: list[str] = []
    for i in range(nrows):
        for j in range(ncols):
            ox = j * step_x
            oy = i * step_y
            clip_id = f"clip-{i}-{j}"
            page_body = (
                f'<clipPath id="{clip_id}">'
                f'<rect x="{fmt(margin)}" y="{fmt(margin)}" '
                f'width="{fmt(content_w)}" height="{fmt(content_h)}" />'
                f"</clipPath>"
                f'<g clip-path="url(#{clip_id})">'
                f'<g transform="translate({fmt(margin - ox)},{fmt(margin - oy)})">'
                f"{body}</g></g>"
                + registration_marks(margin, margin, content_w, content_h)
                + text(
                    margin,
                    margin - 3.0,
                    f"Entangible mat — page r{i + 1}c{j + 1} of "
                    f"{nrows}×{ncols} ({page_format})",
                    size=3.2,
                    color=ink,
                    family=fam,
                    weight="normal",
                    anchor="start",
                    baseline="alphabetic",
                )
            )
            pages.append(
                svg_document(
                    pw,
                    ph,
                    page_body,
                    title=f"Entangible mat page {i + 1},{j + 1}",
                )
            )
    return pages
