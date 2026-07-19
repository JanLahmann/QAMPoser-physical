/**
 * One-shot mat detection for the camera-role "Frame the mat" control (task #34).
 *
 * A single tap grabs the current camera frame, runs the EXISTING hand-rolled
 * ArUco detector once, keeps only the four corner fiducials (ids 0-3), and turns
 * their positions into an axis-aligned crop rectangle (see `@shared/capture/matRoi`).
 * The stream then locks to that rect so only the mat region is transferred and
 * analysed by the host. This is a rough one-shot calibration, not a continuous
 * track — a physical re-aim re-runs it.
 *
 * The detector is the same `detectMarkers` the standalone pipeline uses; we ask
 * for a plain (non-guided) single pass, which is the cheapest way to get corner
 * positions — the guided redetection / stabilizer are about tile tracking over
 * time and add nothing to a one-shot corner grab.
 */
import { detectMarkers, type DetectedMarker, type RgbaImage } from './detect';
import { CORNER_IDS, MIN_CORNERS_FOR_BOARD } from './geometry';
import { matRoiFromCorners, composeCrops, type Rect, type MatRoiOptions } from '@shared/capture/matRoi';

export type MatRoiResult =
  | { readonly ok: true; readonly roi: Rect; readonly cornerIds: number[] }
  | { readonly ok: false; readonly reason: 'too-few-corners'; readonly cornersSeen: number };

/** Injectable detector (tests supply a mock; production uses `detectMarkers`). */
export type MarkerDetector = (image: RgbaImage) => DetectedMarker[];

/**
 * Pure core: from markers detected INSIDE `crop` (their corners are in the crop's
 * local px space, i.e. `[0..crop.sw] × [0..crop.sh]`), compute the mat ROI in the
 * original source space. Keeps only distinct corner ids 0-3; fails (without
 * throwing) when fewer than {@link MIN_CORNERS_FOR_BOARD} are visible — the same
 * floor the board homography needs, so a lock that would starve host detection is
 * refused up front.
 */
export function matRoiFromMarkers(
  markers: DetectedMarker[],
  crop: Rect,
  opts: MatRoiOptions = {},
): MatRoiResult {
  const seen = new Set<number>();
  const points: Array<readonly [number, number]> = [];
  for (const m of markers) {
    if (!(String(m.id) in CORNER_IDS)) continue;
    seen.add(m.id);
    // Bound the marker's whole quad (not just its centre) so the margin is
    // measured from each fiducial's outer extent — the quiet zone lives just
    // beyond these corners, and the margin must keep it inside the crop.
    for (const c of m.corners) points.push(c);
  }

  if (seen.size < MIN_CORNERS_FOR_BOARD) {
    return { ok: false, reason: 'too-few-corners', cornersSeen: seen.size };
  }

  const local = matRoiFromCorners(points, crop.sw, crop.sh, opts);
  if (local === null) {
    return { ok: false, reason: 'too-few-corners', cornersSeen: seen.size };
  }
  return {
    ok: true,
    roi: composeCrops(crop, local),
    cornerIds: [...seen].sort((a, b) => a - b),
  };
}

export interface DetectMatRoiOptions extends MatRoiOptions {
  /** Injectable detector (default {@link detectMarkers}); tests mock it. */
  readonly detect?: MarkerDetector;
}

/**
 * DOM wrapper: draw the current `crop` region of `video` at native density onto a
 * scratch canvas, run the detector once, and reduce to a mat ROI. Returns a clear
 * failure when the frame isn't ready, the canvas is unusable, or fewer than three
 * corners are seen.
 */
export function detectMatRoi(
  video: HTMLVideoElement,
  crop: Rect,
  opts: DetectMatRoiOptions = {},
): MatRoiResult {
  const detect = opts.detect ?? detectMarkers;
  const { sw, sh } = crop;
  if (!(sw > 0 && sh > 0)) return { ok: false, reason: 'too-few-corners', cornersSeen: 0 };

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: 'too-few-corners', cornersSeen: 0 };
  ctx.drawImage(video, crop.sx, crop.sy, sw, sh, 0, 0, sw, sh);
  const image = ctx.getImageData(0, 0, sw, sh);

  const markers = detect({ data: image.data, width: sw, height: sh });
  return matRoiFromMarkers(markers, crop, opts);
}
