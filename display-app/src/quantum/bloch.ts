/**
 * Single-qubit Bloch vector — pure math for Quantum Golf level 1.
 *
 * From the full statevector we take the reduced 1-qubit state of a chosen qubit
 * (partial trace over the other four) and read off its Bloch vector `(x, y, z)`
 * where `ρ = (I + xX + yY + zZ)/2`:
 *   z = P(0) − P(1),  x = 2·Re(ρ01),  y = −2·Im(ρ01),
 * with `ρ01 = Σ_rest amp(qubit=0, rest)·conj(amp(qubit=1, rest))`. Canonical
 * checks: |0⟩→(0,0,1), |1⟩→(0,0,-1), |+⟩→(1,0,0), |i+⟩→(0,1,0).
 *
 * The level-1 "any qubit" rule: `bestBlochQubit` picks the qubit whose reduced
 * state has the most superposition (largest equatorial component √(x²+y²)),
 * matching the engine's best-fidelity-over-any-qubit scoring.
 *
 * The point `(x, y, z)` lives in the SAME model space as the Q-sphere (z is the
 * pole axis), so BlochView reuses `qsphere`'s projection/interaction machinery.
 */
import { DIM, NUM_QUBITS, statevector, type Complex, type StateVector } from './statevector';
import type { Circuit } from '@qamposer/react';

export interface BlochVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Reduced-state Bloch vector of qubit `q` from a full statevector. */
export function blochVector(sv: StateVector, q: number): BlochVector {
  const bit = 1 << q;
  let p1 = 0;
  let cRe = 0;
  let cIm = 0;
  for (let i = 0; i < DIM; i++) {
    if ((i & bit) !== 0) {
      const a = sv[i];
      p1 += a.re * a.re + a.im * a.im;
      continue;
    }
    // i has qubit q = 0; its partner j = i|bit has qubit q = 1.
    const a: Complex = sv[i];
    const b: Complex = sv[i | bit];
    // ρ01 contribution: a · conj(b)
    cRe += a.re * b.re + a.im * b.im;
    cIm += a.im * b.re - a.re * b.im;
  }
  const z = 1 - 2 * p1; // P(0) - P(1)
  const x = 2 * cRe;
  const y = -2 * cIm;
  return { x, y, z };
}

/** Length of a Bloch vector (1 for a pure state, < 1 when entangled/mixed). */
export function blochLength(v: BlochVector): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Equatorial (superposition) magnitude √(x²+y²). */
export function superpositionMagnitude(v: BlochVector): number {
  return Math.hypot(v.x, v.y);
}

/**
 * The qubit with the most superposition (largest equatorial component), i.e.
 * the level-1 "any qubit" pick. Ties break toward the lowest index. Returns 0
 * for the empty state (all qubits at |0⟩).
 */
export function bestBlochQubit(sv: StateVector): number {
  let best = 0;
  let bestMag = -1;
  for (let q = 0; q < NUM_QUBITS; q++) {
    const mag = superpositionMagnitude(blochVector(sv, q));
    if (mag > bestMag + 1e-12) {
      bestMag = mag;
      best = q;
    }
  }
  return best;
}

/** Convenience: best-qubit Bloch vector straight from a circuit. */
export function circuitBloch(circuit: Circuit): { qubit: number; vector: BlochVector } {
  const sv = statevector(circuit);
  const qubit = bestBlochQubit(sv);
  return { qubit, vector: blochVector(sv, qubit) };
}

/**
 * The level-1 target Bloch vector: |+⟩ on the equator, at `(1, 0, 0)`. Exposed
 * so BlochView can plant the target flag at the same projected position.
 */
export const TARGET_PLUS: BlochVector = { x: 1, y: 0, z: 0 };
