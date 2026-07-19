// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Circuit } from '@qamposer/react';
import { LiveComposerButton } from './LiveComposerButton';
import { COMPOSER_SYNC_TARGET, SYNC_ENABLED_MESSAGE } from './composerSync';
import { qasmForCircuit } from './qasm';
import { composerUrl } from './composerTransfer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bell: Circuit = {
  qubits: 5,
  gates: [
    { id: 'h-0-0', type: 'H', qubit: 0, position: 0 },
    { id: 'cnot-0-1', type: 'CNOT', control: 0, target: 1, position: 1 },
  ],
};
const empty: Circuit = { qubits: 5, gates: [] };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const button = () => container.querySelector('.pk-livesync') as HTMLButtonElement | null;

describe('LiveComposerButton', () => {
  it('renders nothing for an empty circuit', () => {
    act(() => root.render(<LiveComposerButton circuit={empty} onToast={() => {}} />));
    expect(button()).toBeNull();
  });

  it('opens the named Composer tab in the click gesture and toasts on enable', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onToast = vi.fn();
    act(() => root.render(<LiveComposerButton circuit={bell} onToast={onToast} />));

    // The FIRST open must happen synchronously inside the click handler.
    act(() => {
      button()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(composerUrl(qasmForCircuit(bell)), COMPOSER_SYNC_TARGET);
    expect(onToast).toHaveBeenCalledWith(SYNC_ENABLED_MESSAGE);
    expect(button()!.getAttribute('aria-pressed')).toBe('true');
    expect(button()!.className).toContain('is-on');
  });

  it('stops syncing (no toast, no open) when toggled off', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onToast = vi.fn();
    act(() => root.render(<LiveComposerButton circuit={bell} onToast={onToast} />));

    act(() => button()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))); // on
    open.mockClear();
    onToast.mockClear();
    act(() => button()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))); // off

    expect(button()!.getAttribute('aria-pressed')).toBe('false');
    expect(open).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();
  });
});
