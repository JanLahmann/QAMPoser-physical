"""``qamposer-vision`` command-line entry point.

M1 subcommand::

    qamposer-vision detect --image PATH [--json] [--qasm]
                           [--annotated OUT.png] [--pretty]

Runs the full static-image detect path (ArUco -> board homography -> grid ->
circuit) and prints the ``@qamposer/react`` Circuit JSON and/or the OpenQASM 2
text to stdout, with structured warnings on stderr. Exits non-zero when no
board is found (fewer than three corner markers).

The orchestration lives here (not in ``pipeline.py``, which stays an M2 stub):
:func:`detect_circuit` is a reusable image -> result helper shared by the tests.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from .board import BoardConfig, BoardResult, fit_board
from .circuit_builder import BuildWarning, TilePlacement, build_circuit
from .detector import ArucoDetector, DetectedMarker
from .grid import GridConfig, GridMapper
from .markers import CORNER_IDS, MARKER_TABLE
from .qasm import circuit_to_qasm

__all__ = ["DetectionResult", "detect_circuit", "annotate_frame", "main"]


@dataclass(slots=True)
class DetectionResult:
    """Everything the detect path produces for one image."""

    circuit: dict[str, Any]
    qasm: str
    warnings: list[BuildWarning]
    board: BoardResult | None
    markers: list[DetectedMarker]
    placements: list[TilePlacement] = field(default_factory=list)

    @property
    def has_board(self) -> bool:
        return self.board is not None


def detect_circuit(
    image: np.ndarray,
    board_config: BoardConfig | None = None,
    grid_tolerance: float = 1.0,
    detector: ArucoDetector | None = None,
) -> DetectionResult:
    """Run ArUco -> board -> grid -> circuit on one BGR/gray image.

    When no board is found (``< 3`` corners) the returned
    :class:`DetectionResult` has ``board is None`` and an empty circuit.
    """
    if board_config is None:
        board_config = BoardConfig.from_toml()
    if detector is None:
        detector = ArucoDetector()

    markers = detector.detect(image)
    board = fit_board(markers, board_config)

    qubits = board_config.rows
    if board is None:
        empty = {"qubits": qubits, "gates": []}
        return DetectionResult(
            circuit=empty,
            qasm=circuit_to_qasm(empty),
            warnings=[],
            board=None,
            markers=markers,
        )

    grid = GridMapper(GridConfig.from_board_config(board_config), tolerance=grid_tolerance)

    placements: list[TilePlacement] = []
    warnings: list[BuildWarning] = []
    for marker in markers:
        if marker.id in CORNER_IDS or marker.id not in MARKER_TABLE:
            continue  # corner fiducial or unknown ID -> not a gate tile
        board_xy = board.image_to_board(marker.center)[0]
        cell = grid.assign(float(board_xy[0]), float(board_xy[1]))
        if cell is None:
            warnings.append(
                BuildWarning(
                    kind="off_grid",
                    message=(
                        f"Tile marker {marker.id} "
                        f"({MARKER_TABLE[marker.id].label}) at board "
                        f"({board_xy[0]:.0f}, {board_xy[1]:.0f}) mm does not fall "
                        "on any cell; excluded."
                    ),
                    marker_ids=(marker.id,),
                )
            )
            continue
        row, col = cell
        placements.append(TilePlacement(marker_id=marker.id, row=row, col=col))

    result = build_circuit(placements, qubits)
    all_warnings = warnings + result.warnings
    all_warnings.sort(key=lambda w: (w.col if w.col is not None else 99, w.row or 0, w.kind))

    return DetectionResult(
        circuit=result.circuit,
        qasm=circuit_to_qasm(result.circuit),
        warnings=all_warnings,
        board=board,
        markers=markers,
        placements=placements,
    )


def annotate_frame(
    image: np.ndarray,
    result: DetectionResult,
    board_config: BoardConfig | None = None,
) -> np.ndarray:
    """Draw detected markers, IDs, and the projected grid onto a copy of ``image``.

    Kept inline in the CLI for M1; ``annotate.py`` stays an M2 stub.
    """
    if board_config is None:
        board_config = BoardConfig.from_toml()
    canvas = image.copy()
    if canvas.ndim == 2:
        canvas = cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)

    # Grid cells (projected board-mm -> image px), if we have a pose.
    if result.board is not None:
        grid = GridConfig.from_board_config(board_config)
        half = board_config.cell_size / 2.0
        for row in range(grid.rows):
            for col in range(grid.cols):
                cx, cy = grid.cell_center(row, col)
                corners_mm = np.array(
                    [
                        [cx - half, cy - half],
                        [cx + half, cy - half],
                        [cx + half, cy + half],
                        [cx - half, cy + half],
                    ]
                )
                corners_px = result.board.board_to_image(corners_mm).astype(np.int32)
                cv2.polylines(
                    canvas, [corners_px], isClosed=True, color=(180, 180, 180),
                    thickness=1, lineType=cv2.LINE_AA,
                )

    # Markers: outline + centre + label.
    for marker in result.markers:
        pts = marker.corners.astype(np.int32)
        is_corner = marker.id in CORNER_IDS
        color = (0, 200, 255) if is_corner else (0, 220, 0)
        cv2.polylines(canvas, [pts], isClosed=True, color=color, thickness=2,
                      lineType=cv2.LINE_AA)
        cx, cy = int(marker.center[0]), int(marker.center[1])
        cv2.circle(canvas, (cx, cy), 3, color, -1, lineType=cv2.LINE_AA)
        spec = MARKER_TABLE.get(marker.id)
        label = f"{marker.id}:{spec.label}" if spec else str(marker.id)
        cv2.putText(canvas, label, (cx + 6, cy - 6), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5, color, 1, lineType=cv2.LINE_AA)

    return canvas


def _warnings_to_text(warnings: list[BuildWarning]) -> str:
    return "\n".join(f"[{w.kind}] {w.message}" for w in warnings)


def _cmd_detect(args: argparse.Namespace) -> int:
    image = cv2.imread(args.image)
    if image is None:
        print(f"error: could not read image {args.image!r}", file=sys.stderr)
        return 2

    board_config = BoardConfig.from_toml()
    result = detect_circuit(image, board_config)

    if not result.has_board:
        print(
            "error: no board detected (fewer than 3 corner markers found); "
            f"{len(result.markers)} markers seen.",
            file=sys.stderr,
        )
        return 1

    # Default to JSON when neither output flag is given.
    want_json = args.json or not args.qasm
    want_qasm = args.qasm

    indent = 2 if args.pretty else None
    if want_json:
        print(json.dumps(result.circuit, indent=indent))
    if want_qasm:
        # Trailing newline already included by circuit_to_qasm.
        sys.stdout.write(result.qasm)

    if args.annotated:
        annotated = annotate_frame(image, result, board_config)
        cv2.imwrite(args.annotated, annotated)

    if result.warnings:
        print(_warnings_to_text(result.warnings), file=sys.stderr)

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="qamposer-vision",
        description="Entangible vision pipeline — detect gate tiles from an image.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    detect = sub.add_parser("detect", help="detect a circuit from a static image")
    detect.add_argument("--image", required=True, help="path to the board photo")
    detect.add_argument("--json", action="store_true", help="print Circuit JSON")
    detect.add_argument("--qasm", action="store_true", help="print OpenQASM 2 text")
    detect.add_argument("--annotated", metavar="OUT.png",
                        help="write an annotated copy of the image")
    detect.add_argument("--pretty", action="store_true", help="indent the JSON output")
    detect.set_defaults(func=_cmd_detect)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
