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

export function ResultsHistogram({
  circuit,
  displayQubits,
}: {
  circuit: Circuit;
  displayQubits: number;
}) {
  return (
    <SharedHistogram
      circuit={circuit}
      displayQubits={displayQubits}
      classPrefix="pk"
      microColData={true}
      uniformSuffix=""
    />
  );
}

export default ResultsHistogram;
