import { describe, it, expect, vi } from 'vitest';
import type { Circuit } from '@qamposer/react';
import {
  COMPOSER_BASE,
  COPIED_MESSAGE,
  NO_COPY_MESSAGE,
  canTransfer,
  composerUrl,
  transferToComposer,
  type TransferEnv,
} from './composerTransfer';

const circuit = (gates: Circuit['gates']): Circuit => ({ qubits: 5, gates });

// The exact QASM `qasmForCircuit` emits for tests/fixtures/circuits/bell.json
// (H on q0, CNOT 0→1), byte-identical to the Python golden bell.qasm.
const BELL_QASM =
  'OPENQASM 2.0;\ninclude "qelib1.inc";\n\nqreg q[5];\ncreg c[5];\n\nh q[0];\ncx q[0], q[1];\n';

describe('canTransfer', () => {
  it('is true once the circuit has a gate', () => {
    expect(canTransfer(circuit([{ id: 'h-0-0', type: 'H', qubit: 0, position: 0 }]))).toBe(true);
  });
  it('is false for an empty circuit', () => {
    expect(canTransfer(circuit([]))).toBe(false);
  });
});

describe('composerUrl', () => {
  // The current cloud Composer takes no circuit URL param (verified against its
  // full client bundle, 2026-07-19) — it is simply the plain editor URL.
  it('is the plain Composer editor URL with no circuit param', () => {
    expect(composerUrl()).toBe(COMPOSER_BASE);
    expect(composerUrl()).not.toContain('?');
  });
});

describe('transferToComposer', () => {
  const makeEnv = (over: Partial<TransferEnv> = {}): TransferEnv => ({
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    execCopy: vi.fn().mockReturnValue(true),
    open: vi.fn(),
    ...over,
  });

  it('copies via the clipboard and opens the Composer tab (happy path)', async () => {
    const env = makeEnv();
    const result = await transferToComposer(BELL_QASM, env);
    expect(env.clipboard!.writeText).toHaveBeenCalledWith(BELL_QASM);
    expect(env.execCopy).not.toHaveBeenCalled();
    expect(env.open).toHaveBeenCalledWith(composerUrl(), '_blank', 'noopener');
    expect(result).toMatchObject({ copied: true, opened: true, message: COPIED_MESSAGE });
  });

  it('falls back to execCommand copy when the clipboard rejects', async () => {
    const execCopy = vi.fn().mockReturnValue(true);
    const env = makeEnv({
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      execCopy,
    });
    const result = await transferToComposer(BELL_QASM, env);
    expect(execCopy).toHaveBeenCalledWith(BELL_QASM);
    expect(result.copied).toBe(true);
    expect(result.message).toBe(COPIED_MESSAGE);
  });

  it('still opens the tab and adapts the toast when both copy paths fail', async () => {
    const env = makeEnv({
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      execCopy: vi.fn().mockReturnValue(false),
    });
    const result = await transferToComposer(BELL_QASM, env);
    expect(env.open).toHaveBeenCalledWith(composerUrl(), '_blank', 'noopener');
    expect(result).toMatchObject({ copied: false, opened: true, message: NO_COPY_MESSAGE });
  });

  it('reports not-opened without throwing when window.open fails', async () => {
    const env = makeEnv({
      open: vi.fn(() => {
        throw new Error('popup blocked');
      }),
    });
    const result = await transferToComposer(BELL_QASM, env);
    expect(result.opened).toBe(false);
    expect(result.copied).toBe(true);
  });
});
