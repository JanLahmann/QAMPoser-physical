/**
 * Booth histogram outcome-math, guarding parity with the Pocket app's
 * `displayOutcomes` (same shared D-based rule; only class names differ).
 */
import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { displayOutcomes } from './Histogram';

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });
const H = (q: number, position = 0): Gate => g({ type: 'H', qubit: q, position });
const X = (q: number, position = 0): Gate => g({ type: 'X', qubit: q, position });
const CNOT = (control: number, target: number, position = 1): Gate =>
  g({ type: 'CNOT', control, target, position });

/** Physical recognized circuit is always 5 qubits. */
const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });

describe('displayOutcomes — D = 3 fixed axis', () => {
  it('empty board → 8 columns 000..111, only 000 at 100%', () => {
    const o = displayOutcomes(circuit([]), 3);
    expect(o.map((x) => x.bits)).toEqual([
      '000', '001', '010', '011', '100', '101', '110', '111',
    ]);
    expect(o[0].prob).toBeCloseTo(1, 10);
    for (let i = 1; i < 8; i++) expect(o[i].prob).toBeCloseTo(0, 10);
  });

  it('Bell on q0/q1 → 000 and 110 at 50% (top bit = q0)', () => {
    const o = displayOutcomes(circuit([H(0), CNOT(0, 1)]), 3);
    const byBits = Object.fromEntries(o.map((x) => [x.bits, x.prob]));
    expect(byBits['000']).toBeCloseTo(0.5, 10);
    expect(byBits['110']).toBeCloseTo(0.5, 10);
    for (const x of o) {
      if (x.bits !== '000' && x.bits !== '110') expect(x.prob).toBeCloseTo(0, 10);
    }
  });

  it('X on q0 → column 100 (q0 is the leftmost bit); tile on q2 → 001', () => {
    expect(
      Object.fromEntries(displayOutcomes(circuit([X(0)]), 3).map((x) => [x.bits, x.prob]))['100'],
    ).toBeCloseTo(1, 10);
    expect(
      Object.fromEntries(displayOutcomes(circuit([X(2)]), 3).map((x) => [x.bits, x.prob]))['001'],
    ).toBeCloseTo(1, 10);
  });
});

describe('displayOutcomes — D = 4 / 5', () => {
  it('D = 4 yields a 16-outcome space in basis order', () => {
    const o = displayOutcomes(circuit([H(3)]), 4);
    expect(o).toHaveLength(16);
    const byBits = Object.fromEntries(o.map((x) => [x.bits, x.prob]));
    expect(byBits['0000']).toBeCloseTo(0.5, 10);
    expect(byBits['0001']).toBeCloseTo(0.5, 10);
  });

  it('D = 5 all-H is the uniform 32-way spread', () => {
    const o = displayOutcomes(circuit([H(0), H(1), H(2), H(3), H(4)]), 5);
    expect(o).toHaveLength(32);
    for (const x of o) expect(x.prob).toBeCloseTo(1 / 32, 10);
  });
});
