/**
 * Shared view-rotation interaction for the Q-sphere and Bloch views.
 *
 * VIEW motion only (per the Quantum Golf spec) and drag-only, matching the IBM
 * Quantum Composer Q-sphere ("select, hold, and drag to rotate"): pointer-drag
 * rotates (yaw free, pitch clamped ±80°); there is NO idle auto-spin. Orientation
 * is reset via an explicit control (`reset`, wired to the panel's rewind-arrow
 * button), not a double-tap. The hook owns yaw/pitch and returns pointer handlers
 * to spread onto the SVG.
 */
import { useCallback, useRef, useState } from 'react';
import { clampPitch } from './qsphere';

const DRAG_GAIN = 0.008; // rad per px

export interface SphereRotation {
  readonly yaw: number;
  readonly pitch: number;
  readonly dragging: boolean;
  /** Return the view to its default orientation. */
  readonly reset: () => void;
  readonly handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

export function useSphereRotation(initial: { yaw?: number; pitch?: number } = {}): SphereRotation {
  const initialYaw = initial.yaw ?? 0;
  const initialPitch = clampPitch(initial.pitch ?? 0.35);

  const [yaw, setYaw] = useState(initialYaw);
  const [pitch, setPitch] = useState(initialPitch);
  const [dragging, setDragging] = useState(false);

  const draggingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setYaw(initialYaw);
    setPitch(initialPitch);
  }, [initialYaw, initialPitch]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    lastRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !lastRef.current) return;
    const dx = e.clientX - lastRef.current.x;
    const dy = e.clientY - lastRef.current.y;
    lastRef.current = { x: e.clientX, y: e.clientY };
    setYaw((y) => y + dx * DRAG_GAIN);
    setPitch((p) => clampPitch(p + dy * DRAG_GAIN));
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    setDragging(false);
    lastRef.current = null;
  }, []);

  return {
    yaw,
    pitch,
    dragging,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
