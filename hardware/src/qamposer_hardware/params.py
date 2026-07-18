"""Hardware build parameters and the two height variants (tile / cube).

The colour/footprint geometry lives in ``assets.toml`` (consumed via
:mod:`qamposer_assets.config`); this module only adds the *print-specific*
dimensions that have no place in the shared spec: face depth, wall thickness,
the elephant-foot chamfer, magnet-pocket sizing and the two height presets.
"""

from __future__ import annotations

from dataclasses import dataclass

from .face import FACE_DEPTH

__all__ = ["HardwareParams", "VARIANTS", "variant_height", "variant_names"]

#: Height (mm) of each variant preset. ``height`` is a free parameter in the
#: builder; these are the two documented presets.
VARIANTS: dict[str, float] = {
    "tile": 6.0,
    "cube": 60.0,
}


@dataclass(frozen=True, slots=True)
class HardwareParams:
    """Print-specific dimensions (mm), all with sensible Prusa Core One defaults."""

    face_depth: float = FACE_DEPTH  # coloured top-face thickness (MMU colour layer)
    bottom_chamfer: float = 0.4  # elephant-foot relief on the first-layer edge
    wall: float = 3.0  # cube hollow-shell wall thickness
    hollow_min_height: float = 12.0  # only hollow bodies taller than this
    magnet_diameter: float = 6.2  # magnet pocket Ø (6 mm magnet + fit clearance)
    magnet_depth: float = 2.1  # magnet pocket depth (2 mm magnet + clearance)
    magnet_offset: float = 15.0  # pocket centre distance from tile centre (±x)
    marker_bleed: float = 0.02  # per-side growth of black modules (µm-scale) so
    # diagonally-adjacent modules overlap into a manifold solid instead of a
    # non-manifold edge/point contact — invisible at print resolution.


def variant_height(variant: str) -> float:
    try:
        return VARIANTS[variant]
    except KeyError as exc:
        raise ValueError(
            f"unknown variant {variant!r}; choose one of {sorted(VARIANTS)}"
        ) from exc


def variant_names() -> list[str]:
    return list(VARIANTS)
