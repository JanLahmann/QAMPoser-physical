/**
 * Touch-to-inspect — pure decision + copy helpers (docs/booth-ux.md,
 * "Variant-A refinements → Touch").
 *
 * Touch is OPTIONAL and never edits the circuit (the physical table is the
 * editor). When enabled, a tap on a gate or an outcome column pops a
 * one-sentence explanation; popovers auto-dismiss after {@link POPOVER_MS} and
 * only one shows at a time. This module holds the framework-free logic (enable
 * decision + friendly copy per gate type / outcome) so it is unit-testable
 * without a DOM; the DOM plumbing lives in `TouchInspector.tsx`.
 */
import type { Gate } from '@qamposer/react';

/** How long a popover stays before auto-dismissing. */
export const POPOVER_MS = 6000;

/**
 * Whether touch-to-inspect should be active: explicit `?touch=1` (or `0` to
 * force off) wins; otherwise it follows a coarse pointer (a touchscreen).
 */
export function isTouchEnabled(search: string, coarsePointer: boolean): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('touch');
  if (raw !== null) {
    return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
  }
  return coarsePointer;
}

/** Format a rotation parameter (radians) as a fraction of π, e.g. `0.50π`. */
export function formatAngle(parameter: number | undefined): string {
  const p = parameter ?? 0;
  return `${(p / Math.PI).toFixed(2)}π`;
}

const CLOSE = 1e-3;
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < CLOSE;
}

/**
 * One friendly sentence explaining what a gate does, per {@link Gate} type.
 * Covers the eight `GateType`s; S and T reach the booth as `RZ` with a fixed
 * angle (π/2, π/4), which we name back for the visitor.
 */
export function gateInspectCopy(gate: Gate): string {
  const q = gate.qubit ?? 0;
  switch (gate.type) {
    case 'H':
      return `H puts q${q} into superposition — it is 0 and 1 at once.`;
    case 'X':
      return `X flips q${q}: |0⟩ becomes |1⟩ (a quantum NOT).`;
    case 'Y':
      return `Y flips q${q} and adds a phase — a bit-flip and phase-flip together.`;
    case 'Z':
      return `Z leaves 0 alone but flips the phase of 1 on q${q} (a phase flip).`;
    case 'CNOT': {
      const c = gate.control ?? 0;
      const t = gate.target ?? 0;
      return `A ●⊕ pair is a CNOT: it flips q${t} whenever q${c} is 1 — the move that entangles them.`;
    }
    case 'RX':
      return `RX turns q${q} around the X axis by ${formatAngle(gate.parameter)} — a tunable bit-flip.`;
    case 'RY':
      return `RY turns q${q} around the Y axis by ${formatAngle(gate.parameter)} — dials in a partial superposition.`;
    case 'RZ': {
      const p = gate.parameter ?? 0;
      if (near(p, Math.PI / 2)) {
        return `S adds a quarter-turn phase to q${q} (a √Z gate, sent as RZ ${formatAngle(p)}).`;
      }
      if (near(p, Math.PI / 4)) {
        return `T adds an eighth-turn phase to q${q} (a √S gate, sent as RZ ${formatAngle(p)}).`;
      }
      return `RZ rotates q${q}'s phase by ${formatAngle(p)} around the Z axis.`;
    }
    default:
      // Forward-compatible: an unknown gate type still gets a sane sentence.
      return `This gate acts on q${q}.`;
  }
}

/** Percentage phrasing that never reads "0%" for a non-zero outcome. */
function percentPhrase(prob: number): string {
  const pct = prob * 100;
  if (pct >= 0.95) return `${Math.round(pct)}%`;
  if (pct > 0) return '<1%';
  return '0%';
}

/**
 * What a tapped outcome column means. `bits` is one char per DISPLAYED row,
 * leftmost = q0, so bit `i` is qubit `i` directly (the histogram marginalizes
 * onto the first D physical rows). Example:
 *   ("110", 0.5) → "110: q0=1, q1=1, q2=0 — seen in 50% of runs".
 */
export function outcomeInspectCopy(bits: string, prob: number): string {
  const pairs = bits.split('').map((b, i) => `q${i}=${b}`);
  return `${bits}: ${pairs.join(', ')} — seen in ${percentPhrase(prob)} of runs.`;
}
