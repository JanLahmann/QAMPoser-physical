import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPOSER_BASE, composerUrl } from './composerTransfer';
import {
  ComposerSync,
  COMPOSER_SYNC_TARGET,
  SYNC_DEBOUNCE_MS,
  SYNC_MIN_INTERVAL_MS,
  type ComposerSyncEnv,
} from './composerSync';

// Two distinct non-empty circuits (as their QASM identity strings).
const QASM_A = 'OPENQASM 2.0;\nqreg q[5];\nh q[0];\n';
const QASM_B = 'OPENQASM 2.0;\nqreg q[5];\nh q[0];\ncx q[0], q[1];\n';
const QASM_C = 'OPENQASM 2.0;\nqreg q[5];\nh q[0];\ncx q[0], q[1];\ncx q[1], q[2];\n';

/** A test env whose clock is driven by vitest fake timers. */
function makeEnv(open = vi.fn()): ComposerSyncEnv {
  return {
    open,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ComposerSync — gesture-first open', () => {
  it('opens the named tab immediately on start, before any change', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start(QASM_A);
    expect(sync.isActive).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(composerUrl(QASM_A), COMPOSER_SYNC_TARGET);
  });

  it('opens the bare Composer when the board is empty at start', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start('');
    expect(open).toHaveBeenCalledWith(COMPOSER_BASE, COMPOSER_SYNC_TARGET);
  });
});

describe('ComposerSync — named-target reuse', () => {
  it('re-navigates the SAME named target on every navigation', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start(QASM_A);
    vi.advanceTimersByTime(SYNC_MIN_INTERVAL_MS);
    sync.update(QASM_B);
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS);
    expect(open).toHaveBeenCalledTimes(2);
    for (const call of open.mock.calls) {
      expect(call[1]).toBe(COMPOSER_SYNC_TARGET);
    }
  });
});

describe('ComposerSync — debounce + min-interval', () => {
  it('waits for ~2s of stability before navigating a change', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start(QASM_A);
    open.mockClear();
    // Clear the min-interval window from the start-open.
    vi.advanceTimersByTime(SYNC_MIN_INTERVAL_MS);

    sync.update(QASM_B);
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS - 1);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(composerUrl(QASM_B), COMPOSER_SYNC_TARGET);
  });

  it('resets the debounce on each fresh change (mid-build burst → one nav)', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start(QASM_A);
    open.mockClear();
    vi.advanceTimersByTime(SYNC_MIN_INTERVAL_MS);

    sync.update(QASM_B);
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS - 500);
    sync.update(QASM_C); // still building — resets the timer
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS - 500);
    expect(open).not.toHaveBeenCalled(); // neither window elapsed fully
    vi.advanceTimersByTime(500);
    expect(open).toHaveBeenCalledTimes(1); // settled on QASM_C
    expect(open).toHaveBeenCalledWith(composerUrl(QASM_C), COMPOSER_SYNC_TARGET);
  });

  it('enforces the min interval between navigations', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start(QASM_A); // nav at t=0
    open.mockClear();

    // Change settles after the debounce but well within the min interval.
    sync.update(QASM_B);
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS);
    // t = 2000 < 3000 → held back, not navigated yet.
    expect(open).not.toHaveBeenCalled();
    // Advance to the min-interval floor.
    vi.advanceTimersByTime(SYNC_MIN_INTERVAL_MS - SYNC_DEBOUNCE_MS);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('ComposerSync — no-navigate guards', () => {
  it('does not navigate on an unchanged circuit', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start(QASM_A);
    open.mockClear();
    vi.advanceTimersByTime(SYNC_MIN_INTERVAL_MS);

    sync.update(QASM_A); // same as synced
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS * 2);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not navigate to an empty circuit', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start(QASM_A);
    open.mockClear();
    vi.advanceTimersByTime(SYNC_MIN_INTERVAL_MS);

    sync.update('');
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS * 2);
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps the last good state for an over-long (fallback) circuit', () => {
    // A genuinely incompressible payload → composerUrl falls back to the bare
    // COMPOSER_BASE; live-sync must NOT clobber the tab with a circuit-less URL.
    let x = 42;
    const overLong = Array.from({ length: 30000 }, () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return String.fromCharCode(33 + (x % 90));
    }).join('');
    expect(composerUrl(overLong)).toBe(COMPOSER_BASE); // precondition

    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start(QASM_A);
    open.mockClear();
    vi.advanceTimersByTime(SYNC_MIN_INTERVAL_MS);

    sync.update(overLong);
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS * 2);
    expect(open).not.toHaveBeenCalled();
  });

  it('stop() halts a pending navigation and leaves the tab alone', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.start(QASM_A);
    open.mockClear();
    vi.advanceTimersByTime(SYNC_MIN_INTERVAL_MS);

    sync.update(QASM_B);
    sync.stop();
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS * 2);
    expect(sync.isActive).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores update() while inactive', () => {
    const open = vi.fn();
    const sync = new ComposerSync(makeEnv(open));
    sync.update(QASM_A);
    vi.advanceTimersByTime(SYNC_DEBOUNCE_MS * 2);
    expect(open).not.toHaveBeenCalled();
  });
});
