import { describe, it, expect } from 'vitest';
import {
  hasElementFullscreen,
  isIOS,
  isStandalone,
  shouldShowFullscreenToggle,
  shouldShowInstallHint,
  loadHintDismissed,
  saveHintDismissed,
  INSTALL_HINT_DISMISS_KEY,
  type FullscreenEnv,
} from '../src/app/fullscreen';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('capability detection', () => {
  it('hasElementFullscreen accepts standard or webkit, rejects neither/null', () => {
    expect(hasElementFullscreen({ requestFullscreen: () => Promise.resolve() })).toBe(true);
    expect(hasElementFullscreen({ webkitRequestFullscreen: () => {} })).toBe(true);
    expect(hasElementFullscreen({})).toBe(false);
    expect(hasElementFullscreen(null)).toBe(false);
  });

  it('isIOS matches an iPhone UA and a touch iPadOS-as-Mac, not a plain Mac', () => {
    expect(isIOS({ userAgent: IPHONE_UA })).toBe(true);
    expect(isIOS({ userAgent: DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
  });

  it('isStandalone reads navigator.standalone or the display-mode query', () => {
    expect(isStandalone({ navigator: { standalone: true } })).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(isStandalone({})).toBe(false);
  });
});

describe('shouldShowFullscreenToggle', () => {
  it('shows only where the element Fullscreen API exists', () => {
    const yes: FullscreenEnv = { hasElementFullscreen: true, isIOS: false, isStandalone: false };
    const no: FullscreenEnv = { hasElementFullscreen: false, isIOS: true, isStandalone: false };
    expect(shouldShowFullscreenToggle(yes)).toBe(true);
    expect(shouldShowFullscreenToggle(no)).toBe(false);
  });
});

describe('shouldShowInstallHint', () => {
  const iphone: FullscreenEnv = {
    hasElementFullscreen: false,
    isIOS: true,
    isStandalone: false,
  };

  it('shows on a fresh in-browser iPhone once the camera has run', () => {
    expect(shouldShowInstallHint(iphone, { cameraStarted: true, dismissed: false })).toBe(true);
  });

  it('stays hidden until the camera has started', () => {
    expect(shouldShowInstallHint(iphone, { cameraStarted: false, dismissed: false })).toBe(false);
  });

  it('stays hidden once dismissed', () => {
    expect(shouldShowInstallHint(iphone, { cameraStarted: true, dismissed: true })).toBe(false);
  });

  it('hidden when already standalone (installed to Home Screen)', () => {
    const installed = { ...iphone, isStandalone: true };
    expect(shouldShowInstallHint(installed, { cameraStarted: true, dismissed: false })).toBe(false);
  });

  it('hidden on a device that has the Fullscreen API (iPad / desktop / Android)', () => {
    const ipad = { hasElementFullscreen: true, isIOS: true, isStandalone: false };
    expect(shouldShowInstallHint(ipad, { cameraStarted: true, dismissed: false })).toBe(false);
  });

  it('hidden on non-iOS', () => {
    const android = { hasElementFullscreen: false, isIOS: false, isStandalone: false };
    expect(shouldShowInstallHint(android, { cameraStarted: true, dismissed: false })).toBe(false);
  });
});

describe('install-hint dismissal persistence', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage();
    expect(loadHintDismissed(storage)).toBe(false);
    saveHintDismissed(storage);
    expect(storage._map.get(INSTALL_HINT_DISMISS_KEY)).toBe('1');
    expect(loadHintDismissed(storage)).toBe(true);
  });

  it('is safe with null storage', () => {
    expect(loadHintDismissed(null)).toBe(false);
    expect(() => saveHintDismissed(null)).not.toThrow();
  });
});
