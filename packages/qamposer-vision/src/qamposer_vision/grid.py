"""Grid mapping: board-mm coordinates -> ``(row, col)`` cells.

The mat is a ``rows x cols`` lattice of cells whose centres are laid out from
``grid_offset_{x,y}`` at a fixed ``pitch`` (all in board mm, from
``assets.toml``). A tile is assigned to a cell only when its marker centre
falls inside that cell's acceptance window; anything landing in the gutter
between cells, or off the board entirely, is **rejected** rather than misfiled
(design.md: "Cell mapping rejects off-grid tiles instead of misfiling").
"""

from __future__ import annotations

from dataclasses import dataclass

from .board import BoardConfig

__all__ = ["GridConfig", "GridMapper"]


@dataclass(frozen=True, slots=True)
class GridConfig:
    """Lattice geometry needed to place a board-mm point into a cell."""

    rows: int
    cols: int
    pitch: float
    cell_size: float
    grid_offset_x: float
    grid_offset_y: float

    @classmethod
    def from_board_config(cls, config: BoardConfig) -> "GridConfig":
        return cls(
            rows=config.rows,
            cols=config.cols,
            pitch=config.pitch,
            cell_size=config.cell_size,
            grid_offset_x=config.grid_offset_x,
            grid_offset_y=config.grid_offset_y,
        )

    def cell_center(self, row: int, col: int) -> tuple[float, float]:
        """Board-mm coordinates of the centre of cell ``(row, col)``."""
        cx = self.grid_offset_x + self.cell_size / 2.0 + self.pitch * col
        cy = self.grid_offset_y + self.cell_size / 2.0 + self.pitch * row
        return cx, cy


class GridMapper:
    """Maps board-mm points to cells with a tolerant, gutter-rejecting window.

    ``tolerance`` scales the half-cell acceptance window on each axis. With the
    default of ``1.0`` a marker is accepted only if it lands within the cell's
    own footprint (``+/- cell_size/2`` of the centre); the ``pitch - cell_size``
    gutter between cells is a dead zone, so off-grid tiles are rejected.
    """

    def __init__(self, config: GridConfig, tolerance: float = 1.0) -> None:
        self.config = config
        self.tolerance = tolerance

    def assign(self, x_mm: float, y_mm: float) -> tuple[int, int] | None:
        """Return the ``(row, col)`` a board-mm point belongs to, or ``None``.

        ``None`` means the point is outside the lattice or lies in the gutter
        beyond the tolerance window — an off-grid tile that must be rejected.
        """
        cfg = self.config
        half_window = (cfg.cell_size / 2.0) * self.tolerance

        # Nearest column/row index by the lattice spacing.
        col = round((x_mm - (cfg.grid_offset_x + cfg.cell_size / 2.0)) / cfg.pitch)
        row = round((y_mm - (cfg.grid_offset_y + cfg.cell_size / 2.0)) / cfg.pitch)
        if not (0 <= col < cfg.cols and 0 <= row < cfg.rows):
            return None

        cx, cy = cfg.cell_center(row, col)
        if abs(x_mm - cx) <= half_window and abs(y_mm - cy) <= half_window:
            return int(row), int(col)
        return None
