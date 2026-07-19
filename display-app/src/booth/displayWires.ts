/**
 * Display-only wire-count transform for the booth editor (docs/booth-ux.md,
 * "Dynamic layout" → wires; ported from the Pocket app's `displayWires.ts`).
 *
 * The physical table and the recognized circuit are ALWAYS five qubits — this
 * never touches gate data, detection, the statevector, moments or QASM (which
 * all keep the 5-qubit truth). It only decides how many wires the controlled
 * `CircuitEditor` draws, and how many rows the booth histogram spans:
 *
 *   - 'all'     → always the full 5 wires.
 *   - 'compact' → the smallest count that still covers every used row, floored
 *                 at 3. Auto-grows to 4/5 the moment a tile lands on q3/q4 and
 *                 contracts again when it is removed.
 *
 * `displayCircuit` returns the SAME object when the wire count already matches,
 * so React memoisation and the editor's identity checks stay stable.
 *
 * Kept a booth-local port (no cross-app import) so the two apps stay decoupled.
 */
import type { Circuit } from '@qamposer/react';
import type { Wires } from '../ws/messages';

/** Fewest wires 'compact' will ever show. */
export const MIN_COMPACT_WIRES = 3;
/** The physical wire count — the ceiling for the display and 'all's fixed value. */
export const FULL_WIRES = 5;

/** Highest qubit row touched by any gate, or -1 for an empty circuit. */
export function highestUsedRow(circuit: Circuit): number {
  let hi = -1;
  for (const g of circuit.gates) {
    if (g.qubit != null && g.qubit > hi) hi = g.qubit;
    if (g.control != null && g.control > hi) hi = g.control;
    if (g.target != null && g.target > hi) hi = g.target;
  }
  return hi;
}

/** Number of wires to DISPLAY for `circuit` under the given `wires` setting. */
export function displayQubits(circuit: Circuit, wires: Wires): number {
  if (wires === 'all') return FULL_WIRES;
  return Math.min(FULL_WIRES, Math.max(MIN_COMPACT_WIRES, highestUsedRow(circuit) + 1));
}

/**
 * The circuit as SHOWN in the editor: identical gates, display-clamped wire
 * count. Returns the input unchanged when no re-count is needed.
 */
export function displayCircuit(circuit: Circuit, wires: Wires): Circuit {
  const qubits = displayQubits(circuit, wires);
  return qubits === circuit.qubits ? circuit : { qubits, gates: circuit.gates };
}
