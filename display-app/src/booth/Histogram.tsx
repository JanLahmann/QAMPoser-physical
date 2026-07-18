/**
 * RESULTS panel — vertical histogram with vertical bit-stack labels (booth v2).
 *
 * Outcomes stack vertically as rows and bars grow horizontally; each row's
 * label is its bit-string written vertically, top bit = q0 — mirroring the
 * wire order on the stage. A faint `q0…` guide sits beside the FIRST row only
 * (one-time legend; every row shares the layout). Per docs/booth-ux.md
 * (variant-A refinements, confirmed row-form):
 *   k = 0  → empty hint
 *   k ≤ 3  → all 2^k outcomes as rows
 *   k > 3  → uniform: label-less micro-row pattern + callout;
 *            otherwise sorted top-6 rows + aggregated-tail note.
 * Probabilities come from the local statevector (ideal), reduced onto the
 * active qubits — inactive qubits are |0⟩ and marginalize away exactly.
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { activeQubits, DIM, NUM_QUBITS, statevector } from '../quantum/statevector';

const TOP_N = 6;
const UNIFORM_EPS = 0.004;

interface Outcome {
  bits: string; // one char per active qubit, top(=first active) first
  prob: number;
}

function reducedOutcomes(circuit: Circuit, active: number[]): Outcome[] {
  const sv = statevector(circuit);
  const k = active.length;
  const probs = new Array<number>(1 << k).fill(0);
  for (let i = 0; i < DIM; i++) {
    const p = sv[i].re * sv[i].re + sv[i].im * sv[i].im;
    if (p === 0) continue;
    let idx = 0;
    for (let b = 0; b < k; b++) {
      idx = (idx << 1) | ((i >> (NUM_QUBITS - 1 - active[b])) & 1);
    }
    probs[idx] += p;
  }
  return probs.map((prob, idx) => ({
    bits: idx.toString(2).padStart(k, '0'),
    prob,
  }));
}

function BitStack({ bits }: { bits: string }) {
  return (
    <span className="bo-h-stack" aria-label={bits}>
      {bits.split('').map((b, i) => (
        <span key={i}>{b}</span>
      ))}
    </span>
  );
}

/** One-time legend: q-labels beside the first row's stack; spacer elsewhere. */
function Guide({ active, first }: { active: number[]; first: boolean }) {
  return (
    <span className="bo-h-guide" aria-hidden="true">
      {first ? active.map((q) => <span key={q}>q{q}</span>) : null}
    </span>
  );
}

export function Histogram({ circuit }: { circuit: Circuit }) {
  const active = useMemo(() => activeQubits(circuit), [circuit]);
  const outcomes = useMemo(
    () => (active.length === 0 ? [] : reducedOutcomes(circuit, active)),
    [circuit, active],
  );

  if (active.length === 0) {
    return (
      <div>
        <div className="bo-label">Results</div>
        <div className="bo-well">
          <div className="bo-h-empty">Place a tile to see outcomes</div>
        </div>
      </div>
    );
  }

  const k = active.length;
  const count = outcomes.length;
  const max = outcomes.reduce((m, o) => Math.max(m, o.prob), 0) || 1;

  // Uniform superposition: a featured state, not a failed chart.
  const isUniform =
    k > 3 && outcomes.every((o) => Math.abs(o.prob - 1 / count) < UNIFORM_EPS);

  if (isUniform) {
    return (
      <div>
        <div className="bo-label">Results · {count} outcomes</div>
        <div className="bo-well">
          <div className="bo-h-plot is-micro">
            {outcomes.map((o) => (
              <div className="bo-h-row" key={o.bits}>
                <span className="bo-h-track">
                  <span className="bo-h-fill" style={{ width: '58%' }} />
                </span>
              </div>
            ))}
          </div>
          <div className="bo-h-note">
            all outcomes ≈ {(100 / count).toFixed(1)}% — {count} equally likely
            possibilities
          </div>
        </div>
      </div>
    );
  }

  let shown = outcomes;
  let tail: Outcome[] = [];
  if (k > 3) {
    const sorted = [...outcomes].sort((a, b) => b.prob - a.prob);
    shown = sorted.slice(0, TOP_N);
    tail = sorted.slice(TOP_N).filter((o) => o.prob > 0.0005);
  }

  return (
    <div>
      <div className="bo-label">
        {k > 3 ? `Results · top ${shown.length} of ${count}` : 'Results · active qubits'}
      </div>
      <div className="bo-well">
        <div className="bo-h-plot">
          {shown.map((o, i) => (
            <div
              className="bo-h-row"
              key={o.bits}
              title={`${o.bits}: ${(o.prob * 100).toFixed(1)}%`}
            >
              <Guide active={active} first={i === 0} />
              <BitStack bits={o.bits} />
              <span className="bo-h-track">
                <span
                  className={`bo-h-fill ${o.prob < 0.004 ? 'is-dim' : ''}`}
                  style={{ width: `${Math.max((o.prob / max) * 100, 1)}%` }}
                />
              </span>
              <span className="bo-h-pct">
                {o.prob >= 0.05 ? `${Math.round(o.prob * 100)}%` : ''}
              </span>
            </div>
          ))}
        </div>
        {tail.length > 0 && (
          <div className="bo-h-tail">
            + {tail.length} more outcomes ≤ {(tail[0].prob * 100).toFixed(1)}% each
          </div>
        )}
      </div>
    </div>
  );
}

export default Histogram;
