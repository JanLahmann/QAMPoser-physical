/**
 * OPENQASM panel — the last few QASM lines with gate-tinted colouring (SC2
 * shared). Serves both apps via `classPrefix` (`bo` / `pk`).
 *
 * The QASM SOURCE differs per app, so callers pass the already-sliced `lines`:
 * the booth feeds the server-provided `qasm` string (last 7 lines) and hides the
 * panel when empty (`hideWhenEmpty`); pocket generates QASM locally via
 * `qasmForCircuit` (last 8 lines) and always renders. The tint table + markup
 * are the shared duplicate this consolidates.
 */
import type { ReactElement } from 'react';

/** QASM gate-line tint (gate colours at ~75–85% on the dark inset). */
export const QASM_TINTS: ReadonlyArray<[RegExp, string]> = [
  [/^h /, 'rgba(250, 77, 86, 0.75)'],
  [/^(x|cx) /, 'rgba(94, 132, 235, 0.85)'],
  [/^(y|rx|ry)/, 'rgba(214, 82, 150, 0.8)'],
  [/^(z|rz|s |t )/, 'rgba(51, 177, 255, 0.75)'],
];

export function QasmPanel({
  lines,
  classPrefix,
  hideWhenEmpty = false,
}: {
  lines: string[];
  classPrefix: string;
  hideWhenEmpty?: boolean;
}): ReactElement | null {
  const p = classPrefix;
  if (hideWhenEmpty && lines.length === 0) return null;
  return (
    <div>
      <div className={`${p}-label`}>OpenQASM 2.0</div>
      <div className={`${p}-well ${p}-qasm`}>
        {lines.map((line, i) => {
          const tint = QASM_TINTS.find(([re]) => re.test(line))?.[1];
          const isKw = /^(OPENQASM|include|qreg|creg)/.test(line);
          return (
            <div key={i} className={isKw ? 'kw' : undefined} style={tint ? { color: tint } : undefined}>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default QasmPanel;
