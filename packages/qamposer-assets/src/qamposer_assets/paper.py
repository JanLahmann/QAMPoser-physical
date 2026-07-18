"""Paper sizes (millimetres) and a 100 mm calibration ruler helper."""

from __future__ import annotations

from .svgbase import fmt, line
from .symbols import text

__all__ = ["PAGE_SIZES", "page_size", "calibration_ruler"]

#: ISO/US paper sizes in portrait orientation, (width, height) mm.
PAGE_SIZES: dict[str, tuple[float, float]] = {
    "A4": (210.0, 297.0),
    "A3": (297.0, 420.0),
    "Letter": (215.9, 279.4),
}


def page_size(name: str, *, landscape: bool = False) -> tuple[float, float]:
    """Return (width, height) mm for ``name``, optionally rotated to landscape."""
    try:
        w, h = PAGE_SIZES[name]
    except KeyError as exc:
        raise ValueError(
            f"unknown page format {name!r}; choose from {sorted(PAGE_SIZES)}"
        ) from exc
    return (h, w) if landscape else (w, h)


def calibration_ruler(
    x: float,
    y: float,
    *,
    length: float = 100.0,
    color: str,
    family: str,
    height: float = 3.0,
) -> str:
    """A 100 mm ruler with 10 mm ticks so staff can verify 1:1 print scale."""
    parts = [
        line(x, y, x + length, y, stroke=color, stroke_width=0.3),
    ]
    step = 10.0
    n = int(round(length / step))
    for i in range(n + 1):
        tx = x + i * step
        tick = height if i % (n) == 0 or i == 0 else height * 0.6
        parts.append(line(tx, y, tx, y + tick, stroke=color, stroke_width=0.3))
    parts.append(
        text(
            x + length + 3,
            y + height,
            f"{fmt(length)} mm",
            size=3.2,
            color=color,
            family=family,
            weight="normal",
            anchor="start",
            baseline="alphabetic",
        )
    )
    return "".join(parts)
