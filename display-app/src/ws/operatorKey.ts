/**
 * Operator-key handling (staff credential) for the display app.
 *
 * Staff-only surfaces — the `/debug` preview + `/api/qr`, the `/ws/frames`
 * phone intake, and the `select_*` control messages on `/ws/state` — are gated
 * behind a single shared operator token (see `docs/protocol.md`). The token
 * arrives one of two ways and is persisted in `localStorage` so it survives
 * reloads and route changes:
 *
 *  1. embedded in the URL as `?key=…` (the staff cheat-sheet / host QR), or
 *  2. typed into the `/debug` key prompt.
 *
 * `getOperatorKey()` resolves the effective key (URL wins, and is persisted);
 * `withKey()` appends it to a request URL; the display app calls these when
 * building the MJPEG/QR requests, the `/ws/frames` URL, and the `hello` it
 * sends. Read-only viewer surfaces never touch any of this.
 */

/** localStorage key holding the operator token. */
export const OPERATOR_KEY_STORAGE = 'entangible.operator.key';

function readUrlKey(): string | null {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const k = params.get('key');
    return k && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

function readStored(): string | null {
  try {
    const k = globalThis.localStorage?.getItem(OPERATOR_KEY_STORAGE);
    return k && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

/** Persist an operator key (no-op if storage is unavailable). */
export function storeOperatorKey(key: string): void {
  try {
    globalThis.localStorage?.setItem(OPERATOR_KEY_STORAGE, key.trim());
  } catch {
    /* storage unavailable — the in-URL key still works for this load */
  }
}

/** Forget the stored operator key (used by the "clear key" affordance). */
export function clearOperatorKey(): void {
  try {
    globalThis.localStorage?.removeItem(OPERATOR_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

/**
 * Resolve the effective operator key, or `null` if none is available.
 *
 * A `?key=` in the URL wins and is persisted (the staff QR carries it), so a
 * fresh `/capture?key=…` or `/debug?key=…` visit is authenticated with no
 * prompt; otherwise the previously stored key is used.
 */
export function getOperatorKey(): string | null {
  const fromUrl = readUrlKey();
  if (fromUrl) {
    storeOperatorKey(fromUrl);
    return fromUrl;
  }
  return readStored();
}

/** Append `key=<token>` to `url` when an operator key is available. */
export function withKey(url: string): string {
  const key = getOperatorKey();
  if (!key) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}key=${encodeURIComponent(key)}`;
}
