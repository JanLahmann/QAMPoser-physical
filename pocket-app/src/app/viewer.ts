/**
 * Fullscreen test-board viewer — a pure state machine.
 *
 * The Guide shows the eight on-screen test boards as a thumbnail grid; tapping
 * one opens a fullscreen viewer (true `requestFullscreen` where available, else
 * a fixed overlay — that side effect lives in GuidePage). This module is only
 * the state: which board is shown and whether the viewer is open. Navigation
 * wraps around (prev from the first → last, next from the last → first).
 */

export interface ViewerState {
  readonly open: boolean;
  readonly index: number;
}

export type ViewerAction =
  | { type: 'open'; index: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'close' };

export const CLOSED: ViewerState = { open: false, index: 0 };

function wrap(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/**
 * Apply an action against `count` items. `next`/`prev` are no-ops while closed;
 * `open` clamps (wraps) the requested index into range; `close` keeps the index
 * so a reopen could resume, but callers typically reset via a fresh `open`.
 */
export function reduceViewer(
  state: ViewerState,
  action: ViewerAction,
  count: number,
): ViewerState {
  switch (action.type) {
    case 'open':
      return { open: true, index: wrap(action.index, count) };
    case 'close':
      return { open: false, index: state.index };
    case 'next':
      return state.open ? { open: true, index: wrap(state.index + 1, count) } : state;
    case 'prev':
      return state.open ? { open: true, index: wrap(state.index - 1, count) } : state;
    default:
      return state;
  }
}
