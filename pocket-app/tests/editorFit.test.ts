import { describe, it, expect } from 'vitest';
import {
  editorFit,
  editorNaturalHeight,
  EDITOR_MIN_SCALE,
  EDITOR_ROW_PX,
} from '../src/app/editorFit';

describe('editorNaturalHeight', () => {
  it('is chrome + D * row height', () => {
    expect(editorNaturalHeight(3, 80, 96)).toBe(96 + 3 * 80); // 336
    expect(editorNaturalHeight(5, 80, 96)).toBe(96 + 5 * 80); // 496
  });

  it('uses QUBIT_HEIGHT (80) by default', () => {
    expect(EDITOR_ROW_PX).toBe(80);
    expect(editorNaturalHeight(1) - editorNaturalHeight(0)).toBe(80);
  });
});

describe('editorFit', () => {
  it('does not scale up when the editor already fits', () => {
    expect(editorFit(1000, 400)).toEqual({ scale: 1, scroll: false });
    expect(editorFit(400, 400)).toEqual({ scale: 1, scroll: false });
  });

  it('scales down to fit while above the min scale (no scroll)', () => {
    expect(editorFit(300, 400)).toEqual({ scale: 0.75, scroll: false });
  });

  it('clamps to the min scale and scrolls when it would go smaller', () => {
    const fit = editorFit(100, 400); // raw 0.25 < 0.45
    expect(fit.scale).toBe(EDITOR_MIN_SCALE);
    expect(fit.scroll).toBe(true);
  });

  it('exactly at the min-scale boundary still fits without scrolling', () => {
    const natural = 400;
    const fit = editorFit(natural * EDITOR_MIN_SCALE, natural);
    expect(fit.scale).toBeCloseTo(EDITOR_MIN_SCALE, 10);
    expect(fit.scroll).toBe(false);
  });

  it('is a no-op for degenerate inputs', () => {
    expect(editorFit(0, 400)).toEqual({ scale: 1, scroll: false });
    expect(editorFit(400, 0)).toEqual({ scale: 1, scroll: false });
  });

  it('composes with editorNaturalHeight — a 3-wire editor on a tall stage fits', () => {
    expect(editorFit(600, editorNaturalHeight(3)).scale).toBe(1);
    // …but a 5-wire editor in a 220px phone stage shrinks
    const fit = editorFit(220, editorNaturalHeight(5));
    expect(fit.scale).toBeLessThan(1);
  });
});
