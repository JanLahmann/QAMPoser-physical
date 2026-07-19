// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { frameStreamCrop } from '../src/app/matStream';
import { cropRect } from '../src/app/zoom';
import { shouldProcess } from '../src/app/freeze';

describe('frameStreamCrop (camera-role streaming crop)', () => {
  it('streams the digital-zoom crop when the mat is not locked', () => {
    expect(frameStreamCrop(null, 2, 1920, 1080)).toEqual(cropRect(2, 1920, 1080));
    expect(frameStreamCrop(null, 1, 1280, 720)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it('streams the mat ROI (replacing the zoom) while locked', () => {
    const mat = { sx: 100, sy: 50, sw: 400, sh: 300 };
    // Even with a 2× digital zoom set, the lock wins — the sink draws the ROI.
    expect(frameStreamCrop(mat, 2, 1920, 1080)).toEqual(mat);
  });

  it('clamps a stored ROI defensively to the current frame', () => {
    const oversize = { sx: -10, sy: -10, sw: 5000, sh: 5000 };
    expect(frameStreamCrop(oversize, 1, 1280, 720)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1280,
      sh: 720,
    });
  });

  it('freeze still pauses the pump while locked (freeze is gated upstream)', () => {
    // The rAF loop checks shouldProcess(paused) BEFORE it reaches the sink /
    // frameStreamCrop, so a mat lock never bypasses freeze: frozen → no frame.
    expect(shouldProcess(true)).toBe(false); // frozen: pump paused
    expect(shouldProcess(false)).toBe(true); // live: pump runs (then locks crop)
  });
});
