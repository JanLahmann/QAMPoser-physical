/**
 * Quantum Golf engine — pure logic for the "quantum mini-golf" progression.
 *
 * Shared home for BOTH apps (pocket imports it via its `@quantum` alias; the
 * booth imports it relatively). Five LEVELS where **level = qubit count**:
 * level 1 Superposition (Bloch view, par 1), level 2 Bell, levels 3–5 GHZ-3/4/5
 * (Q-sphere view, par = level). Each level's target is a maximally-entangled
 * state over `k` qubits; we score the player's live circuit by the *best*
 * fidelity achievable over any `k`-qubit subset (so the superposition level
 * accepts an H on any qubit, and a GHZ can be built on any rows). "Strokes" =
 * gates on the board. Hole-in at fidelity ≥ 0.99; clearing the board then
 * advances to the next level. Best-per-level is optionally persisted through an
 * injectable Storage (pocket uses localStorage; the booth keeps it in memory).
 * All exported logic is pure and injectable.
 */
import type { Circuit } from '@qamposer/react';
import { fidelity, ghzState, statevector, NUM_QUBITS, type StateVector } from './statevector';

export const HOLE_IN_THRESHOLD = 0.99;
export const GOLF_STORAGE_KEY = 'entangible.pocket.golf';

/** Which view a level plays on (level 1 Bloch, levels 2–5 Q-sphere). */
export type GolfView = 'bloch' | 'qsphere';

export interface Level {
  /** 1..5 — also the number of qubits the target entangles. */
  readonly level: number;
  readonly name: string;
  /** Number of qubits the target entangles (= `level`; 1 = plain superposition). */
  readonly qubits: number;
  /** The view this level renders on. */
  readonly view: GolfView;
  /** Display ket for the target state, e.g. "(|00⟩+|11⟩)/√2". */
  readonly target: string;
  readonly par: number;
}

function ket(k: number): string {
  const zeros = '0'.repeat(k);
  const ones = '1'.repeat(k);
  return `(|${zeros}⟩+|${ones}⟩)/√2`;
}

export const LEVELS: readonly Level[] = [
  { level: 1, name: 'Superposition', qubits: 1, view: 'bloch', target: ket(1), par: 1 },
  { level: 2, name: 'Bell', qubits: 2, view: 'qsphere', target: ket(2), par: 2 },
  { level: 3, name: 'GHZ-3', qubits: 3, view: 'qsphere', target: ket(3), par: 3 },
  { level: 4, name: 'GHZ-4', qubits: 4, view: 'qsphere', target: ket(4), par: 4 },
  { level: 5, name: 'GHZ-5', qubits: 5, view: 'qsphere', target: ket(5), par: 5 },
];

/** All size-`k` subsets of {0..NUM_QUBITS-1}. */
function subsets(k: number): number[][] {
  const out: number[][] = [];
  const choose = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let q = start; q < NUM_QUBITS; q++) {
      acc.push(q);
      choose(q + 1, acc);
      acc.pop();
    }
  };
  choose(0, []);
  return out;
}

// Precompute target statevectors per level size (k=1..5): the canonical
// maximally-entangled state on each k-qubit subset.
const TARGETS: Map<number, StateVector[]> = new Map(
  LEVELS.map((l) => [l.qubits, subsets(l.qubits).map((s) => ghzState(s))]),
);

/**
 * Best fidelity of `circuit`'s state against a `k`-qubit maximally-entangled
 * target over any qubit subset. For k=1 this is superposition on any qubit.
 */
export function bestFidelity(circuit: Circuit, k: number): number {
  const sv = statevector(circuit);
  const targets = TARGETS.get(k) ?? subsets(k).map((s) => ghzState(s));
  let best = 0;
  for (const t of targets) {
    const f = fidelity(sv, t);
    if (f > best) best = f;
  }
  return best;
}

export interface Evaluation {
  readonly fidelity: number;
  readonly strokes: number;
  readonly holedIn: boolean;
}

/** Evaluate a circuit against a level: fidelity, stroke count, hole-in flag. */
export function evaluate(circuit: Circuit, level: Level): Evaluation {
  const strokes = circuit.gates.length;
  const f = strokes === 0 ? 0 : bestFidelity(circuit, level.qubits);
  return { fidelity: f, strokes, holedIn: f >= HOLE_IN_THRESHOLD };
}

/** Golf score name for a completed level (strokes vs par). */
export function scoreName(strokes: number, par: number): string {
  if (strokes < par - 1) return 'EAGLE';
  if (strokes < par) return 'BIRDIE';
  if (strokes === par) return 'PAR';
  return `HOLE IN +${strokes - par}`;
}

// --- state machine (pure) ---------------------------------------------------

export interface GolfState {
  /** 0-based index into LEVELS. */
  readonly levelIndex: number;
  /** Latched once the current level is holed in; cleared only by a board-clear advance. */
  readonly holedIn: boolean;
  /** Best (lowest) holed-in stroke count per level number. */
  readonly best: Readonly<Record<number, number>>;
}

export function initialGolfState(best: Record<number, number> = {}): GolfState {
  return { levelIndex: 0, holedIn: false, best };
}

export interface GolfStep {
  readonly state: GolfState;
  readonly level: Level;
  readonly fidelity: number;
  readonly strokes: number;
  readonly holedIn: boolean;
  /** True on the frame the current level transitions into a hole-in. */
  readonly justHoledIn: boolean;
  /** True on the frame a board-clear advanced to the next level. */
  readonly advanced: boolean;
  /** Score name for the current completed level (present while holed in). */
  readonly scoreName: string | null;
}

/**
 * Advance the golf state one circuit change. Pure: same (prev, circuit) → same
 * result. Board-clear (0 gates) while the level is latched holed-in advances to
 * the next level (clamped at the last). A fresh hole-in latches and records the
 * best stroke count.
 */
export function golfStep(prev: GolfState, circuit: Circuit): GolfStep {
  const level = LEVELS[prev.levelIndex];
  const ev = evaluate(circuit, level);

  // Board cleared → advance if the level was completed, else just reset.
  if (ev.strokes === 0) {
    if (prev.holedIn) {
      const levelIndex = Math.min(prev.levelIndex + 1, LEVELS.length - 1);
      const nextLevel = LEVELS[levelIndex];
      const nextEv = evaluate(circuit, nextLevel);
      return {
        state: { levelIndex, holedIn: false, best: prev.best },
        level: nextLevel,
        fidelity: nextEv.fidelity,
        strokes: 0,
        holedIn: false,
        justHoledIn: false,
        advanced: true,
        scoreName: null,
      };
    }
    return {
      state: { ...prev, holedIn: false },
      level,
      fidelity: 0,
      strokes: 0,
      holedIn: false,
      justHoledIn: false,
      advanced: false,
      scoreName: null,
    };
  }

  // Fresh hole-in this frame.
  if (ev.holedIn && !prev.holedIn) {
    const best = { ...prev.best };
    const prevBest = best[level.level];
    if (prevBest === undefined || ev.strokes < prevBest) best[level.level] = ev.strokes;
    return {
      state: { ...prev, holedIn: true, best },
      level,
      fidelity: ev.fidelity,
      strokes: ev.strokes,
      holedIn: true,
      justHoledIn: true,
      advanced: false,
      scoreName: scoreName(ev.strokes, level.par),
    };
  }

  // Steady state: keep the latch until the board is cleared.
  const holedIn = prev.holedIn;
  return {
    state: { ...prev, holedIn },
    level,
    fidelity: ev.fidelity,
    strokes: ev.strokes,
    holedIn,
    justHoledIn: false,
    advanced: false,
    scoreName: holedIn ? scoreName(prev.best[level.level] ?? ev.strokes, level.par) : null,
  };
}

// --- persistence ------------------------------------------------------------

export function loadBest(
  storage?: Pick<Storage, 'getItem'> | null,
): Record<number, number> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(GOLF_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      if (Number.isFinite(id) && typeof v === 'number' && Number.isFinite(v)) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveBest(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  best: Record<number, number>,
): void {
  if (!storage) return;
  try {
    storage.setItem(GOLF_STORAGE_KEY, JSON.stringify(best));
  } catch {
    /* best-effort */
  }
}
