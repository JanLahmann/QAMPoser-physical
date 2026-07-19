/**
 * RESULTS panel — booth (`bo-`) binding of the shared Histogram (SC2).
 *
 * The chart body now lives in `@shared/display/Histogram`, serving both apps via
 * `classPrefix`. The booth keeps its two pre-SC2 traits explicitly: the uniform
 * micro columns carry NO `data-bits`/`data-prob` (touch-inspect targets only the
 * fixed-axis histogram on the booth), and the uniform note ends with
 * " possibilities". See the shared file for the full outcome-space rules.
 */
import type { Circuit } from '@qamposer/react';
import { Histogram as SharedHistogram } from '@shared/display/Histogram';

export function Histogram({
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
      classPrefix="bo"
      microColData={false}
      uniformSuffix=" possibilities"
    />
  );
}

export default Histogram;
