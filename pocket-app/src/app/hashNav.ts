/**
 * Hash-based routing between the main app (#/empty) and the Guide (#guide).
 *
 * The app is a single-page, serverless deploy (docs/pocket.md), so navigation
 * is just the URL fragment: entering the Guide sets `#guide`, which pushes a
 * history entry so the browser Back button (and the topbar back pill) return to
 * the main app. The camera is never torn down — the Guide renders as an overlay
 * over the still-mounted app (see App.tsx), so an active stream keeps running.
 *
 * The parse/apply/back helpers are pure (a minimal `NavWindow` is injectable for
 * tests); `useRoute` is the tiny hashchange-backed hook.
 */
import { useEffect, useState } from 'react';

export type Route = 'main' | 'guide';

export const GUIDE_HASH = '#guide';

/** Minimal window surface the navigation helpers touch (injectable for tests). */
export interface NavWindow {
  location: { hash: string };
  history: { back(): void; length: number };
}

/** Parse a location hash into a route. Anything but `guide` is the main app. */
export function parseRoute(hash: string | null | undefined): Route {
  const h = (hash ?? '').trim().replace(/^#/, '').trim().toLowerCase();
  return h === 'guide' ? 'guide' : 'main';
}

/** The hash a route should apply. Main clears the fragment; guide sets `#guide`. */
export function routeToHash(route: Route): string {
  return route === 'guide' ? GUIDE_HASH : '';
}

/** Navigate to a route by applying its hash (pushes a history entry for guide). */
export function navigateTo(win: NavWindow, route: Route): void {
  win.location.hash = routeToHash(route);
}

/**
 * Leave the Guide. Prefer real browser-back so we don't pile up history entries
 * (returns to wherever the visitor was); fall back to clearing the hash when the
 * Guide was opened directly (deep link, empty history).
 */
export function goBack(win: NavWindow): void {
  if (win.history.length > 1) win.history.back();
  else win.location.hash = '';
}

/** Current route, kept in sync with the browser via `hashchange`. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(typeof window !== 'undefined' ? window.location.hash : ''),
  );
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
