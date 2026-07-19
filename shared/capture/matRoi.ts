/**
 * Mat ROI geometry — the pure math behind the booth "Frame the mat" setup helper
 * (task #34; Jan's ask: a rough, one-shot calibration so a dedicated booth camera
 * streams and analyses ONLY the printed mat region — saving bandwidth on the
 * remote stream, speeding host detection, and keeping hands/faces outside the mat
 * off the wire entirely).
 *
 * "Rough" is deliberate: this computes an **axis-aligned** crop rectangle (the
 * bounding box of the detected corner markers, expanded by a margin), NOT a
 * perspective warp. The margin's job is to keep every corner marker — WITH its
 * printed white quiet zone — comfortably inside the crop, so the host-side
 * homography (which needs those four fiducials) keeps working on the cropped
 * frames. Shrink the margin and you risk clipping a marker's quiet zone and
 * killing the board lock; that is why it defaults generous.
 *
 * No DOM here — all of it is plain arithmetic, unit-tested with values. The
 * camera-role wiring (grab a frame, run the detector once, lock the stream to the
 * ROI) lives in `pocket-app/src/vision/matDetect.ts` + `useCamera`.
 */

/** A source rectangle for `ctx.drawImage(video, sx, sy, sw, sh, …)` — structurally
 *  identical to `zoom.ts`'s `CropRect`, so the two interop without conversion. */
export interface Rect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/**
 * Default margin as a fraction of the corner-marker bounding box's LARGER side.
 * 12 % keeps the fiducials and their quiet zones well clear of the crop edge over
 * the rough hand-aimed framing this helper targets — the host homography dies the
 * moment a corner's quiet zone is clipped, so we err wide (bandwidth is cheap
 * relative to a lost board lock).
 */
export const DEFAULT_MAT_MARGIN = 0.12;

/** Floor on the ROI's width/height in px — a degenerate/near-collinear marker
 *  cluster can't produce a sliver crop the encoder/host would choke on. */
export const MIN_ROI_SIZE = 48;

export interface MatRoiOptions {
  /** Margin as a fraction of the box's larger side (default {@link DEFAULT_MAT_MARGIN}). */
  readonly marginFrac?: number;
  /** Minimum ROI side in px (default {@link MIN_ROI_SIZE}). */
  readonly minSize?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Grow a 1-D interval `[pos, pos+size]` to at least `min`, keeping it centred and
 * inside `[0, extent]`. When the frame itself is smaller than `min` the interval
 * simply spans the frame. Returns integer `[pos, size]`.
 */
function enforceMin(pos: number, size: number, min: number, extent: number): [number, number] {
  if (size >= min) return [pos, size];
  const target = Math.min(min, extent);
  const newPos = clamp(pos - (target - size) / 2, 0, extent - target);
  return [Math.round(newPos), Math.round(target)];
}

/**
 * Axis-aligned crop = bounding box of `points` (image-px), expanded by a margin,
 * clamped to the frame, and floored to a minimum size. `points` are the corners
 * of the detected corner markers, so the box hugs the fiducials and the margin
 * carries their quiet zones. Returns `null` for empty input (no fiducials).
 */
export function matRoiFromCorners(
  points: ReadonlyArray<readonly [number, number]>,
  frameW: number,
  frameH: number,
  opts: MatRoiOptions = {},
): Rect | null {
  if (points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  const margin = (opts.marginFrac ?? DEFAULT_MAT_MARGIN) * Math.max(boxW, boxH);

  const x0 = clamp(minX - margin, 0, frameW);
  const y0 = clamp(minY - margin, 0, frameH);
  const x1 = clamp(maxX + margin, 0, frameW);
  const y1 = clamp(maxY + margin, 0, frameH);

  const sx0 = Math.floor(x0);
  const sy0 = Math.floor(y0);
  const sw0 = Math.min(Math.ceil(x1) - sx0, frameW - sx0);
  const sh0 = Math.min(Math.ceil(y1) - sy0, frameH - sy0);

  const minSize = opts.minSize ?? MIN_ROI_SIZE;
  const [sx, sw] = enforceMin(sx0, Math.max(1, sw0), minSize, frameW);
  const [sy, sh] = enforceMin(sy0, Math.max(1, sh0), minSize, frameH);
  return { sx, sy, sw, sh };
}

/**
 * Clamp an arbitrary rect to `[0,w]×[0,h]`, keeping each side ≥ 1 px. A defensive
 * guard for a stored ROI that outlives a resolution change.
 */
export function clampRect(r: Rect, w: number, h: number): Rect {
  const sx = clamp(r.sx, 0, w);
  const sy = clamp(r.sy, 0, h);
  const sw = Math.max(1, Math.min(r.sw, w - sx));
  const sh = Math.max(1, Math.min(r.sh, h - sy));
  return { sx, sy, sw, sh };
}

/**
 * Compose an `inner` crop expressed in an `outer` crop's LOCAL pixel space back
 * into the original source (video) space. Assumes the outer crop was rendered at
 * native pixel density (the streaming sink draws `outer` into a canvas sized
 * `outer.sw × outer.sh` — "what you zoom is what streams"), so the mapping is a
 * plain 1:1 translate by the outer origin. Used to lift a mat ROI detected inside
 * the current (zoomed) crop back to a source-space rect the sink can draw.
 */
export function composeCrops(outer: Rect, inner: Rect): Rect {
  return {
    sx: outer.sx + inner.sx,
    sy: outer.sy + inner.sy,
    sw: inner.sw,
    sh: inner.sh,
  };
}
