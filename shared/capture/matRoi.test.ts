// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  matRoiFromCorners,
  composeCrops,
  clampRect,
  DEFAULT_MAT_MARGIN,
  MIN_ROI_SIZE,
} from './matRoi';

describe('matRoiFromCorners', () => {
  it('boxes four corner-marker points with the default margin', () => {
    // Box 100..300 (x) × 100..200 (y): larger side 200 → margin 0.12·200 = 24.
    const roi = matRoiFromCorners(
      [
        [100, 100],
        [300, 100],
        [300, 200],
        [100, 200],
      ],
      1000,
      1000,
    )!;
    expect(roi).toEqual({ sx: 76, sy: 76, sw: 248, sh: 148 });
  });

  it('works from three corner markers (homography floor)', () => {
    // TL, TR, BL only — box 100..300 × 100..300, side 200, margin 24.
    const roi = matRoiFromCorners(
      [
        [100, 100],
        [300, 100],
        [100, 300],
      ],
      1000,
      1000,
    )!;
    expect(roi).toEqual({ sx: 76, sy: 76, sw: 248, sh: 248 });
  });

  it('scales the margin with the box (12% of the larger side)', () => {
    const roi = matRoiFromCorners(
      [
        [0, 0],
        [500, 0],
        [500, 500],
        [0, 500],
      ],
      2000,
      2000,
    )!;
    // margin = 0.12·500 = 60; box 0..500 expanded → -60..560, clamped at 0.
    expect(DEFAULT_MAT_MARGIN * 500).toBe(60);
    expect(roi).toEqual({ sx: 0, sy: 0, sw: 560, sh: 560 });
  });

  it('respects a custom margin fraction', () => {
    const roi = matRoiFromCorners(
      [
        [200, 200],
        [400, 200],
        [400, 400],
        [200, 400],
      ],
      1000,
      1000,
      { marginFrac: 0.5 },
    )!;
    // side 200, margin 100 → 100..500.
    expect(roi).toEqual({ sx: 100, sy: 100, sw: 400, sh: 400 });
  });

  it('clamps the expanded box to the frame bounds', () => {
    const roi = matRoiFromCorners(
      [
        [10, 10],
        [790, 10],
        [790, 590],
        [10, 590],
      ],
      800,
      600,
    )!;
    // margin 0.12·780 ≈ 93.6 blows past both edges → clamps to the whole frame.
    expect(roi.sx).toBe(0);
    expect(roi.sy).toBe(0);
    expect(roi.sx + roi.sw).toBeLessThanOrEqual(800);
    expect(roi.sy + roi.sh).toBeLessThanOrEqual(600);
  });

  it('enforces a minimum size for a tiny / degenerate cluster', () => {
    // A near-point cluster: margin ≈ 0, box collapses → floored to MIN_ROI_SIZE.
    const roi = matRoiFromCorners(
      [
        [500, 500],
        [502, 500],
        [500, 502],
      ],
      1000,
      1000,
    )!;
    expect(roi.sw).toBe(MIN_ROI_SIZE);
    expect(roi.sh).toBe(MIN_ROI_SIZE);
    // Kept centred and in-bounds.
    expect(roi.sx).toBeGreaterThanOrEqual(0);
    expect(roi.sx + roi.sw).toBeLessThanOrEqual(1000);
  });

  it('never exceeds a frame smaller than the minimum size', () => {
    const roi = matRoiFromCorners([[10, 10], [12, 12], [11, 10]], 20, 20)!;
    expect(roi.sx).toBe(0);
    expect(roi.sy).toBe(0);
    expect(roi.sw).toBe(20);
    expect(roi.sh).toBe(20);
  });

  it('returns null for empty input', () => {
    expect(matRoiFromCorners([], 1000, 1000)).toBeNull();
  });
});

describe('composeCrops', () => {
  it('lifts an inner crop into the outer crop’s source space (native density)', () => {
    const outer = { sx: 100, sy: 50, sw: 640, sh: 360 };
    const inner = { sx: 20, sy: 30, sw: 200, sh: 120 };
    expect(composeCrops(outer, inner)).toEqual({ sx: 120, sy: 80, sw: 200, sh: 120 });
  });

  it('is the identity offset for a full-frame outer crop', () => {
    const outer = { sx: 0, sy: 0, sw: 1920, sh: 1080 };
    const inner = { sx: 300, sy: 200, sw: 400, sh: 250 };
    expect(composeCrops(outer, inner)).toEqual(inner);
  });
});

describe('clampRect', () => {
  it('clamps an out-of-bounds rect back inside the frame', () => {
    expect(clampRect({ sx: -10, sy: -10, sw: 5000, sh: 5000 }, 1280, 720)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1280,
      sh: 720,
    });
  });
  it('keeps each side at least 1px', () => {
    const r = clampRect({ sx: 1280, sy: 720, sw: 10, sh: 10 }, 1280, 720);
    expect(r.sw).toBeGreaterThanOrEqual(1);
    expect(r.sh).toBeGreaterThanOrEqual(1);
  });
});
