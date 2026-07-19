import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { blochVector, blochLength, circuitBloch, superpositionMagnitude } from './bloch';
import { DIM, type Complex, type StateVector } from './statevector';

function state(entries: Record<number, Complex>): StateVector {
  const sv: StateVector = new Array(DIM);
  for (let i = 0; i < DIM; i++) sv[i] = { re: 0, im: 0 };
  for (const [k, v] of Object.entries(entries)) sv[Number(k)] = v;
  return sv;
}

const R = Math.SQRT1_2;
const g = (type: Gate['type'], position: number, extra: Partial<Gate> = {}): Gate => ({
  id: `${type}-${position}`,
  type,
  position,
  ...extra,
});
const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });

describe('blochVector canonical states (qubit 0)', () => {
  it('|0⟩ → (0,0,1)', () => {
    const v = blochVector(state({ 0: { re: 1, im: 0 } }), 0);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(1);
  });

  it('|1⟩ → (0,0,-1)', () => {
    const v = blochVector(state({ 1: { re: 1, im: 0 } }), 0);
    expect(v.z).toBeCloseTo(-1);
  });

  it('|+⟩ → (1,0,0)', () => {
    const v = blochVector(state({ 0: { re: R, im: 0 }, 1: { re: R, im: 0 } }), 0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(0);
  });

  it('|i+⟩ = (|0⟩+i|1⟩)/√2 → (0,1,0)', () => {
    const v = blochVector(state({ 0: { re: R, im: 0 }, 1: { re: 0, im: R } }), 0);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
    expect(v.z).toBeCloseTo(0);
  });

  it('pure single-qubit states have unit length', () => {
    expect(blochLength(blochVector(state({ 0: { re: R, im: 0 }, 1: { re: R, im: 0 } }), 0))).toBeCloseTo(1);
  });
});

describe('bestBlochQubit / any-qubit rule', () => {
  it('picks the qubit carrying the superposition', () => {
    // H on q3.
    const sv = circuitBloch(circuit([g('H', 0, { qubit: 3 })]));
    expect(sv.qubit).toBe(3);
    expect(superpositionMagnitude(sv.vector)).toBeCloseTo(1);
  });

  it('an entangled (Bell) qubit has a short Bloch vector (mixed)', () => {
    const bell = circuit([g('H', 0, { qubit: 0 }), g('CNOT', 1, { control: 0, target: 1 })]);
    // Reduced state of a Bell qubit is maximally mixed → length ~0.
    const { vector } = circuitBloch(bell);
    expect(blochLength(vector)).toBeLessThan(0.2);
  });

  it('empty circuit → qubit 0 at |0⟩', () => {
    const { qubit, vector } = circuitBloch(circuit([]));
    expect(qubit).toBe(0);
    expect(vector.z).toBeCloseTo(1);
  });
});
