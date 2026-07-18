"""Marker table — the single source of truth for the Entangible tile scheme.

This is a **pure data module**: it maps ArUco marker IDs to the gate (or board
corner) they represent. It is imported by *both* the vision detector
(``qamposer_vision``) and the printable asset generator (``qamposer_assets``),
so the physical print and the runtime detection can never drift apart.

Deliberately dependency-free — it must NOT import ``cv2`` or ``numpy`` so that
the assets package stays lightweight. Only the standard library is used.

Marker scheme (``DICT_4X4_50``):

* 0–3   board corners TL/TR/BR/BL (orientation implicit)
* 10–13 single-qubit gates H/X/Y/Z
* 14/15 CNOT control ``●`` / target ``⊕``
* 20–31 rotation gates RX/RY/RZ, one distinct ID per angle variant
* 40–49 reserved for future tiles (S/T/SWAP), see :data:`RESERVED_IDS`
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

__all__ = [
    "ARUCO_DICT_NAME",
    "CORNER_IDS",
    "CORNER_ROLES",
    "GATE_TYPES",
    "GateSpec",
    "MARKER_TABLE",
    "RESERVED_IDS",
    "ROTATION_ANGLES",
    "ROTATION_GATES",
    "pretty_angle",
]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: ArUco dictionary used for every printed marker. 4x4 = largest bits-per-mm,
#: 50 IDs is plenty for the current + reserved scheme. ``cv2.aruco`` ships this
#: predefined dictionary; the assets generator renders the same bit matrix.
ARUCO_DICT_NAME = "DICT_4X4_50"

#: Board-corner roles in clockwise order starting top-left.
CORNER_ROLES: tuple[str, str, str, str] = ("TL", "TR", "BR", "BL")

#: Marker ID -> corner role for the four board corners.
CORNER_IDS: dict[int, str] = {0: "TL", 1: "TR", 2: "BR", 3: "BL"}

#: Valid single-/two-qubit gate types, matching ``@qamposer/react``'s ``GateType``.
GATE_TYPES: frozenset[str] = frozenset(
    {"H", "X", "Y", "Z", "RX", "RY", "RZ", "CNOT"}
)

#: Rotation gate families that come in angle variants.
ROTATION_GATES: tuple[str, str, str] = ("RX", "RY", "RZ")

#: The angle variants (radians) printed for every rotation gate family.
ROTATION_ANGLES: tuple[float, float, float, float] = (
    math.pi / 4,
    math.pi / 2,
    math.pi,
    -math.pi / 2,
)

#: IDs reserved for future tiles (S / T / SWAP, added in M6). Never emitted by
#: the current detector or assets generator, but claimed here so no other gate
#: is assigned into this range.
RESERVED_IDS = range(40, 50)


# ---------------------------------------------------------------------------
# Spec dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class GateSpec:
    """What a single ArUco marker ID represents.

    Attributes:
        kind: ``"corner"`` for board fiducials, ``"gate"`` for tiles.
        gate: For ``kind == "gate"`` a ``GateType`` string (see
            :data:`GATE_TYPES`); for ``kind == "corner"`` the corner role
            (one of :data:`CORNER_ROLES`).
        label: Human-facing label (tile caption / debug table), e.g.
            ``"RX(π/2)"`` or ``"Corner TL"``.
        parameter: Rotation angle in radians for RX/RY/RZ, else ``None``.
        role: For corners one of ``TL|TR|BR|BL``; for CNOT ``control|target``;
            otherwise ``None``.
    """

    kind: Literal["corner", "gate"]
    gate: str
    label: str
    parameter: float | None = None
    role: str | None = None

    @property
    def param_label(self) -> str | None:
        """Pretty angle label (e.g. ``"π/2"``) for rotation gates, else ``None``.

        Shared by the assets generator (tile face text) and QASM/label
        rendering so angles are formatted identically everywhere.
        """
        if self.parameter is None:
            return None
        return pretty_angle(self.parameter)


# ---------------------------------------------------------------------------
# Angle formatting
# ---------------------------------------------------------------------------

# Known exact multiples of pi, keyed by angle/pi, for crisp tile labels.
_PI_FRACTIONS: dict[float, str] = {
    0.25: "π/4",
    0.5: "π/2",
    1.0: "π",
    2.0: "2π",
    0.75: "3π/4",
    1.0 / 3.0: "π/3",
    1.0 / 6.0: "π/6",
}


def pretty_angle(theta: float) -> str:
    """Format a radian angle as a compact π-relative label.

    Examples:
        ``π/2`` -> ``"π/2"``; ``-π/2`` -> ``"-π/2"``; ``π`` -> ``"π"``.

    Falls back to a 4-decimal radian value for angles that are not a
    recognised simple multiple of π.
    """
    if theta == 0:
        return "0"
    sign = "-" if theta < 0 else ""
    ratio = abs(theta) / math.pi
    for value, text in _PI_FRACTIONS.items():
        if math.isclose(ratio, value, rel_tol=1e-9, abs_tol=1e-12):
            return f"{sign}{text}"
    return f"{theta:.4f}"


# ---------------------------------------------------------------------------
# Table construction
# ---------------------------------------------------------------------------


def _build_marker_table() -> dict[int, GateSpec]:
    table: dict[int, GateSpec] = {}

    # 0-3: board corners.
    for marker_id, role in CORNER_IDS.items():
        table[marker_id] = GateSpec(
            kind="corner",
            gate=role,
            label=f"Corner {role}",
            role=role,
        )

    # 10-13: single-qubit Pauli / Hadamard gates.
    for marker_id, gate in ((10, "H"), (11, "X"), (12, "Y"), (13, "Z")):
        table[marker_id] = GateSpec(kind="gate", gate=gate, label=gate)

    # 14/15: CNOT halves.
    table[14] = GateSpec(kind="gate", gate="CNOT", label="CNOT control ●", role="control")
    table[15] = GateSpec(kind="gate", gate="CNOT", label="CNOT target ⊕", role="target")

    # 20-31: rotation gates x angle variants (4 angles each, contiguous).
    base = 20
    for family in ROTATION_GATES:
        for offset, angle in enumerate(ROTATION_ANGLES):
            marker_id = base + offset
            label = f"{family}({pretty_angle(angle)})"
            table[marker_id] = GateSpec(
                kind="gate",
                gate=family,
                label=label,
                parameter=angle,
            )
        base += len(ROTATION_ANGLES)

    return table


#: The single source of truth: ArUco marker ID -> :class:`GateSpec`.
#: Imported by both the detector and the assets generator.
MARKER_TABLE: dict[int, GateSpec] = _build_marker_table()
