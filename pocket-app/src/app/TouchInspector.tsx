/**
 * TouchInspector — tap-to-inspect for Pocket (ported from the booth, docs/
 * booth-ux.md "Touch"; shares the copy helpers in `@quantum/inspectCopy`).
 *
 * A tap on a gate or an outcome column pops one plain-English sentence about it;
 * one popover at a time, auto-dismissing after {@link POPOVER_MS}. It never
 * mutates the circuit — the physical table is the editor, and the pocket
 * `CircuitEditor` is controlled (no `onCircuitChange`), so even a stray drag on a
 * gate no-ops and the next recognised frame re-asserts the circuit anyway.
 *
 * Touch is ALWAYS on here (a hand-held phone is a touch device by definition —
 * no `?touch` gate). The single delegated `click` listener is passive (never
 * preventDefault/stopPropagation) so it can't fight pinch-zoom on the camera or
 * the drag-to-rotate on the Q-sphere; on top of that it only ACTS on taps that
 * resolve to a gate (inside the stage editor) or a `.pk-h-col` outcome column,
 * and it leaves any open popover untouched when the tap lands on the camera or a
 * sphere view. `click` (not pointerdown) also means a scroll/drag never fires it.
 *
 *   - Gate: the `@qamposer/react` editor renders each gate as a
 *     `.circuit-editor__gate` / `.circuit-editor__cnot` child of
 *     `.circuit-editor__gates`, in `circuit.gates` order. The display wire-count
 *     transform keeps the SAME `gates` array, so DOM sibling index i maps to
 *     `circuit.gates[i]`.
 *   - Outcome: `ResultsHistogram` columns carry `data-bits` / `data-prob`.
 */
import { useEffect, useRef, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { POPOVER_MS, gateInspectCopy, outcomeInspectCopy } from '@quantum/inspectCopy';

interface Popover {
  text: string;
  /** Anchor centre X (viewport px). */
  x: number;
  /** Anchor top / bottom edge the popover attaches to (viewport px). */
  y: number;
  /** Render below the anchor (true) or above it (false). */
  below: boolean;
  token: number;
}

/**
 * Gate copy for the gate at DOM sibling `index` (which equals its index in
 * `circuit.gates`), or null when the index is out of range. Pure — testable
 * without a DOM.
 */
export function gateInspectAt(circuit: Circuit, index: number): string | null {
  const gate = index >= 0 ? circuit.gates[index] : undefined;
  return gate ? gateInspectCopy(gate) : null;
}

/**
 * Outcome copy from a column's `data-bits` / `data-prob` attribute values, or
 * null when either is missing or `data-prob` is not a finite number. Pure.
 */
export function outcomeInspectFromAttrs(
  bits: string | null,
  probAttr: string | null,
): string | null {
  if (bits === null || probAttr === null) return null;
  const prob = Number(probAttr);
  if (!Number.isFinite(prob)) return null;
  return outcomeInspectCopy(bits, prob);
}

/** Resolve a tapped gate/cnot element to its Gate copy via sibling index order. */
function gateFromElement(el: Element, circuit: Circuit): string | null {
  const container = el.closest('.circuit-editor__gates');
  if (!container) return null; // preview / toolbar gate — not a real gate
  const siblings = Array.from(
    container.querySelectorAll(':scope > .circuit-editor__gate, :scope > .circuit-editor__cnot'),
  );
  return gateInspectAt(circuit, siblings.indexOf(el));
}

export function TouchInspector({ circuit }: { circuit: Circuit }) {
  const circuitRef = useRef(circuit);
  circuitRef.current = circuit;

  const [popover, setPopover] = useState<Popover | null>(null);
  const timerRef = useRef<number | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const show = (text: string, rect: DOMRect) => {
      const below = rect.top < 120; // not enough room above → drop below
      const token = ++tokenRef.current;
      setPopover({
        text,
        x: rect.left + rect.width / 2,
        y: below ? rect.bottom : rect.top,
        below,
        token,
      });
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        setPopover((cur) => (cur && cur.token === token ? null : cur));
      }, POPOVER_MS);
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;

      const gateEl = target.closest('.circuit-editor__gate, .circuit-editor__cnot');
      if (gateEl) {
        const text = gateFromElement(gateEl, circuitRef.current);
        if (text) {
          show(text, gateEl.getBoundingClientRect());
          return;
        }
      }

      const colEl = target.closest('.pk-h-col');
      if (colEl) {
        const text = outcomeInspectFromAttrs(
          colEl.getAttribute('data-bits'),
          colEl.getAttribute('data-prob'),
        );
        if (text) {
          show(text, colEl.getBoundingClientRect());
          return;
        }
      }

      // A tap on the camera preview (pinch-zoom) or a sphere view (drag-to-
      // rotate) must never dismiss an open popover; anywhere else in the app a
      // tap on empty space closes it.
      if (target.closest('.pk-cam, .pk-qsphere, .pk-bloch')) return;
      clearTimer();
      setPopover(null);
    };

    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      clearTimer();
    };
  }, []);

  if (!popover) return null;

  // Clamp the centre so the popover stays on-screen.
  const halfMax = Math.min(180, window.innerWidth / 2 - 10);
  const x = Math.max(halfMax + 10, Math.min(window.innerWidth - halfMax - 10, popover.x));

  return (
    <div
      className={`pk-inspect ${popover.below ? 'is-below' : 'is-above'}`}
      role="status"
      style={{ left: `${x}px`, top: `${popover.y}px` }}
    >
      {popover.text}
    </div>
  );
}

export default TouchInspector;
