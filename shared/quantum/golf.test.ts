import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import {
  LEVELS,
  HOLE_IN_THRESHOLD,
  bestFidelity,
  evaluate,
  scoreName,
  golfStep,
  initialGolfState,
  loadBest,
  saveBest,
  GOLF_STORAGE_KEY,
} from './golf';

const g = (type: Gate['type'], position: number, extra: Partial<Gate> = {}): Gate => ({
  id: `${type}-${position}-${extra.qubit ?? extra.control ?? 0}`,
  type,
  position,
  ...extra,
});

const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });
const empty = circuit([]);

/** Canonical circuit that holes in each level (H then GHZ-fan CNOTs from q0). */
function canonical(k: number): Circuit {
  const gates: Gate[] = [g('H', 0, { qubit: 0 })];
  for (let t = 1; t < k; t++) gates.push(g('CNOT', t, { control: 0, target: t }));
  return circuit(gates);
}

describe('LEVELS definition', () => {
  it('is five levels with pars 1..5, matching qubit count, and views', () => {
    expect(LEVELS.map((l) => l.par)).toEqual([1, 2, 3, 4, 5]);
    expect(LEVELS.map((l) => l.qubits)).toEqual([1, 2, 3, 4, 5]);
    expect(LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5]);
    expect(LEVELS.map((l) => l.name)).toEqual([
      'Superposition',
      'Bell',
      'GHZ-3',
      'GHZ-4',
      'GHZ-5',
    ]);
    // Level 1 plays Bloch, levels 2–5 the Q-sphere.
    expect(LEVELS.map((l) => l.view)).toEqual(['bloch', 'qsphere', 'qsphere', 'qsphere', 'qsphere']);
  });
});

describe('evaluate', () => {
  it('each level is holed in by its canonical circuit', () => {
    for (const level of LEVELS) {
      const ev = evaluate(canonical(level.qubits), level);
      expect(ev.fidelity).toBeGreaterThan(0.999);
      expect(ev.holedIn).toBe(true);
      expect(ev.strokes).toBe(level.qubits); // par gates
    }
  });

  it('empty board scores zero fidelity', () => {
    for (const level of LEVELS) {
      expect(evaluate(empty, level)).toMatchObject({ fidelity: 0, strokes: 0, holedIn: false });
    }
  });

  it('superposition accepts an H on ANY qubit', () => {
    const h3 = circuit([g('H', 0, { qubit: 3 })]);
    expect(evaluate(h3, LEVELS[0]).holedIn).toBe(true);
  });

  it('a bare H does not hole the Bell level', () => {
    const ev = evaluate(circuit([g('H', 0, { qubit: 0 })]), LEVELS[1]);
    expect(ev.holedIn).toBe(false);
    expect(ev.fidelity).toBeLessThan(HOLE_IN_THRESHOLD);
  });

  it('bestFidelity finds a Bell built on non-canonical qubits', () => {
    const bell = circuit([g('H', 0, { qubit: 2 }), g('CNOT', 1, { control: 2, target: 4 })]);
    expect(bestFidelity(bell, 2)).toBeGreaterThan(0.999);
  });
});

describe('scoreName', () => {
  it('names scores by strokes vs par', () => {
    expect(scoreName(1, 3)).toBe('EAGLE'); // < par-1
    expect(scoreName(2, 3)).toBe('BIRDIE'); // par-1
    expect(scoreName(3, 3)).toBe('PAR');
    expect(scoreName(5, 3)).toBe('HOLE IN +2');
    expect(scoreName(1, 1)).toBe('PAR');
  });
});

describe('golfStep state machine', () => {
  it('holes in, latches, records best, and advances on board clear', () => {
    let state = initialGolfState();

    // Level 1: play the canonical H.
    let step = golfStep(state, canonical(1));
    expect(step.justHoledIn).toBe(true);
    expect(step.holedIn).toBe(true);
    expect(step.scoreName).toBe('PAR');
    expect(step.state.best[1]).toBe(1);
    state = step.state;

    // Wiggling gates keeps the latch (no re-fire).
    step = golfStep(state, canonical(1));
    expect(step.justHoledIn).toBe(false);
    expect(step.holedIn).toBe(true);
    state = step.state;

    // Clearing the board advances to level 2.
    step = golfStep(state, empty);
    expect(step.advanced).toBe(true);
    expect(step.state.levelIndex).toBe(1);
    expect(step.level.level).toBe(2);
    expect(step.holedIn).toBe(false);
    state = step.state;

    // Level 2: Bell.
    step = golfStep(state, canonical(2));
    expect(step.justHoledIn).toBe(true);
    expect(step.state.best[2]).toBe(2);
  });

  it('board clear without a hole-in does not advance', () => {
    const state = initialGolfState();
    const partial = golfStep(state, circuit([g('X', 0, { qubit: 0 })]));
    expect(partial.holedIn).toBe(false);
    const cleared = golfStep(partial.state, empty);
    expect(cleared.advanced).toBe(false);
    expect(cleared.state.levelIndex).toBe(0);
  });

  it('does not lower best when re-holing with more strokes', () => {
    const state = initialGolfState({ 1: 1 });
    // Hole in level 1 with an extra (redundant) gate → 2 strokes.
    const twoGate = circuit([g('H', 0, { qubit: 0 }), g('Z', 1, { qubit: 4 })]);
    // Z on an untouched qubit keeps q0 superposition; still holes in.
    const ev = evaluate(twoGate, LEVELS[0]);
    expect(ev.holedIn).toBe(true);
    const step = golfStep(state, twoGate);
    expect(step.state.best[1]).toBe(1); // unchanged (1 < 2)
  });

  it('clamps advance at the final level', () => {
    const state = { levelIndex: 4, holedIn: true, best: {} as Record<number, number> };
    const step = golfStep(state, empty);
    expect(step.state.levelIndex).toBe(4);
    expect(step.advanced).toBe(true);
  });
});

describe('best persistence', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      _map: map,
    };
  }

  it('round-trips best scores', () => {
    const storage = fakeStorage();
    saveBest(storage, { 1: 1, 3: 3 });
    expect(loadBest(storage)).toEqual({ 1: 1, 3: 3 });
    expect(storage._map.has(GOLF_STORAGE_KEY)).toBe(true);
  });

  it('tolerates missing / corrupt storage', () => {
    expect(loadBest(null)).toEqual({});
    const bad = fakeStorage({ [GOLF_STORAGE_KEY]: 'not json' });
    expect(loadBest(bad)).toEqual({});
  });
});
