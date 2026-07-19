/**
 * Quantum Golf scorecard panel (docs/pocket.md). Shows the current level
 * ("Level N — name" + qubit count + target ket), par, strokes (= gates on the
 * board), live fidelity %, and the best-of-device stroke count, plus a compact
 * per-level best list. Reads the latched golf state and the live circuit.
 */
import type { Circuit } from '@qamposer/react';
import { LEVELS, evaluate, scoreName, type GolfState } from '@quantum/golf';

export function Scorecard({ state, circuit }: { state: GolfState; circuit: Circuit }) {
  const level = LEVELS[state.levelIndex];
  const ev = evaluate(circuit, level);
  const holedIn = state.holedIn;
  const pct = (ev.fidelity * 100).toFixed(ev.fidelity >= 0.999 ? 0 : 1);
  const bestStrokes = state.best[level.level];

  return (
    <div>
      <div className="pk-label">
        Scorecard · level {level.level}/{LEVELS.length}
      </div>
      <div className="pk-well pk-golf">
        <div className="pk-golf-hole">
          <span className="pk-golf-name">
            Level {level.level} — {level.name}
          </span>
          <span className="pk-golf-qubits">
            {level.qubits} {level.qubits === 1 ? 'qubit' : 'qubits'}
          </span>
          <span className="pk-golf-ket pk-mono">{level.target}</span>
        </div>
        <div className="pk-stats">
          <div className="pk-stat">
            par <b>{level.par}</b>
          </div>
          <div className="pk-stat">
            strokes <b>{ev.strokes}</b>
          </div>
          <div className="pk-stat">
            fidelity <b className={holedIn ? 'is-holed' : undefined}>{pct}%</b>
          </div>
          <div className="pk-stat">
            best <b>{bestStrokes === undefined ? '—' : bestStrokes}</b>
          </div>
        </div>
        {holedIn && (
          <div className="pk-golf-holed">
            {scoreName(bestStrokes ?? ev.strokes, level.par)} — clear the board for the next level
          </div>
        )}
        <div className="pk-golf-list" aria-label="all levels">
          {LEVELS.map((l) => (
            <div
              key={l.level}
              className={`pk-golf-chip ${l.level === level.level ? 'is-current' : ''} ${
                state.best[l.level] !== undefined ? 'is-done' : ''
              }`}
              title={`Level ${l.level} · ${l.name} · par ${l.par}`}
            >
              <span>{l.level}</span>
              <span className="pk-golf-chip-best">
                {state.best[l.level] === undefined ? '·' : state.best[l.level]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Scorecard;
