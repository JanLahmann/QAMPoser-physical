"""ArucoDetector — per-frame ``DICT_4X4_50`` detection with subpixel refinement.

Pure, stateless wrapper around ``cv2.aruco``: given one BGR or grayscale image
it returns every ArUco marker it can see as a :class:`DetectedMarker`
(id + four image-px corners + centre). No temporal state lives here — the
stabilizer (M2) is a separate layer.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .markers import ARUCO_DICT_NAME

__all__ = ["DetectedMarker", "ArucoDetector"]


@dataclass(frozen=True, slots=True)
class DetectedMarker:
    """A single ArUco marker found in one frame.

    Attributes:
        id: The decoded ArUco marker ID.
        corners: ``(4, 2)`` float array of image-px corner coordinates, in the
            ArUco canonical order (top-left, top-right, bottom-right,
            bottom-left of the marker as printed).
        center: ``(2,)`` float array — the marker centroid in image px.
    """

    id: int
    corners: np.ndarray
    center: np.ndarray


def _aruco_dictionary() -> cv2.aruco.Dictionary:
    dict_id = getattr(cv2.aruco, ARUCO_DICT_NAME)
    return cv2.aruco.getPredefinedDictionary(dict_id)


class ArucoDetector:
    """Stateless per-frame ArUco detector with subpixel corner refinement."""

    def __init__(self) -> None:
        self._dictionary = _aruco_dictionary()
        params = cv2.aruco.DetectorParameters()
        # Subpixel refinement → sub-pixel accurate corners for a tight homography.
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self._params = params
        self._detector = cv2.aruco.ArucoDetector(self._dictionary, self._params)

    def detect(self, image: np.ndarray) -> list[DetectedMarker]:
        """Detect all markers in a BGR or grayscale image.

        Returns markers sorted by ID for deterministic downstream ordering.
        """
        if image is None:  # defensive: cv2.imread returns None for bad paths
            raise ValueError("detect() received None instead of an image")
        if image.ndim == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image
        corners, ids, _rejected = self._detector.detectMarkers(gray)
        results: list[DetectedMarker] = []
        if ids is None:
            return results
        for marker_corners, marker_id in zip(corners, ids.flatten()):
            pts = np.asarray(marker_corners, dtype=np.float64).reshape(4, 2)
            center = pts.mean(axis=0)
            results.append(
                DetectedMarker(id=int(marker_id), corners=pts, center=center)
            )
        results.sort(key=lambda m: m.id)
        return results
