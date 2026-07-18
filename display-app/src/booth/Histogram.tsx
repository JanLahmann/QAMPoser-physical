/**
 * RESULTS panel — column bars with vertical bit-stack labels, zero states
 * hidden (booth v2, final form per docs/booth-ux.md).
 *
 * Bars stand side by side; each column's label is its bit-string stacked
 * vertically beneath it, top bit = q0 — mirroring the wire order — with a
 * faint `q0…` guide column at the left. Basis states with probability ~0 are
 * hidden, which is what makes columns scale: Bell/GHZ show 2 columns, shallow
 * circuits show few. Strategies:
 *   no active qubits      → empty hint
 *   ≤ 8 nonzero outcomes  → all columns, basis order
 *   > 8 nonzero           → uniform: micro-column pattern + callout;
 *                           otherwise sorted top-6 + aggregated-tail note.
 * Probabilities come from the local statevector (ideal), reduced onto the
 * active qubits — inactive qubits are |0⟩ and marginalize away exactly.
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { activeQubits, DIM, NUM_QUBITS, statevector } from '../quantum/statevector';

const TOP_N = 6;
const ZERO_EPS = 0.001;
const UNIFORM_EPS = 0.004;
const MAX_PLAIN = 8;

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

function Guide({ active }: { active: number[] }) {
  return (
    <span className="bo-h-guide" aria-hidden="true">
      {active.map((q) => (
        <span key={q}>q{q}</span>
      ))}
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

  const total = outcomes.length;
  const nonzero = outcomes.filter((o) => o.prob > ZERO_EPS);
  const max = nonzero.reduce((m, o) => Math.max(m, o.prob), 0) || 1;

  // Uniform superposition: a featured state, not a failed chart.
  const isUniform =
    nonzero.length === total &&
    total > MAX_PLAIN &&
    nonzero.every((o) => Math.abs(o.prob - 1 / total) < UNIFORM_EPS);

  if (isUniform) {
    return (
      <div>
        <div className="bo-label">Results · {total} outcomes</div>
        <div className="bo-well">
          <div className="bo-h-plot is-micro">
            {outcomes.map((o) => (
              <div className="bo-h-col" key={o.bits}>
                <div className="bo-h-bar" style={{ height: '36%' }} />
              </div>
            ))}
          </div>
          <div className="bo-h-note">
            all outcomes ≈ {(100 / total).toFixed(1)}% — {total} equally likely
            possibilities
          </div>
        </div>
      </div>
    );
  }

  let shown = nonzero;
  let tail: Outcome[] = [];
  if (nonzero.length > MAX_PLAIN) {
    const sorted = [...nonzero].sort((a, b) => b.prob - a.prob);
    shown = sorted.slice(0, TOP_N);
    tail = sorted.slice(TOP_N);
  }

  return (
    <div>
      <div className="bo-label">
        {nonzero.length > MAX_PLAIN
          ? `Results · top ${shown.length} of ${nonzero.length}`
          : `Results · ${shown.length} of ${total} outcomes`}
      </div>
      <div className="bo-well">
        <div className="bo-h-plot">
          <Guide active={active} />
          {shown.map((o) => (
            <div
              className="bo-h-col"
              key={o.bits}
              title={`${o.bits}: ${(o.prob * 100).toFixed(1)}%`}
            >
              <span className="bo-h-pct">
                {o.prob >= 0.05 ? `${Math.round(o.prob * 100)}%` : ''}
              </span>
              <div
                className="bo-h-bar"
                style={{ height: `${(o.prob / max) * 72}%` }}
              />
              <BitStack bits={o.bits} />
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
