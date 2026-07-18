"""Low-level SVG primitives shared by tile / board / sheet renderers.

Every generated document uses **millimetre user units**: the root ``<svg>`` sets
``width``/``height`` in ``mm`` and a ``viewBox`` whose numbers equal the mm
extent, so every coordinate, stroke width and font-size in the body is a real
millimetre value. This keeps 1:1 print scale automatic and lets the vision
geometry in ``assets.toml`` be used verbatim.
"""

from __future__ import annotations

from xml.sax.saxutils import escape

__all__ = [
    "svg_document",
    "esc",
    "fmt",
    "rect",
    "line",
    "crop_marks",
    "registration_marks",
]

_SVG_NS = "http://www.w3.org/2000/svg"


def fmt(value: float) -> str:
    """Format a millimetre number compactly (strip trailing zeros)."""
    return f"{value:.4f}".rstrip("0").rstrip(".")


def esc(text: str) -> str:
    """XML-escape text content."""
    return escape(text)


def svg_document(width: float, height: float, body: str, *, title: str | None = None) -> str:
    """Wrap ``body`` in a mm-unit root ``<svg>`` element."""
    title_el = f"<title>{esc(title)}</title>" if title else ""
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="{_SVG_NS}" '
        f'width="{fmt(width)}mm" height="{fmt(height)}mm" '
        f'viewBox="0 0 {fmt(width)} {fmt(height)}">'
        f"{title_el}{body}</svg>\n"
    )


def rect(
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    fill: str = "none",
    stroke: str = "none",
    stroke_width: float = 0.0,
    rx: float | None = None,
    dash: str | None = None,
    extra: str = "",
) -> str:
    """A ``<rect>`` element."""
    parts = [
        f'x="{fmt(x)}"',
        f'y="{fmt(y)}"',
        f'width="{fmt(w)}"',
        f'height="{fmt(h)}"',
        f'fill="{fill}"',
    ]
    if stroke != "none":
        parts.append(f'stroke="{stroke}"')
        parts.append(f'stroke-width="{fmt(stroke_width)}"')
    if rx is not None:
        parts.append(f'rx="{fmt(rx)}"')
    if dash is not None:
        parts.append(f'stroke-dasharray="{dash}"')
    if extra:
        parts.append(extra)
    return "<rect " + " ".join(parts) + " />"


def line(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    *,
    stroke: str,
    stroke_width: float,
    dash: str | None = None,
    cap: str = "butt",
) -> str:
    """A ``<line>`` element."""
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<line x1="{fmt(x1)}" y1="{fmt(y1)}" x2="{fmt(x2)}" y2="{fmt(y2)}" '
        f'stroke="{stroke}" stroke-width="{fmt(stroke_width)}" '
        f'stroke-linecap="{cap}"{dash_attr} />'
    )


def crop_marks(
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    length: float = 3.0,
    gap: float = 0.0,
    stroke: str = "#000000",
    stroke_width: float = 0.2,
) -> str:
    """Four L-shaped corner crop marks around the rectangle (x, y, w, h).

    Marks sit *outside* the rectangle so the cut line is unobstructed.
    """
    x2, y2 = x + w, y + h
    segs: list[str] = []

    def mark(cx: float, cy: float, dx: int, dy: int) -> None:
        # Horizontal arm and vertical arm pointing outward from the corner.
        segs.append(
            line(
                cx + dx * gap,
                cy,
                cx + dx * (gap + length),
                cy,
                stroke=stroke,
                stroke_width=stroke_width,
            )
        )
        segs.append(
            line(
                cx,
                cy + dy * gap,
                cx,
                cy + dy * (gap + length),
                stroke=stroke,
                stroke_width=stroke_width,
            )
        )

    mark(x, y, -1, -1)
    mark(x2, y, 1, -1)
    mark(x2, y2, 1, 1)
    mark(x, y2, -1, 1)
    return "".join(segs)


def registration_marks(
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    length: float = 5.0,
    stroke: str = "#000000",
    stroke_width: float = 0.2,
) -> str:
    """Crop marks at the corners plus centreline ticks on each edge.

    Used on tiled multi-page output so pages can be aligned edge-to-edge.
    """
    cx, cy = x + w / 2.0, y + h / 2.0
    ticks = [
        line(cx, y - length, cx, y, stroke=stroke, stroke_width=stroke_width),
        line(cx, y + h, cx, y + h + length, stroke=stroke, stroke_width=stroke_width),
        line(x - length, cy, x, cy, stroke=stroke, stroke_width=stroke_width),
        line(x + w, cy, x + w + length, cy, stroke=stroke, stroke_width=stroke_width),
    ]
    return crop_marks(
        x, y, w, h, length=length, stroke=stroke, stroke_width=stroke_width
    ) + "".join(ticks)
