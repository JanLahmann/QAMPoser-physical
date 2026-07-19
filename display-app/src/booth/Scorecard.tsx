/**
 * Quantum Golf scorecard — booth (`bo-`) styled port of the pocket scorecard.
 *
 * Shows the current level ("Level N — name" + qubit count + target ket), par,
 * strokes (= gates on the board), live fidelity %, best-of-session stroke count,
 * and a compact per-level best list. Reads the latched golf state (kept in booth
 * memory — no localStorage) and the live circuit.
 */
import type { Circuit } from '@qamposer/react';
import { LEVELS, evaluate, scoreName, type GolfState } from '../quantum/golf';

export function Scorecard({ state, circuit }: { state: GolfState; circuit: Circuit }) {
  const level = LEVELS[state.levelIndex];
  const ev = evaluate(circuit, level);
  const holedIn = state.holedIn;
  const pct = (ev.fidelity * 100).toFixed(ev.fidelity >= 0.999 ? 0 : 1);
  const bestStrokes = state.best[level.level];

  return (
    <div>
      <div className="bo-label">
        Scorecard · level {level.level}/{LEVELS.length}
      </div>
      <div className="bo-well bo-golf">
        <div className="bo-golf-hole">
          <span className="bo-golf-name">
            Level {level.level} — {level.name}
          </span>
          <span className="bo-golf-qubits">
            {level.qubits} {level.qubits === 1 ? 'qubit' : 'qubits'}
          </span>
          <span className="bo-golf-ket">{level.target}</span>
        </div>
        <div className="bo-stats">
          <div className="bo-stat">
            par <b>{level.par}</b>
          </div>
          <div className="bo-stat">
            strokes <b>{ev.strokes}</b>
          </div>
          <div className="bo-stat">
            fidelity <b className={holedIn ? 'is-holed' : undefined}>{pct}%</b>
          </div>
          <div className="bo-stat">
            best <b>{bestStrokes === undefined ? '—' : bestStrokes}</b>
          </div>
        </div>
        {holedIn && (
          <div className="bo-golf-holed">
            {scoreName(bestStrokes ?? ev.strokes, level.par)} — clear the board for the next level
          </div>
        )}
        <div className="bo-golf-list" aria-label="all levels">
          {LEVELS.map((l) => (
            <div
              key={l.level}
              className={`bo-golf-chip ${l.level === level.level ? 'is-current' : ''} ${
                state.best[l.level] !== undefined ? 'is-done' : ''
              }`}
              title={`Level ${l.level} · ${l.name} · par ${l.par}`}
            >
              <span>{l.level}</span>
              <span className="bo-golf-chip-best">
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
