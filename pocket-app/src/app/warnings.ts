/**
 * Pocket adapter over the shared `friendlyWarning` (`@shared/display/warnings`).
 *
 * The shared function keys off a neutral `code`; the Pocket pipeline carries
 * warnings as `BuildWarning`, whose discriminant is `kind`. This one-line
 * bridge maps `kind → code` (including the Pocket-only `off_grid`) and forwards
 * the column + message so the wording — and the `lone_swap` message passthrough
 * — stays identical.
 */
import { friendlyWarning as sharedFriendlyWarning } from '@shared/display/warnings';
import type { BuildWarning } from '../vision/circuitBuilder';

export function friendlyWarning(w: BuildWarning): string {
  return sharedFriendlyWarning({ code: w.kind, col: w.col, message: w.message });
}
