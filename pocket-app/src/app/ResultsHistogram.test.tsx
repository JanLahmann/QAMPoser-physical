// @vitest-environment jsdom
/**
 * RESULTS wiring for the in-browser noise model (NM1). `noiseSeries` is the
 * App's single decision point — compute a noisy series only when a preset is on
 * AND we are not in golf (golf targets are pure states, so golf stays ideal) —
 * and `ResultsHistogram` forwards it to the shared Histogram as a paired series.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Circuit, Gate } from '@qamposer/react';
import { ResultsHistogram, noiseSeries } from './ResultsHistogram';

afterEach(cleanup);

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });
const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });
const bell = circuit([
  g({ type: 'H', qubit: 0, position: 0 }),
  g({ type: 'CNOT', control: 0, target: 1, position: 1 }),
]);

describe('noiseSeries', () => {
  it('is undefined when noise is off', () => {
    expect(noiseSeries(bell, 'off', false)).toBeUndefined();
  });

  it('stays ideal (undefined) in golf even with a preset on', () => {
    expect(noiseSeries(bell, 'heron', true)).toBeUndefined();
  });

  it('computes a length-32 probability vector for a device preset in composer', () => {
    const v = noiseSeries(bell, 'heron', false);
    expect(v).toBeDefined();
    expect(v!).toHaveLength(32);
    const sum = v!.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    // Depolarizing + readout erode the Bell peaks below the ideal 0.5.
    expect(v![0]).toBeLessThan(0.5);
    expect(v![0]).toBeGreaterThan(0.3);
  });
});

describe('ResultsHistogram noise wiring', () => {
  it("noise='heron' renders a paired histogram (noisy bars + legend)", () => {
    const { container } = render(
      <ResultsHistogram
        circuit={bell}
        displayQubits={5}
        noisy={noiseSeries(bell, 'heron', false)}
      />,
    );
    expect(container.querySelector('.pk-h-bar--noisy')).not.toBeNull();
    expect(container.querySelector('.pk-h-legend')).not.toBeNull();
  });

  it("noise='off' passes no noisy series → the ideal-only chart", () => {
    const { container } = render(
      <ResultsHistogram
        circuit={bell}
        displayQubits={5}
        noisy={noiseSeries(bell, 'off', false)}
      />,
    );
    expect(container.querySelector('.pk-h-bar--noisy')).toBeNull();
    expect(container.querySelector('.pk-h-legend')).toBeNull();
  });
});
