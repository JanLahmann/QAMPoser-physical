"""assets.toml loads with the expected colours and self-consistent geometry."""

from __future__ import annotations

from qamposer_assets.config import load_config


def test_loads_from_repo_root():
    cfg = load_config()
    assert cfg.source_path.name == "assets.toml"
    assert cfg.aruco_dictionary == "DICT_4X4_50"


def test_gate_colors_match_qamposer_react():
    # Exactly @qamposer/react GATE_COLORS (CircuitEditor.tsx).
    c = load_config().colors
    assert c.H == "#fa4d56"
    assert c.X == "#002d9c"
    assert c.Y == "#9f1853"
    assert c.Z == "#33b1ff"
    assert c.RX == "#9f1853"
    assert c.RY == "#9f1853"
    assert c.RZ == "#33b1ff"
    assert c.CNOT == "#002d9c"
    assert c.for_gate("H") == "#fa4d56"


def test_neutral_colors_present():
    n = load_config().colors.neutral
    for value in (n.grid, n.wire, n.label, n.faint, n.ink):
        assert value.startswith("#") and len(value) == 7


def test_marker_and_quiet_zones_fit_inside_tile():
    t = load_config().tile
    # Marker + the minimum quiet zone must fit within the tile.
    assert t.marker_size + 2 * t.min_quiet_zone <= t.size
    # Marker sits horizontally inside the coloured frame.
    assert t.marker_x >= t.frame_width
    assert t.marker_x + t.marker_size <= t.size - t.frame_width
    # Marker (top + below quiet zone) sits above the label band.
    assert t.marker_top >= t.frame_width
    assert t.marker_top + t.marker_size + t.min_quiet_zone <= t.size
    # Band is a strip along the bottom.
    assert 0 < t.band_height < t.size
    assert t.band_top == t.size - t.band_height


def test_board_grid_fits_the_mat():
    b = load_config().board
    assert b.grid_offset_x + b.grid_width <= b.mat_width
    assert b.grid_offset_y + b.grid_height <= b.mat_height
    assert b.rows == 5 and b.cols == 8
