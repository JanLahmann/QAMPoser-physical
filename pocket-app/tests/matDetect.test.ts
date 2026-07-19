// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { matRoiFromMarkers } from '../src/vision/matDetect';
import type { Corner, DetectedMarker } from '../src/vision/detect';

/** A square marker centred at (cx, cy) with half-size `h` (image px). */
function marker(id: number, cx: number, cy: number, h = 20): DetectedMarker {
  const corners: [Corner, Corner, Corner, Corner] = [
    [cx - h, cy - h],
    [cx + h, cy - h],
    [cx + h, cy + h],
    [cx - h, cy + h],
  ];
  return { id, rotation: 0, corners, center: [cx, cy] };
}

const FULL = { sx: 0, sy: 0, sw: 1000, sh: 1000 };

describe('matRoiFromMarkers (one-shot detection wiring)', () => {
  it('turns four corner markers into a mat ROI', () => {
    const markers = [
      marker(0, 100, 100), // TL
      marker(1, 900, 100), // TR
      marker(2, 900, 900), // BR
      marker(3, 100, 900), // BL
    ];
    const res = matRoiFromMarkers(markers, FULL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cornerIds).toEqual([0, 1, 2, 3]);
    // The ROI must contain every corner marker's extent (host homography needs
    // all four fiducials on the cropped frame).
    expect(res.roi.sx).toBeLessThanOrEqual(80);
    expect(res.roi.sy).toBeLessThanOrEqual(80);
    expect(res.roi.sx + res.roi.sw).toBeGreaterThanOrEqual(920);
    expect(res.roi.sy + res.roi.sh).toBeGreaterThanOrEqual(920);
  });

  it('succeeds with the three-corner homography floor', () => {
    const res = matRoiFromMarkers(
      [marker(0, 200, 200), marker(1, 800, 200), marker(3, 200, 800)],
      FULL,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cornerIds).toEqual([0, 1, 3]);
  });

  it('fails (too-few-corners) with only two corner markers', () => {
    const res = matRoiFromMarkers([marker(0, 200, 200), marker(1, 800, 200)], FULL);
    expect(res).toEqual({ ok: false, reason: 'too-few-corners', cornersSeen: 2 });
  });

  it('ignores non-corner (tile) markers when counting corners', () => {
    const res = matRoiFromMarkers(
      [marker(0, 200, 200), marker(1, 800, 200), marker(17, 500, 500)],
      FULL,
    );
    // Two distinct corners + a tile marker → still short of the floor.
    expect(res).toEqual({ ok: false, reason: 'too-few-corners', cornersSeen: 2 });
  });

  it('counts each corner id once (duplicates do not inflate the count)', () => {
    const res = matRoiFromMarkers(
      [marker(0, 200, 200), marker(0, 210, 210), marker(1, 800, 200)],
      FULL,
    );
    expect(res).toEqual({ ok: false, reason: 'too-few-corners', cornersSeen: 2 });
  });

  it('lifts the ROI into the source space of a non-zero (zoomed) crop', () => {
    // Detection ran inside a zoom crop offset by (200, 100); composeCrops must
    // translate the ROI back to source px.
    const crop = { sx: 200, sy: 100, sw: 1000, sh: 1000 };
    const markers = [
      marker(0, 100, 100),
      marker(1, 900, 100),
      marker(2, 900, 900),
      marker(3, 100, 900),
    ];
    const res = matRoiFromMarkers(markers, crop);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Local ROI clamps to sx=0 here, so source sx is exactly the crop origin.
    expect(res.roi.sx).toBe(200);
    expect(res.roi.sy).toBe(100);
  });
});
