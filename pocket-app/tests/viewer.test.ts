import { describe, it, expect } from 'vitest';
import { reduceViewer, CLOSED, type ViewerState } from '../src/app/viewer';

const N = 8; // eight test boards

describe('reduceViewer', () => {
  it('starts closed', () => {
    expect(CLOSED).toEqual({ open: false, index: 0 });
  });

  it('opens at the requested index', () => {
    expect(reduceViewer(CLOSED, { type: 'open', index: 3 }, N)).toEqual({
      open: true,
      index: 3,
    });
  });

  it('wraps an out-of-range open index into range', () => {
    expect(reduceViewer(CLOSED, { type: 'open', index: 8 }, N).index).toBe(0);
    expect(reduceViewer(CLOSED, { type: 'open', index: -1 }, N).index).toBe(7);
  });

  it('advances with next and wraps past the last board', () => {
    let s: ViewerState = reduceViewer(CLOSED, { type: 'open', index: 6 }, N);
    s = reduceViewer(s, { type: 'next' }, N);
    expect(s.index).toBe(7);
    s = reduceViewer(s, { type: 'next' }, N);
    expect(s.index).toBe(0);
    expect(s.open).toBe(true);
  });

  it('retreats with prev and wraps before the first board', () => {
    let s: ViewerState = reduceViewer(CLOSED, { type: 'open', index: 1 }, N);
    s = reduceViewer(s, { type: 'prev' }, N);
    expect(s.index).toBe(0);
    s = reduceViewer(s, { type: 'prev' }, N);
    expect(s.index).toBe(7);
  });

  it('ignores next/prev while closed', () => {
    expect(reduceViewer(CLOSED, { type: 'next' }, N)).toBe(CLOSED);
    expect(reduceViewer(CLOSED, { type: 'prev' }, N)).toBe(CLOSED);
  });

  it('closes but preserves the last index', () => {
    const open = reduceViewer(CLOSED, { type: 'open', index: 4 }, N);
    expect(reduceViewer(open, { type: 'close' }, N)).toEqual({ open: false, index: 4 });
  });

  it('is safe when there are zero items', () => {
    expect(reduceViewer(CLOSED, { type: 'open', index: 2 }, 0).index).toBe(0);
  });
});
