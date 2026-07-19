/**
 * RESULTS panel — column bars with vertical bit-stack labels.
 *
 * The outcome space is the DISPLAYED qubit count `D` (rows 0..D-1), not the
 * active subset (docs/pocket.md, "Qubit count"). The recognized circuit is
 * always five physical qubits; the display transform guarantees no gate touches
 * a row >= D, so marginalizing the remaining |0⟩ rows is exact. Bit order:
 * leftmost stack bit = q0 (top wire).
 *
 *   - D = 3 (compact default): a FIXED 8-column axis, basis order 000..111,
 *     zero-probability columns kept as dim stubs (never hidden) so visitors
 *     watch probability move between fixed columns as tiles change.
 *   - D = 4 / 5: the booth strategy — zero states hidden, > 8 nonzero → sorted
 *     top-6 + tail, a uniform spread → the compact micro pattern.
 *
 * The chart logic is ported from the booth's `display-app/src/booth/Histogram`;
 * only the class names differ (`pk-` prefix). Probabilities come from the shared
 * local statevector (imported, not copied).
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { activeQubits, statevector } from '@quantum/statevector';

const TOP_N = 6;
const ZERO_EPS = 0.001;
const UNIFORM_EPS = 0.004;
const MAX_PLAIN = 8;

export interface Outcome {
  bits: string;
  prob: number;
}

/**
 * Probabilities over the `displayQubits` displayed rows (0..D-1), in basis
 * order 000..111. Pure — the single source of truth for the panel and its
 * tests. Leftmost bit of `bits` is q0 (the top wire).
 */
export function displayOutcomes(circuit: Circuit, displayQubits: number): Outcome[] {
  const D = displayQubits;
  const sv = statevector(circuit);
  const probs = new Array<number>(1 << D).fill(0);
  for (let i = 0; i < sv.length; i++) {
    const p = sv[i].re * sv[i].re + sv[i].im * sv[i].im;
    if (p === 0) continue;
    let idx = 0;
    // r = 0 (q0) contributes the most-significant bit → top wire on the left.
    for (let r = 0; r < D; r++) idx = (idx << 1) | ((i >> r) & 1);
    probs[idx] += p;
  }
  return probs.map((prob, idx) => ({ bits: idx.toString(2).padStart(D, '0'), prob }));
}

function BitStack({ bits }: { bits: string }) {
  return (
    <span className="pk-h-stack" aria-label={bits}>
      {bits.split('').map((b, i) => (
        <span key={i}>{b}</span>
      ))}
    </span>
  );
}

function Guide({ rows }: { rows: number[] }) {
  return (
    <span className="pk-h-guide" aria-hidden="true">
      {rows.map((q) => (
        <span key={q}>q{q}</span>
      ))}
    </span>
  );
}

export function ResultsHistogram({
  circuit,
  displayQubits,
}: {
  circuit: Circuit;
  displayQubits: number;
}) {
  const D = displayQubits;
  const outcomes = useMemo(() => displayOutcomes(circuit, D), [circuit, D]);
  const rows = useMemo(() => Array.from({ length: D }, (_, r) => r), [D]);

  // D = 3: fixed 8-column axis; zero columns are dim stubs, never hidden.
  if (D === 3) {
    const max = outcomes.reduce((m, o) => Math.max(m, o.prob), 0) || 1;
    return (
      <div>
        <div className="pk-label">Results · 8 outcomes</div>
        <div className="pk-well">
          <div className="pk-h-plot">
            <Guide rows={rows} />
            {outcomes.map((o) => {
              const dim = o.prob <= ZERO_EPS;
              return (
                <div
                  className={`pk-h-col ${dim ? 'is-dim' : ''}`}
                  key={o.bits}
                  data-bits={o.bits}
                  data-prob={o.prob}
                  title={`${o.bits}: ${(o.prob * 100).toFixed(1)}%`}
                >
                  <span className="pk-h-pct">
                    {o.prob >= 0.05 ? `${Math.round(o.prob * 100)}%` : ''}
                  </span>
                  <div
                    className="pk-h-bar"
                    style={{ height: dim ? '2px' : `${(o.prob / max) * 72}%` }}
                  />
                  <BitStack bits={o.bits} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // D >= 4: booth strategy over the D-qubit outcome list.
  const active = activeQubits(circuit);
  if (active.length === 0) {
    return (
      <div>
        <div className="pk-label">Results</div>
        <div className="pk-well">
          <div className="pk-h-empty">Place a tile to see outcomes</div>
        </div>
      </div>
    );
  }

  const total = outcomes.length;
  const nonzero = outcomes.filter((o) => o.prob > ZERO_EPS);
  const max = nonzero.reduce((m, o) => Math.max(m, o.prob), 0) || 1;

  const isUniform =
    nonzero.length === total &&
    total > MAX_PLAIN &&
    nonzero.every((o) => Math.abs(o.prob - 1 / total) < UNIFORM_EPS);

  if (isUniform) {
    return (
      <div>
        <div className="pk-label">Results · {total} outcomes</div>
        <div className="pk-well">
          <div className="pk-h-plot is-micro">
            {outcomes.map((o) => (
              <div className="pk-h-col" key={o.bits} data-bits={o.bits} data-prob={o.prob}>
                <div className="pk-h-bar" style={{ height: '36%' }} />
              </div>
            ))}
          </div>
          <div className="pk-h-note">
            all outcomes ≈ {(100 / total).toFixed(1)}% — {total} equally likely
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
      <div className="pk-label">
        {nonzero.length > MAX_PLAIN
          ? `Results · top ${shown.length} of ${nonzero.length}`
          : `Results · ${shown.length} of ${total} outcomes`}
      </div>
      <div className="pk-well">
        <div className="pk-h-plot">
          <Guide rows={rows} />
          {shown.map((o) => (
            <div
              className="pk-h-col"
              key={o.bits}
              data-bits={o.bits}
              data-prob={o.prob}
              title={`${o.bits}: ${(o.prob * 100).toFixed(1)}%`}
            >
              <span className="pk-h-pct">{o.prob >= 0.05 ? `${Math.round(o.prob * 100)}%` : ''}</span>
              <div className="pk-h-bar" style={{ height: `${(o.prob / max) * 72}%` }} />
              <BitStack bits={o.bits} />
            </div>
          ))}
        </div>
        {tail.length > 0 && (
          <div className="pk-h-tail">
            + {tail.length} more outcomes ≤ {(tail[0].prob * 100).toFixed(1)}% each
          </div>
        )}
      </div>
    </div>
  );
}

export default ResultsHistogram;
