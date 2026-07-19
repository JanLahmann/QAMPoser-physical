/**
 * OPENQASM panel — pocket (`pk-`) binding of the shared QasmPanel (SC2). Pocket
 * generates the QASM locally via `qasmForCircuit` (no server) and shows the last
 * eight non-empty lines; the tinting + markup live in
 * `@shared/display/QasmPanel`.
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { qasmForCircuit } from './qasm';
import { QasmPanel as SharedQasmPanel } from '@shared/display/QasmPanel';

export function QasmPanel({ circuit }: { circuit: Circuit }) {
  const lines = useMemo(() => {
    const qasm = qasmForCircuit(circuit);
    return qasm.split('\n').filter((l) => l.trim().length > 0).slice(-8);
  }, [circuit]);

  return <SharedQasmPanel lines={lines} classPrefix="pk" />;
}

export default QasmPanel;
