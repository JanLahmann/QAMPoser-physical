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
 * The chart math is the shared booth/Pocket rule (`@shared/display/outcomes`);
 * only the class names differ (`pk-` prefix). Probabilities come from the shared
 * local statevector (imported, not copied).
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { activeQubits } from '@quantum/statevector';
import {
  displayOutcomes,
  TOP_N,
  ZERO_EPS,
  UNIFORM_EPS,
  MAX_PLAIN,
  type Outcome,
} from '@shared/display/outcomes';

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
