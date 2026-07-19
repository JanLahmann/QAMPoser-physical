/**
 * TouchInspector — the optional tap-to-inspect layer for the booth
 * (docs/booth-ux.md, "Variant-A refinements → Touch").
 *
 * Enabled only when {@link isTouchEnabled} says so (`?touch=1` or a coarse
 * pointer). It attaches ONE delegated `click` listener (click fires on tap but
 * not while scrolling, so it never fights the editor's own scroll/drag) and
 * resolves the tapped element to either a gate or an outcome column:
 *
 *   - Gate: the `@qamposer/react` editor renders each gate as a
 *     `.circuit-editor__gate` / `.circuit-editor__cnot` child of
 *     `.circuit-editor__gates`, in `circuit.gates` order and carrying no id in
 *     the DOM. We map the tapped element to its Gate by its index among those
 *     siblings — the booth circuit is controlled (never reordered), so index i
 *     is `circuit.gates[i]`.
 *   - Outcome: the histogram columns carry `data-bits` / `data-prob`.
 *
 * It shows a single `bo-`styled popover near the target that auto-dismisses
 * after {@link POPOVER_MS}. It never mutates the circuit.
 */
import { useEffect, useRef, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import {
  POPOVER_MS,
  gateInspectCopy,
  outcomeInspectCopy,
} from './touch';

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

/** Resolve a tapped gate/cnot element to its Gate via sibling index order. */
function gateFromElement(el: Element, circuit: Circuit): { text: string } | null {
  const container = el.closest('.circuit-editor__gates');
  if (!container) return null; // preview / toolbar gate — not a real gate
  const siblings = Array.from(
    container.querySelectorAll(
      ':scope > .circuit-editor__gate, :scope > .circuit-editor__cnot',
    ),
  );
  const index = siblings.indexOf(el);
  const gate = index >= 0 ? circuit.gates[index] : undefined;
  if (!gate) return null;
  return { text: gateInspectCopy(gate) };
}

/** Resolve a tapped histogram column to its outcome copy. */
function outcomeFromElement(el: Element): { text: string } | null {
  const bits = el.getAttribute('data-bits');
  const probAttr = el.getAttribute('data-prob');
  if (bits === null || probAttr === null) return null;
  const prob = Number(probAttr);
  if (!Number.isFinite(prob)) return null;
  return { text: outcomeInspectCopy(bits, prob) };
}

export function TouchInspector({
  circuit,
  enabled,
}: {
  circuit: Circuit;
  enabled: boolean;
}) {
  const circuitRef = useRef(circuit);
  circuitRef.current = circuit;

  const [popover, setPopover] = useState<Popover | null>(null);
  const timerRef = useRef<number | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const show = (text: string, rect: DOMRect) => {
      const below = rect.top < 140; // not enough room above → drop below
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
        const hit = gateFromElement(gateEl, circuitRef.current);
        if (hit) {
          show(hit.text, gateEl.getBoundingClientRect());
          return;
        }
      }

      const colEl = target.closest('.bo-h-col');
      if (colEl) {
        const hit = outcomeFromElement(colEl);
        if (hit) {
          show(hit.text, colEl.getBoundingClientRect());
          return;
        }
      }

      // Tap on empty space dismisses any open popover.
      clearTimer();
      setPopover(null);
    };

    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      clearTimer();
    };
  }, [enabled]);

  if (!popover) return null;

  // Clamp the centre so the (max-width 44vh) popover stays on-screen.
  const halfMax = Math.min(220, window.innerWidth / 2 - 12);
  const x = Math.max(halfMax + 12, Math.min(window.innerWidth - halfMax - 12, popover.x));

  return (
    <div
      className={`bo-inspect ${popover.below ? 'is-below' : 'is-above'}`}
      role="status"
      style={{ left: `${x}px`, top: `${popover.y}px` }}
    >
      {popover.text}
    </div>
  );
}

export default TouchInspector;
