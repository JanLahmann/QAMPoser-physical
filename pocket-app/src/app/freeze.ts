/**
 * Freeze — the pure decision logic behind the Pocket "Freeze" control
 * (docs/pocket.md; requested by Jan for hand-held use: build the circuit,
 * freeze, then walk around showing the frozen result without the camera picking
 * up noise).
 *
 * Freeze is always session-momentary (persists nothing; starts unfrozen). When
 * frozen: the processing loop stops feeding frames to the vision pipeline (no
 * new detections / circuit changes) and the preview <video> is paused so the
 * picture visibly holds. These helpers hold the framework-free bits so they
 * unit-test without a camera; the wiring lives in `useCamera` / `App`.
 */

/** The next freeze flag when the toggle (pill / 'f' key) fires. */
export function toggleFrozen(frozen: boolean): boolean {
  return !frozen;
}

/** Whether the rAF loop should process a frame through the pipeline. */
export function shouldProcess(frozen: boolean): boolean {
  return !frozen;
}

/** What to do to the preview <video> when the freeze / running state changes. */
export type VideoFreezeAction = 'pause' | 'play' | 'none';

/**
 * Pause the preview while frozen, resume it while live; do nothing when the
 * camera is not running (there is no live picture to pause). iOS Safari resumes
 * a `MediaStream`-backed <video> fine from `play()`; the still overlay canvas is
 * the belt-and-braces fallback (its last frame stays drawn while we skip
 * processing).
 */
export function videoFreezeAction(frozen: boolean, running: boolean): VideoFreezeAction {
  if (!running) return 'none';
  return frozen ? 'pause' : 'play';
}

/** Apply a {@link VideoFreezeAction} to a video element (best-effort). */
export function applyVideoFreeze(
  video: HTMLVideoElement | null,
  action: VideoFreezeAction,
): void {
  if (!video) return;
  if (action === 'pause') {
    video.pause();
  } else if (action === 'play') {
    const p = video.play?.();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  }
}
