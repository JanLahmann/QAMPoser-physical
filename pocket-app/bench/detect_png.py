"""Reference OpenCV detection on PNGs, for the pocket marker benchmark.

Runs the *real* ``qamposer_vision`` pipeline front end (ArUco detect -> board
homography -> grid assignment) on each given PNG and prints, as JSON, the set of
on-grid tile placements ``[marker_id, row, col]`` it recovered. The pocket TS
benchmark writes its degraded frames to disk and calls this on the *identical*
files, so the two detectors are compared on exactly the same pixels.

Usage::

    uv run python pocket-app/bench/detect_png.py frame1.png frame2.png ...

Output (stdout): ``{"frame1.png": [[10,0,0],[14,0,1],...], ...}``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from qamposer_vision.board import BoardConfig, fit_board  # noqa: E402
from qamposer_vision.detector import ArucoDetector  # noqa: E402
from qamposer_vision.grid import GridConfig, GridMapper  # noqa: E402
from qamposer_vision.markers import CORNER_IDS, MARKER_TABLE  # noqa: E402


def detect_placements(
    path: str,
    detector: ArucoDetector,
    config: BoardConfig,
    grid: GridMapper,
) -> list[list[int]]:
    image = cv2.imread(path)
    if image is None:
        return []
    markers = detector.detect(image)
    board = fit_board(markers, config)
    if board is None:
        return []
    out: list[list[int]] = []
    for marker in markers:
        if marker.id in CORNER_IDS or marker.id not in MARKER_TABLE:
            continue
        bx, by = board.image_to_board(marker.center)[0]
        cell = grid.assign(float(bx), float(by))
        if cell is None:
            continue
        out.append([int(marker.id), int(cell[0]), int(cell[1])])
    return out


def main(paths: list[str]) -> None:
    config = BoardConfig.from_toml()
    detector = ArucoDetector()
    grid = GridMapper(GridConfig.from_board_config(config))
    result = {p: detect_placements(p, detector, config, grid) for p in paths}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
