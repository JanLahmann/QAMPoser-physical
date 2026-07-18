"""Bed packing math for multi-piece print plates — pure, no build123d.

A *filament plate* (the ``plates.md`` grouping) can hold more pieces than fit on
one physical print bed, so it is split into numbered **batches**, each a grid of
60 x 60 mm pieces (plus inter-piece ``spacing``) centred on the bed. This module
is deliberately geometry-only so the packing invariants (capacity, splitting,
centring, no overlap, in-bounds) can be tested without slicing or building solids.

Bed coordinates: origin at the bottom-left corner ``(0, 0)``, ``x`` right, ``y``
up; a piece is described by its **centre** point. Pieces are laid **row-major**
with the first row along the **top** edge of the centred grid.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil, floor

__all__ = [
    "FOOTPRINT",
    "Bed",
    "parse_bed",
    "bed_capacity",
    "pack_positions",
    "plan_batches",
]

#: Piece edge length (mm). The tiles/cubes are 60 x 60 mm in footprint
#: (``assets.toml`` tile size); every variant shares this footprint.
FOOTPRINT = 60.0


@dataclass(frozen=True, slots=True)
class Bed:
    """A rectangular print bed (mm)."""

    width: float
    height: float


def parse_bed(text: str) -> Bed:
    """Parse a ``"WIDTHxHEIGHT"`` string (e.g. ``"250x220"``) into a :class:`Bed`."""
    parts = text.lower().replace(" ", "").split("x")
    if len(parts) != 2:
        raise ValueError(f"bed must look like '250x220', got {text!r}")
    try:
        w, h = float(parts[0]), float(parts[1])
    except ValueError as exc:
        raise ValueError(f"bed must look like '250x220', got {text!r}") from exc
    if w <= 0 or h <= 0:
        raise ValueError(f"bed dimensions must be positive, got {text!r}")
    return Bed(w, h)


def bed_capacity(
    bed: Bed, footprint: float = FOOTPRINT, spacing: float = 8.0
) -> tuple[int, int]:
    """``(cols, rows)`` of 60 mm pieces that fit on ``bed`` with ``spacing`` gaps.

    ``n`` pieces in a line occupy ``n*footprint + (n-1)*spacing`` mm, so the
    count is ``floor((extent + spacing) / (footprint + spacing))``.
    """
    pitch = footprint + spacing
    cols = int(floor((bed.width + spacing) / pitch))
    rows = int(floor((bed.height + spacing) / pitch))
    return max(cols, 0), max(rows, 0)


def pack_positions(
    count: int, bed: Bed, footprint: float = FOOTPRINT, spacing: float = 8.0
) -> list[tuple[float, float]]:
    """Centre points for ``count`` pieces on one bed, row-major, centred.

    Rows fill top-to-bottom; the whole (possibly partial) grid is centred on the
    bed, and each row is itself horizontally centred so a partial last row sits in
    the middle. Raises ``ValueError`` if ``count`` exceeds the bed capacity.
    """
    cols, rows = bed_capacity(bed, footprint, spacing)
    per_bed = cols * rows
    if count < 0:
        raise ValueError(f"count must be ≥ 0, got {count}")
    if count > per_bed:
        raise ValueError(
            f"{count} pieces exceed bed capacity {per_bed} ({cols}x{rows})"
        )
    if count == 0:
        return []

    pitch = footprint + spacing
    rows_used = ceil(count / cols)
    grid_h = rows_used * footprint + (rows_used - 1) * spacing
    y_top = (bed.height + grid_h) / 2.0  # top edge of the centred grid (y up)

    positions: list[tuple[float, float]] = []
    for i in range(count):
        r, c = divmod(i, cols)
        items_in_row = min(cols, count - r * cols)
        grid_w = items_in_row * footprint + (items_in_row - 1) * spacing
        x_left = (bed.width - grid_w) / 2.0
        cx = x_left + footprint / 2.0 + c * pitch
        cy = y_top - footprint / 2.0 - r * pitch
        positions.append((cx, cy))
    return positions


def plan_batches(
    count: int, bed: Bed, footprint: float = FOOTPRINT, spacing: float = 8.0
) -> list[list[tuple[float, float]]]:
    """Split ``count`` pieces into per-bed batches of centre-point lists.

    Each batch holds up to ``cols*rows`` pieces; the last batch may be partial.
    Raises ``ValueError`` if not even a single piece fits on the bed.
    """
    cols, rows = bed_capacity(bed, footprint, spacing)
    per_bed = cols * rows
    if per_bed <= 0:
        raise ValueError(
            f"bed {bed.width:g}x{bed.height:g} mm cannot fit a {footprint:g} mm piece"
        )
    batches: list[list[tuple[float, float]]] = []
    remaining = count
    while remaining > 0:
        n = min(per_bed, remaining)
        batches.append(pack_positions(n, bed, footprint, spacing))
        remaining -= n
    return batches
