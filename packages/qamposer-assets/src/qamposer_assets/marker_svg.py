"""Vector ArUco markers: exact bit matrix from ``cv2.aruco`` → crisp SVG rects.

The marker bit matrix is obtained from OpenCV itself
(:func:`cv2.aruco.generateImageMarker` at one pixel per module), so the printed
marker is byte-identical to what the detector expects — no hand-rolled bit
packing that could drift from the dictionary. Modules are emitted as SVG
``<rect>`` elements (black modules on white, including the 1-module black
border); there is no raster image anywhere in the pipeline.

``cv2`` is imported here and *only* here — the rest of the package stays free of
the OpenCV dependency.
"""

from __future__ import annotations

from functools import lru_cache

from .svgbase import rect

__all__ = [
    "marker_module_count",
    "marker_bit_matrix",
    "marker_group",
    "marker_document",
]


@lru_cache(maxsize=None)
def _dictionary(name: str):  # noqa: ANN202 - cv2 type
    import cv2  # local import: keep cv2 out of the package's import surface

    try:
        dict_id = getattr(cv2.aruco, name)
    except AttributeError as exc:
        raise ValueError(f"unknown ArUco dictionary {name!r}") from exc
    return cv2.aruco.getPredefinedDictionary(dict_id)


def marker_module_count(dictionary: str = "DICT_4X4_50") -> int:
    """Total modules per side, including the 1-module border on each side."""
    return int(_dictionary(dictionary).markerSize) + 2


@lru_cache(maxsize=None)
def marker_bit_matrix(
    marker_id: int, dictionary: str = "DICT_4X4_50"
) -> tuple[tuple[int, ...], ...]:
    """Return the marker's module grid as rows of ints (1 = black, 0 = white).

    The grid is ``modules × modules`` (e.g. 6×6 for ``DICT_4X4_50``) and includes
    the black border. Sourced directly from OpenCV so it matches detection.
    """
    import cv2  # noqa: F401 - ensures cv2 available for the helpers below

    modules = marker_module_count(dictionary)
    # One pixel per module -> the raw bit grid (0 = black, 255 = white).
    img = cv2.aruco.generateImageMarker(_dictionary(dictionary), marker_id, modules)
    return tuple(
        tuple(1 if int(px) == 0 else 0 for px in row) for row in img.tolist()
    )


def marker_group(
    marker_id: int,
    x: float,
    y: float,
    size: float,
    *,
    dictionary: str = "DICT_4X4_50",
    group_id: str = "marker",
    with_background: bool = True,
) -> str:
    """A ``<g>`` of black module rects for ``marker_id`` at (x, y), ``size`` mm.

    With ``with_background`` an explicit white backing rect is drawn (so the
    marker reads correctly even over a tinted surface). Adjacent black modules
    are emitted as run-length merged rects per row to keep the SVG compact and
    crisp (no hairline seams between modules).
    """
    matrix = marker_bit_matrix(marker_id, dictionary)
    n = len(matrix)
    module = size / n

    parts: list[str] = [f'<g id="{group_id}" shape-rendering="crispEdges">']
    if with_background:
        parts.append(rect(x, y, size, size, fill="#ffffff"))

    for r, row in enumerate(matrix):
        c = 0
        while c < n:
            if row[c] == 1:
                start = c
                while c < n and row[c] == 1:
                    c += 1
                run = c - start
                parts.append(
                    rect(
                        x + start * module,
                        y + r * module,
                        run * module,
                        module,
                        fill="#000000",
                    )
                )
            else:
                c += 1
    parts.append("</g>")
    return "".join(parts)


def marker_document(
    marker_id: int,
    size: float = 36.0,
    *,
    dictionary: str = "DICT_4X4_50",
    quiet_zone: float = 0.0,
) -> str:
    """A standalone marker SVG document (mainly for inspection / testing)."""
    from .svgbase import svg_document

    total = size + 2 * quiet_zone
    body = rect(0, 0, total, total, fill="#ffffff") + marker_group(
        marker_id, quiet_zone, quiet_zone, size, dictionary=dictionary
    )
    return svg_document(total, total, body, title=f"ArUco {marker_id}")
