"""Vector gate glyphs and text helpers.

CNOT control (``●``) and target (``⊕``) are drawn as **vector shapes** rather
than font glyphs — font fallbacks for these code points are unreliable and
would break silently in print. Everything else (gate letters, rotation labels)
is rendered as ``<text>`` using the configured font stack, which *does* fall
back safely (cairo substitutes a sans-serif if IBM Plex Sans is absent).
"""

from __future__ import annotations

from .svgbase import esc, fmt

__all__ = [
    "control_dot",
    "target_cross",
    "ket_zero",
    "text",
    "CROSS_STROKE_FRACTION",
]

#: Target-cross / circle stroke as a fraction of the glyph height (spec: 12 %).
CROSS_STROKE_FRACTION = 0.12


def control_dot(cx: float, cy: float, radius: float, *, fill: str) -> str:
    """Filled control dot ``●`` centred at (cx, cy)."""
    return (
        f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(radius)}" '
        f'fill="{fill}" />'
    )


def target_cross(
    cx: float,
    cy: float,
    radius: float,
    *,
    color: str,
    stroke: float | None = None,
) -> str:
    """Target glyph ``⊕``: an open circle with a centred cross.

    ``stroke`` defaults to 12 % of the glyph height (``2 * radius``).
    """
    if stroke is None:
        stroke = CROSS_STROKE_FRACTION * (2.0 * radius)
    circle = (
        f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(radius)}" '
        f'fill="none" stroke="{color}" stroke-width="{fmt(stroke)}" />'
    )
    horiz = (
        f'<line x1="{fmt(cx - radius)}" y1="{fmt(cy)}" '
        f'x2="{fmt(cx + radius)}" y2="{fmt(cy)}" '
        f'stroke="{color}" stroke-width="{fmt(stroke)}" stroke-linecap="butt" />'
    )
    vert = (
        f'<line x1="{fmt(cx)}" y1="{fmt(cy - radius)}" '
        f'x2="{fmt(cx)}" y2="{fmt(cy + radius)}" '
        f'stroke="{color}" stroke-width="{fmt(stroke)}" stroke-linecap="butt" />'
    )
    return circle + horiz + vert


def ket_zero(x_left: float, cy: float, cap: float, *, color: str) -> tuple[str, float]:
    """Vector ``|0⟩`` glyph (bar, zero, angle bracket) of height ``cap``.

    Drawn as shapes because U+27E9 has no glyph in many fonts and tofus in
    print. Returns ``(svg, width)``; the glyph spans ``x_left … x_left+width``
    and is vertically centred on ``cy``.
    """
    s = 0.09 * cap
    half = cap / 2.0
    gap = 0.30 * cap
    rx, ry = 0.30 * cap, 0.48 * cap

    bar_x = x_left + s / 2.0
    bar = (
        f'<line x1="{fmt(bar_x)}" y1="{fmt(cy - half)}" '
        f'x2="{fmt(bar_x)}" y2="{fmt(cy + half)}" '
        f'stroke="{color}" stroke-width="{fmt(s)}" stroke-linecap="round" />'
    )
    zero_cx = bar_x + s / 2.0 + gap + rx
    zero = (
        f'<ellipse cx="{fmt(zero_cx)}" cy="{fmt(cy)}" rx="{fmt(rx)}" ry="{fmt(ry)}" '
        f'fill="none" stroke="{color}" stroke-width="{fmt(s)}" />'
    )
    chev_x = zero_cx + rx + gap
    chev_w = 0.38 * cap
    chevron = (
        f'<polyline points="{fmt(chev_x)},{fmt(cy - half)} '
        f'{fmt(chev_x + chev_w)},{fmt(cy)} {fmt(chev_x)},{fmt(cy + half)}" '
        f'fill="none" stroke="{color}" stroke-width="{fmt(s)}" '
        f'stroke-linecap="round" stroke-linejoin="round" />'
    )
    width = (chev_x + chev_w + s / 2.0) - x_left
    return bar + zero + chevron, width


def text(
    x: float,
    y: float,
    content: str,
    *,
    size: float,
    color: str,
    family: str,
    weight: str = "bold",
    anchor: str = "middle",
    baseline: str = "central",
    letter_spacing: float | None = None,
) -> str:
    """A ``<text>`` element (font-size in mm user units)."""
    spacing = (
        f' letter-spacing="{fmt(letter_spacing)}"'
        if letter_spacing is not None
        else ""
    )
    return (
        f'<text x="{fmt(x)}" y="{fmt(y)}" '
        f'font-family="{esc(family)}" font-size="{fmt(size)}" '
        f'font-weight="{weight}" fill="{color}" '
        f'text-anchor="{anchor}" dominant-baseline="{baseline}"{spacing}>'
        f"{esc(content)}</text>"
    )
