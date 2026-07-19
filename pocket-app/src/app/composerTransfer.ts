/**
 * "Transfer to IBM Composer" — take-it-home handoff (docs/design.md,
 * "Take it home — run on real hardware", simplified 2026-07-19 to ONE button).
 *
 * The button copies the circuit's OpenQASM to the clipboard AND opens IBM
 * Quantum Composer in a new tab; the visitor pastes the QASM into the
 * Composer's code editor (View → Code Editor).
 *
 * NOTE (verified 2026-07-19 by the design lead against the Composer's full
 * 8.5 MB client bundle incl. lazy chunks): the current cloud Composer has NO
 * URL circuit initialization — no `?initial=`, no hash variant. The old IQX
 * `?initial=<qasm>` convention is dead, so we open the plain Composer and rely
 * on the clipboard copy. `composerUrl()` stays the single source of the URL.
 * No credentials, no server round-trip — everything the visitor needs leaves
 * on their own device (design decision: NO in-app API-key entry).
 */
import type { Circuit } from '@qamposer/react';

/** IBM Quantum Composer (cloud). */
export const COMPOSER_BASE = 'https://quantum.cloud.ibm.com/composer';

/** Toast shown when the QASM made it onto the clipboard (the primary path). */
export const COPIED_MESSAGE =
  'QASM copied — in the Composer choose View → Code Editor and paste.';

/** Toast shown when copying failed: the tab still opened. */
export const NO_COPY_MESSAGE =
  "Couldn't copy — use the QASM panel to copy manually, then paste in the Composer's code editor.";

/**
 * The Composer URL. The current cloud Composer takes no circuit URL param (see
 * the file header), so this is simply the plain editor URL — kept as a function
 * so there is a single source of the destination.
 */
export function composerUrl(): string {
  return COMPOSER_BASE;
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
  const url = composerUrl();
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
