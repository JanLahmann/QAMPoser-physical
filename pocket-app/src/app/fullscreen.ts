/**
 * Fullscreen + iPhone install-hint helpers (docs/pocket.md, phone scope).
 *
 * Two capabilities, both feature-detected so nothing shows where it can't work:
 *  - a Fullscreen toggle (element Fullscreen API, with the webkit prefix) — iPad
 *    / desktop / Android have it, iPhone Safari does NOT;
 *  - an "Add to Home Screen" hint shown ONLY on iPhones that lack the API and
 *    are not already running standalone, dismissible + remembered.
 *
 * The decision logic is pure (injected capabilities) so it is unit-testable; the
 * thin DOM wrappers below are the only browser-touching parts.
 */

export const INSTALL_HINT_DISMISS_KEY = 'entangible.pocket.installHintDismissed';

type FsElement = {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => void;
};
type FsDocument = {
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
};

// --- pure capability detection ----------------------------------------------

/** Is the element Fullscreen API available on this element (std or webkit)? */
export function hasElementFullscreen(el: FsElement | null | undefined): boolean {
  return (
    !!el &&
    (typeof el.requestFullscreen === 'function' ||
      typeof el.webkitRequestFullscreen === 'function')
  );
}

/** iPhone / iPod (and legacy iPad) user agent. iPad is excluded downstream by
 *  its having the Fullscreen API, so this staying broad is fine. */
export function isIOS(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number }): boolean {
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ masquerades as macOS; catch touch-capable "Macs".
  return /Mac/.test(nav.platform ?? '') && (nav.maxTouchPoints ?? 0) > 1;
}

/** Already launched from the Home Screen (iOS standalone or display-mode)? */
export function isStandalone(win: {
  navigator?: { standalone?: boolean };
  matchMedia?: (q: string) => { matches: boolean };
}): boolean {
  if (win.navigator?.standalone === true) return true;
  if (typeof win.matchMedia === 'function') {
    return win.matchMedia('(display-mode: standalone)').matches;
  }
  return false;
}

/** Capabilities snapshot the pure decisions below consume. */
export interface FullscreenEnv {
  readonly hasElementFullscreen: boolean;
  readonly isIOS: boolean;
  readonly isStandalone: boolean;
}

/** Show the Fullscreen toggle only where the element API actually exists. */
export function shouldShowFullscreenToggle(env: FullscreenEnv): boolean {
  return env.hasElementFullscreen;
}

/**
 * Show the install hint only on an iPhone with no Fullscreen API, not already
 * standalone, once the camera has run at least once, and not previously
 * dismissed.
 */
export function shouldShowInstallHint(
  env: FullscreenEnv,
  opts: { cameraStarted: boolean; dismissed: boolean },
): boolean {
  return (
    !env.hasElementFullscreen &&
    env.isIOS &&
    !env.isStandalone &&
    opts.cameraStarted &&
    !opts.dismissed
  );
}

// --- thin DOM wrappers (not unit-tested) ------------------------------------

export function detectEnv(
  win: Window & typeof globalThis = window,
): FullscreenEnv {
  return {
    hasElementFullscreen: hasElementFullscreen(win.document?.documentElement as FsElement),
    isIOS: isIOS(win.navigator),
    isStandalone: isStandalone(win as never),
  };
}

export function fullscreenElement(doc: FsDocument): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function requestFullscreen(el: FsElement): void {
  if (typeof el.requestFullscreen === 'function') el.requestFullscreen().catch(() => {});
  else if (typeof el.webkitRequestFullscreen === 'function') el.webkitRequestFullscreen();
}

export function exitFullscreen(doc: FsDocument): void {
  if (typeof doc.exitFullscreen === 'function') doc.exitFullscreen().catch(() => {});
  else if (typeof doc.webkitExitFullscreen === 'function') doc.webkitExitFullscreen();
}

// --- install-hint dismissal persistence -------------------------------------

export function loadHintDismissed(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(INSTALL_HINT_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveHintDismissed(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(INSTALL_HINT_DISMISS_KEY, '1');
  } catch {
    /* best-effort */
  }
}
