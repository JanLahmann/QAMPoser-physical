/**
 * RESULTS panel — pocket (`pk-`) binding of the shared Histogram (SC2).
 *
 * The chart body now lives in `@shared/display/Histogram`, serving both apps via
 * `classPrefix`. Pocket keeps its two pre-SC2 traits explicitly: the uniform
 * micro columns DO carry `data-bits`/`data-prob`, and the uniform note ends at
 * "equally likely" (no trailing word). See the shared file for the full
 * outcome-space rules.
 */
import type { Circuit } from '@qamposer/react';
import { Histogram as SharedHistogram } from '@shared/display/Histogram';
import { noisyProbabilities, resolvePreset, type NoisePreset } from '@quantum/noise';

/**
 * The noisy probability series to pair with the ideal histogram, or `undefined`
 * for the ideal-only chart. Composer-only: golf stays ideal (its targets are
 * pure states), and 'off' never computes. The App memoizes the result on
 * (circuit, preset, isGolf) — the density-matrix sim is ~ms but must not re-run
 * every render.
 */
export function noiseSeries(
  circuit: Circuit,
  noise: NoisePreset,
  isGolf: boolean,
): number[] | undefined {
  return noise !== 'off' && !isGolf ? noisyProbabilities(circuit, resolvePreset(noise)) : undefined;
}

export function ResultsHistogram({
  circuit,
  displayQubits,
  noisy,
}: {
  circuit: Circuit;
  displayQubits: number;
  /** Optional noisy probability vector (from `@quantum/noise`) → paired bars. */
  noisy?: readonly number[];
}) {
  return (
    <SharedHistogram
      circuit={circuit}
      displayQubits={displayQubits}
      classPrefix="pk"
      microColData={true}
      uniformSuffix=""
      noisy={noisy}
    />
  );
}

export default ResultsHistogram;
