import { describe, it, expect } from 'vitest';
import {
  parseRoute,
  routeToHash,
  navigateTo,
  goBack,
  GUIDE_HASH,
  type NavWindow,
} from '../src/app/hashNav';

function fakeWindow(hash = '', historyLength = 1): NavWindow & { backCalls: number } {
  const win = {
    location: { hash },
    history: {
      length: historyLength,
      back() {
        win.backCalls += 1;
      },
    },
    backCalls: 0,
  };
  return win;
}

describe('parseRoute', () => {
  it('recognizes the guide fragment (with or without #, any case)', () => {
    expect(parseRoute('#guide')).toBe('guide');
    expect(parseRoute('guide')).toBe('guide');
    expect(parseRoute('#GUIDE')).toBe('guide');
    expect(parseRoute('  #guide  ')).toBe('guide');
  });

  it('treats everything else as the main app', () => {
    expect(parseRoute('')).toBe('main');
    expect(parseRoute('#')).toBe('main');
    expect(parseRoute('#settings')).toBe('main');
    expect(parseRoute(null)).toBe('main');
    expect(parseRoute(undefined)).toBe('main');
  });
});

describe('routeToHash', () => {
  it('maps guide to #guide and main to an empty fragment', () => {
    expect(routeToHash('guide')).toBe(GUIDE_HASH);
    expect(routeToHash('main')).toBe('');
  });

  it('round-trips through parseRoute', () => {
    expect(parseRoute(routeToHash('guide'))).toBe('guide');
    expect(parseRoute(routeToHash('main'))).toBe('main');
  });
});

describe('navigateTo', () => {
  it('applies the target route to the location hash', () => {
    const win = fakeWindow('');
    navigateTo(win, 'guide');
    expect(win.location.hash).toBe('#guide');
    navigateTo(win, 'main');
    expect(win.location.hash).toBe('');
  });
});

describe('goBack', () => {
  it('uses browser-back when there is history to pop', () => {
    const win = fakeWindow('#guide', 3);
    goBack(win);
    expect(win.backCalls).toBe(1);
    expect(win.location.hash).toBe('#guide'); // unchanged; the pop drives the hash
  });

  it('clears the hash when opened directly (no history)', () => {
    const win = fakeWindow('#guide', 1);
    goBack(win);
    expect(win.backCalls).toBe(0);
    expect(win.location.hash).toBe('');
  });
});
