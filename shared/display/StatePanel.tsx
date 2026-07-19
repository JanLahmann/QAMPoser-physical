/**
 * STATE panel — a compact three-stat summary of the live circuit (SC2).
 *
 * Serves both apps via the `classPrefix` seam (`bo` on the booth, `pk` in
 * pocket); the markup was byte-identical between the two before consolidation.
 * Stats: qubits touched (active-qubit count), gate count, and distinct columns.
 * Reads only the circuit — no statevector, so it is cheap on every change.
 */
import type { Circuit } from '@qamposer/react';
import { activeQubits } from '@quantum/statevector';

export function StatePanel({
  circuit,
  classPrefix,
}: {
  circuit: Circuit;
  classPrefix: string;
}) {
  const p = classPrefix;
  const touched = activeQubits(circuit).length;
  const columns = new Set(circuit.gates.map((g) => g.position)).size;
  return (
    <div>
      <div className={`${p}-label`}>State</div>
      <div className={`${p}-stats`}>
        <div className={`${p}-stat`}>
          qubits touched <b>{touched}</b>
        </div>
        <div className={`${p}-stat`}>
          gates <b>{circuit.gates.length}</b>
        </div>
        <div className={`${p}-stat`}>
          columns <b>{columns}</b>
        </div>
      </div>
    </div>
  );
}

export default StatePanel;
