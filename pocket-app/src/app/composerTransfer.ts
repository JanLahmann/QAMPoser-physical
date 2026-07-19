/**
 * "Transfer to IBM Composer" — take-it-home handoff (docs/design.md,
 * "Take it home — run on real hardware", simplified 2026-07-19 to ONE button).
 *
 * ONE TAP: opens IBM Quantum Composer with the circuit PRE-LOADED via the
 * `?initial=` URL parameter, AND copies the QASM to the clipboard as a
 * belt-and-braces fallback.
 *
 * URL format (VERIFIED WORKING 2026-07-19, visually confirmed by Jan on the
 * live cloud Composer; rediscovered from the Qoffee-Maker family project,
 * qoffeefrontend/app.js): `?initial=` carries
 * encodeURIComponent(LZString.compressToEncodedURIComponent(JSON.stringify(
 * {title, description, qasm}))). Earlier bundle forensics wrongly concluded
 * the param was dead — a reminder that a negative grep proves nothing.
 * No credentials, no server round-trip — everything the visitor needs leaves
 * on their own device (design decision: NO in-app API-key entry).
 */
import LZString from 'lz-string';
import type { Circuit } from '@qamposer/react';

/** IBM Quantum Composer (cloud). */
export const COMPOSER_BASE = 'https://quantum.cloud.ibm.com/composer';

/** Toast shown when the Composer opened with the circuit + clipboard copy. */
export const COPIED_MESSAGE =
  'Composer opened with your circuit — sign in (free) to run it on a real quantum computer.';

/** Toast shown when copying failed: the pre-loaded tab still opened. */
export const NO_COPY_MESSAGE =
  'Composer opened with your circuit — sign in (free) to run it on real hardware.';

/**
 * The Composer URL with the circuit pre-loaded via `?initial=` (see the file
 * header for the verified format). Falls back to the plain editor URL if the
 * encoded payload would exceed a conservative URL-length budget.
 */
export function composerUrl(qasm?: string, title = 'Built with Entangible'): string {
  if (!qasm) return COMPOSER_BASE;
  const payload = JSON.stringify({ title, description: '', qasm });
  const component = encodeURIComponent(LZString.compressToEncodedURIComponent(payload));
  const url = `${COMPOSER_BASE}?initial=${component}`;
  return url.length > 7500 ? COMPOSER_BASE : url;
}

/** A circuit is transferable once it has at least one gate. */
export function canTransfer(circuit: Circuit): boolean {
  return circuit.gates.length > 0;
}

/** Injectable environment so the orchestration is testable without a real DOM. */
export interface TransferEnv {
  clipboard?: { writeText(text: string): Promise<void> } | undefined;
  /** Synchronous fallback copy (hidden textarea + execCommand). */
  execCopy?: ((text: string) => boolean) | undefined;
  open(url: string, target: string, features: string): unknown;
}

export interface TransferResult {
  readonly copied: boolean;
  readonly opened: boolean;
  readonly url: string;
  readonly message: string;
}

/** Default hidden-textarea + `execCommand('copy')` fallback (browser only). */
export function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  // Keep it out of view and out of the layout / scroll.
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

function defaultEnv(): TransferEnv {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    clipboard: nav?.clipboard as TransferEnv['clipboard'],
    execCopy: execCommandCopy,
    open: (url, target, features) => window.open(url, target, features),
  };
}

async function tryCopy(text: string, env: TransferEnv): Promise<boolean> {
  if (env.clipboard?.writeText) {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback
    }
  }
  if (env.execCopy) {
    try {
      return env.execCopy(text);
    } catch {
      // ignore — reported as not-copied below
    }
  }
  return false;
}

/**
 * Copy the QASM (clipboard → hidden-textarea fallback) and open the Composer
 * in a new tab. Always opens the tab, even when both copy paths fail, and
 * adapts the returned toast message accordingly.
 */
export async function transferToComposer(
  qasm: string,
  env: TransferEnv = defaultEnv(),
): Promise<TransferResult> {
  const copied = await tryCopy(qasm, env);
  const url = composerUrl(qasm);
  let opened = false;
  try {
    env.open(url, '_blank', 'noopener');
    opened = true;
  } catch {
    opened = false;
  }
  return {
    copied,
    opened,
    url,
    message: copied ? COPIED_MESSAGE : NO_COPY_MESSAGE,
  };
}
