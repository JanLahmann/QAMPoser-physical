// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Circuit } from '@qamposer/react';
import { TransferButton } from './TransferButton';
import { COPIED_MESSAGE, NO_COPY_MESSAGE } from './composerTransfer';

// React 18 needs this flag for act() outside a test renderer.
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

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function button(): HTMLButtonElement | null {
  return container.querySelector('.pk-transfer-btn');
}

describe('TransferButton', () => {
  it('renders nothing for an empty circuit', () => {
    act(() => root.render(<TransferButton circuit={empty} onToast={() => {}} />));
    expect(button()).toBeNull();
  });

  it('copies the QASM, opens the Composer tab and toasts on click (happy path)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onToast = vi.fn();

    act(() => root.render(<TransferButton circuit={bell} onToast={onToast} />));
    const btn = button();
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain('Transfer to IBM Composer');

    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedQasm = writeText.mock.calls[0][0] as string;
    expect(copiedQasm).toContain('h q[0];');
    expect(copiedQasm).toContain('cx q[0], q[1];');
    expect(open).toHaveBeenCalledWith(
      'https://quantum.cloud.ibm.com/composer',
      '_blank',
      'noopener',
    );
    expect(onToast).toHaveBeenCalledWith(COPIED_MESSAGE);
  });

  it('still opens the tab and toasts the fallback when copying fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    // jsdom has no execCommand; force the fallback to report failure explicitly.
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onToast = vi.fn();

    act(() => root.render(<TransferButton circuit={bell} onToast={onToast} />));

    await act(async () => {
      button()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(open).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith(NO_COPY_MESSAGE);
  });
});
