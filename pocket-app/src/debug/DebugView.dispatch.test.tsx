// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';

// Mock the operator socket + the key gate so the full DebugView renders. `withKey`
// appends the key so the test can assert requests carry it.
let dbgSnap: unknown;
const sendMessage = vi.fn((_msg?: unknown) => true);
vi.mock('./debugSocket', () => ({
  useDebugState: () => dbgSnap,
  getDebugSocket: () => ({ sendMessage }),
}));
vi.mock('@shared/ws/operatorKey', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getOperatorKey: () => 'test-key',
    withKey: (u: string) => `${u}${u.includes('?') ? '&' : '?'}key=test-key`,
  };
});

import { DebugView } from './DebugView';

const bell: Circuit = {
  qubits: 5,
  gates: [{ id: 'H-0', type: 'H', position: 0, qubit: 0 }],
} as Circuit;

function debugSnapshot() {
  return {
    connectionState: 'open',
    operator: true,
    detection: { type: 'detection', fps: 30, board: { found: true, corners: 4, reprojectionErrorMm: 1 }, markers: [], warnings: [] },
    status: { type: 'status', camera: { kind: 'replay', connected: true }, backend: { enabled: false, healthy: false }, clients: 1 },
    layout: { type: 'layout', mode: 'quantina', sidebar: 'right', panels: ['menu'], wires: 'compact', noise: 'off', menu: 'coffee' },
    circuit: { type: 'circuit', seq: 1, circuit: bell, qasm: '', source: 'replay' },
  };
}

/** A fetch stub that answers /api/dispatch with `dispatch`, everything else empty. */
function stubFetch(dispatch: Record<string, unknown>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/api/dispatch/arm') || url.includes('/api/dispatch/disarm')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...dispatch, armed: method === 'GET' ? dispatch.armed : url.includes('arm') }) });
    }
    if (url.startsWith('/api/dispatch') && !url.includes('/homeconnect')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(dispatch) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const baseDispatch = {
  adapter: 'log',
  armed: false,
  armedUntil: null,
  cooldownUntil: null,
  appliance: null,
  hasToken: false,
  log: [{ ts: 1, packId: 'coffee', outcome: '010', adapter: 'log', ok: true, reason: null }],
};

beforeEach(() => {
  sendMessage.mockClear();
  dbgSnap = debugSnapshot();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/debug Dispatch card', () => {
  it('renders the dispatch status and recent log', async () => {
    stubFetch(baseDispatch);
    render(<DebugView />);
    // adapter row + a log line appear once the GET resolves.
    expect(await screen.findByText('log')).toBeTruthy();
    expect(await screen.findByText(/coffee\/010 → log/)).toBeTruthy();
  });

  it('Arm button POSTs to /api/dispatch/arm carrying the operator key', async () => {
    const fetchMock = stubFetch(baseDispatch);
    render(<DebugView />);
    await screen.findByText('log');
    fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
    await waitFor(() => {
      const armCall = fetchMock.mock.calls.find(([u]) => (u as string).includes('/api/dispatch/arm'));
      expect(armCall).toBeTruthy();
      expect(armCall![0] as string).toContain('key=test-key');
      expect((armCall![1] as RequestInit).method).toBe('POST');
    });
  });

  it('shows Home Connect controls only when the adapter is homeconnect', async () => {
    // log adapter → no Connect link.
    stubFetch(baseDispatch);
    const { unmount } = render(<DebugView />);
    await screen.findByText('log');
    expect(screen.queryByText(/Connect Home Connect/)).toBeNull();
    unmount();
    cleanup();

    // homeconnect adapter → the Connect link appears.
    stubFetch({ ...baseDispatch, adapter: 'homeconnect', hasToken: false });
    render(<DebugView />);
    expect(await screen.findByText(/Connect Home Connect/)).toBeTruthy();
  });
});
