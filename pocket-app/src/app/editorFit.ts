/**
 * Vertical auto-fit for the controlled `CircuitEditor` (docs/pocket.md, phone
 * fixes). The @qamposer/react editor draws each wire at a fixed pixel height
 * (`QUBIT_HEIGHT` = 80) plus fixed chrome (column header + palette), so on a
 * short phone stage the wires clip. This computes a uniform `transform: scale`
 * that makes all displayed wires fit vertically, with a floor below which we
 * scroll instead of shrinking into illegibility.
 *
 * Pure and side-effect-free so it can be unit-tested: given the available
 * height and the editor's natural height, it returns the scale and whether the
 * container should scroll vertically. The app derives the natural height from
 * `editorNaturalHeight` — the design's "D wires x row height + chrome" formula
 * — since a flex-stretched editor can't be measured for its intrinsic height.
 * The chrome estimate is deliberately generous: overshooting shrinks a touch
 * more, whereas undershooting would clip — and the fit is a no-op on tablets.
 */
export const EDITOR_ROW_PX = 80; // @qamposer/react QUBIT_HEIGHT
export const EDITOR_CHROME_PX = 120; // column header + gate palette + padding (approx)
export const EDITOR_MIN_SCALE = 0.45;

export interface EditorFit {
  /** Uniform scale in (0, 1]. 1 means the editor already fits. */
  readonly scale: number;
  /** True when the editor is taller than fits even at the min scale → scroll. */
  readonly scroll: boolean;
}

/** Natural (unscaled) editor height for `displayQubits` display wires. */
export function editorNaturalHeight(
  displayQubits: number,
  rowPx: number = EDITOR_ROW_PX,
  chromePx: number = EDITOR_CHROME_PX,
): number {
  return chromePx + Math.max(0, displayQubits) * rowPx;
}

/**
 * Decide the display scale (and scroll fallback) for an editor of
 * `naturalHeight` px in a container `availableHeight` px tall.
 *   - fits already (raw ≥ 1)          → scale 1, no scroll
 *   - shrinks but stays legible        → scale = raw, no scroll
 *   - would go below `minScale`        → clamp to minScale, scroll instead
 */
export function editorFit(
  availableHeight: number,
  naturalHeight: number,
  minScale: number = EDITOR_MIN_SCALE,
): EditorFit {
  if (!(availableHeight > 0) || !(naturalHeight > 0)) return { scale: 1, scroll: false };
  const raw = availableHeight / naturalHeight;
  if (raw >= 1) return { scale: 1, scroll: false };
  if (raw >= minScale) return { scale: raw, scroll: false };
  return { scale: minScale, scroll: true };
}
