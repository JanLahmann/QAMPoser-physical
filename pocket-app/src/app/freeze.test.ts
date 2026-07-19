import { describe, it, expect, vi } from 'vitest';
import {
  toggleFrozen,
  shouldProcess,
  videoFreezeAction,
  applyVideoFreeze,
} from './freeze';

describe('toggleFrozen', () => {
  it('flips the flag and round-trips', () => {
    expect(toggleFrozen(false)).toBe(true);
    expect(toggleFrozen(true)).toBe(false);
    expect(toggleFrozen(toggleFrozen(false))).toBe(false);
  });
});

describe('shouldProcess', () => {
  it('gates the pipeline on the freeze flag', () => {
    expect(shouldProcess(false)).toBe(true);
    expect(shouldProcess(true)).toBe(false);
  });
});

describe('videoFreezeAction', () => {
  it('pauses when frozen and running, resumes when unfrozen and running', () => {
    expect(videoFreezeAction(true, true)).toBe('pause');
    expect(videoFreezeAction(false, true)).toBe('play');
  });

  it('does nothing when the camera is not running', () => {
    expect(videoFreezeAction(true, false)).toBe('none');
    expect(videoFreezeAction(false, false)).toBe('none');
  });
});

describe('applyVideoFreeze', () => {
  it('calls pause() on a pause action', () => {
    const video = { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) };
    applyVideoFreeze(video as unknown as HTMLVideoElement, 'pause');
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
  });

  it('calls play() on a play action and swallows a rejected promise', async () => {
    const video = { pause: vi.fn(), play: vi.fn(() => Promise.reject(new Error('nope'))) };
    expect(() =>
      applyVideoFreeze(video as unknown as HTMLVideoElement, 'play'),
    ).not.toThrow();
    expect(video.play).toHaveBeenCalledOnce();
  });

  it('is a no-op on none / null', () => {
    const video = { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) };
    applyVideoFreeze(video as unknown as HTMLVideoElement, 'none');
    applyVideoFreeze(null, 'pause');
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });
});
