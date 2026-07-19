/**
 * Quantum Golf scorecard — pocket (`pk-`) binding of the shared Scorecard (SC2).
 * The body lives in `@shared/display/Scorecard`; pocket reads the best-of-device
 * latched golf state and tints its target ket monospace (`monoKet`).
 */
import type { Circuit } from '@qamposer/react';
import type { GolfState } from '@quantum/golf';
import { Scorecard as SharedScorecard } from '@shared/display/Scorecard';

export function Scorecard({ state, circuit }: { state: GolfState; circuit: Circuit }) {
  return <SharedScorecard state={state} circuit={circuit} classPrefix="pk" monoKet />;
}

export default Scorecard;
