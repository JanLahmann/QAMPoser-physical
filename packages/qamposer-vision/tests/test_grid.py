"""Grid mapping tests: cell centres, tolerance window, off-grid rejection."""

from __future__ import annotations

import pytest

from qamposer_vision.board import BoardConfig
from qamposer_vision.grid import GridConfig, GridMapper


@pytest.fixture(scope="module")
def grid_config() -> GridConfig:
    return GridConfig.from_board_config(BoardConfig.from_toml())


def test_cell_center_layout(grid_config: GridConfig) -> None:
    # col 0, row 0 centre = offset + half cell.
    cx, cy = grid_config.cell_center(0, 0)
    assert cx == grid_config.grid_offset_x + grid_config.cell_size / 2.0
    assert cy == grid_config.grid_offset_y + grid_config.cell_size / 2.0
    # Adjacent column centre differs by exactly one pitch.
    cx1, _ = grid_config.cell_center(0, 1)
    assert cx1 - cx == grid_config.pitch


def test_exact_centers_assign(grid_config: GridConfig) -> None:
    mapper = GridMapper(grid_config)
    for row in range(grid_config.rows):
        for col in range(grid_config.cols):
            cx, cy = grid_config.cell_center(row, col)
            assert mapper.assign(cx, cy) == (row, col)


def test_small_offset_within_tolerance(grid_config: GridConfig) -> None:
    mapper = GridMapper(grid_config)
    cx, cy = grid_config.cell_center(2, 3)
    # Half the cell footprint (< half_window) → still assigned.
    assert mapper.assign(cx + 25.0, cy - 20.0) == (2, 3)


def test_gutter_is_rejected(grid_config: GridConfig) -> None:
    mapper = GridMapper(grid_config)
    cx, cy = grid_config.cell_center(1, 1)
    # In the pitch-vs-cell gutter (|dx| > cell_size/2) → rejected, not misfiled.
    off = grid_config.cell_size / 2.0 + 4.0
    assert mapper.assign(cx + off, cy) is None


def test_outside_lattice_is_rejected(grid_config: GridConfig) -> None:
    mapper = GridMapper(grid_config)
    assert mapper.assign(-50.0, -50.0) is None
    assert mapper.assign(100000.0, 100000.0) is None
    # Just left of column 0.
    cx, cy = grid_config.cell_center(0, 0)
    assert mapper.assign(cx - grid_config.pitch, cy) is None


def test_tolerance_scales_window(grid_config: GridConfig) -> None:
    cx, cy = grid_config.cell_center(0, 0)
    dx = grid_config.cell_size / 2.0 + 2.0  # just outside the cell footprint
    strict = GridMapper(grid_config, tolerance=1.0)
    loose = GridMapper(grid_config, tolerance=1.3)
    assert strict.assign(cx + dx, cy) is None
    assert loose.assign(cx + dx, cy) == (0, 0)
