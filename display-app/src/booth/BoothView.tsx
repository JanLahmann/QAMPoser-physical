/**
 * BoothView — the big-screen kiosk view, v2 exhibit design (variant A).
 *
 * Spec: docs/booth-ux.md. Layered surfaces; topbar with status pills and the
 * event-branding slot; the circuit full-bleed as the stage with celebrations,
 * message strip and attract mode as overlays; a sidebar of stacked panels
 * (RESULTS bit-stack histogram / STATE / OPENQASM) driven by the layout
 * message when present; a footer hint ticker that warnings replace.
 *
 * The physical table is the source of truth: the editor is CONTROLLED (no
 * `onCircuitChange`), so on-screen drags cannot persist. The moment engine
 * fires on LIVE circuit changes only (deduped snapshot + message identity
 * guard, so StrictMode can never double-fire a celebration).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ThemeProvider,
  QamposerProvider,
  CircuitEditor,
  createDefaultCircuit,
  type Circuit,
} from '@qamposer/react';
import { useEntangibleState } from '../ws/useEntangibleState';
import { friendlyWarning } from './warnings';
import type { ConnectionState } from '../ws/stateSocket';
import type { CircuitMessage } from '../ws/messages';
import { activeQubits } from '../quantum/statevector';
import {
  evaluateMoment,
  initialMomentState,
  type MomentState,
} from '../quantum/moments';
import { shouldAttract } from './attract';
import { Histogram } from './Histogram';
import { MessageStrip, type StripMessage } from './MessageStrip';
import { Celebrations, type CelebrationRequest } from './Celebrations';
import { AttractMode } from './AttractMode';
import { NoisyRun } from './NoisyRun';
import './booth-v2.css';

const BOARD_QUBITS = 5;
const DEFAULT_PANELS = ['results', 'state', 'qasm'];

const HINTS = [
  '● and ⊕ in the same column make a CNOT — entanglement in one move.',
  'An H tile puts a qubit into superposition — 0 and 1 at once.',
  'Place tiles left-to-right; each column is one step in time.',
  'Two entangled qubits always agree — measure one, know the other.',
];
const HINT_ROTATE_MS = 7000;

/** QASM gate-line tint (gate colors at 60 % on the dark inset). */
const QASM_TINTS: ReadonlyArray<[RegExp, string]> = [
  [/^h /, 'rgba(250, 77, 86, 0.75)'],
  [/^(x|cx) /, 'rgba(94, 132, 235, 0.85)'],
  [/^(y|rx|ry)/, 'rgba(214, 82, 150, 0.8)'],
  [/^(z|rz|s |t )/, 'rgba(51, 177, 255, 0.75)'],
];

interface Branding {
  name?: string | null;
  logoUrl?: string | null;
}

function connectionInfo(state: ConnectionState): { label: string; cls: string } {
  switch (state) {
    case 'open':
      return { label: 'live', cls: '' };
    case 'connecting':
    case 'reconnecting':
      return { label: 'reconnecting', cls: 'is-pending' };
    default:
      return { label: 'offline', cls: 'is-down' };
  }
}

function QasmPanel({ qasm }: { qasm: string | undefined }) {
  const lines = useMemo(() => {
    const all = (qasm ?? '').split('\n').filter((l) => l.trim().length > 0);
    return all.slice(-7);
  }, [qasm]);
  if (lines.length === 0) return null;
  return (
    <div>
      <div className="bo-label">OpenQASM 2.0</div>
      <div className="bo-well bo-qasm">
        {lines.map((line, i) => {
          const tint = QASM_TINTS.find(([re]) => re.test(line))?.[1];
          const isKw = /^(OPENQASM|include|qreg|creg)/.test(line);
          return (
            <div key={i} className={isKw ? 'kw' : undefined} style={tint ? { color: tint } : undefined}>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatePanel({ circuit }: { circuit: Circuit }) {
  const touched = activeQubits(circuit).length;
  const columns = new Set(circuit.gates.map((g) => g.position)).size;
  return (
    <div>
      <div className="bo-label">State</div>
      <div className="bo-stats">
        <div className="bo-stat">qubits touched <b>{touched}</b></div>
        <div className="bo-stat">gates <b>{circuit.gates.length}</b></div>
        <div className="bo-stat">columns <b>{columns}</b></div>
      </div>
    </div>
  );
}

export function BoothView() {
  const snapshot = useEntangibleState();
  const { circuit, detection, status, connectionState } = snapshot;
  // Layout arrives via an additive message; tolerate its absence.
  const layout = (snapshot as { layout?: { panels?: string[]; mode?: string } }).layout;
  const panels = layout?.panels ?? DEFAULT_PANELS;
  const mode = layout?.mode ?? 'composer';

  const liveCircuit: Circuit = circuit?.circuit ?? createDefaultCircuit(BOARD_QUBITS);
  const warnings = detection?.warnings ?? [];
  const markersPresent = (detection?.markers?.length ?? 0) > 0;
  const conn = connectionInfo(connectionState);

  // --- event branding (config-gated; absent endpoint → hidden) -------------
  const [branding, setBranding] = useState<Branding | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/branding')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled && b && (b.name || b.logoUrl)) setBranding(b);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // --- moment engine (live circuit changes only) ---------------------------
  const momentStateRef = useRef<MomentState>(initialMomentState);
  const prevCircuitRef = useRef<Circuit>(createDefaultCircuit(BOARD_QUBITS));
  const processedMsgRef = useRef<CircuitMessage | null>(null);
  const tokenRef = useRef(0);
  const [strip, setStrip] = useState<StripMessage | null>(null);
  const [celebration, setCelebration] = useState<CelebrationRequest | null>(null);

  // --- attract mode bookkeeping --------------------------------------------
  const lastActivityRef = useRef<number>(Date.now());
  const boardEmptyRef = useRef(true);
  const markersRef = useRef(false);
  const [attract, setAttract] = useState(false);

  boardEmptyRef.current = liveCircuit.gates.length === 0;
  markersRef.current = markersPresent;

  function pushStrip(text: string) {
    setStrip({ text, token: ++tokenRef.current });
  }

  useEffect(() => {
    if (!circuit) return;
    if (processedMsgRef.current === circuit) return;
    processedMsgRef.current = circuit;

    const next = circuit.circuit;
    const result = evaluateMoment(
      prevCircuitRef.current,
      next,
      momentStateRef.current,
      Date.now(),
    );
    momentStateRef.current = result.state;
    prevCircuitRef.current = next;

    if (result.stripMessage) pushStrip(result.stripMessage);
    if (result.celebration) {
      setCelebration({ ...result.celebration, token: ++tokenRef.current });
    }

    lastActivityRef.current = Date.now();
    setAttract(false);
  }, [circuit]);

  useEffect(() => {
    if (markersPresent) {
      lastActivityRef.current = Date.now();
      setAttract(false);
    }
  }, [detection, markersPresent]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setAttract(
        shouldAttract({
          boardEmpty: boardEmptyRef.current,
          markersPresent: markersRef.current,
          msSinceActivity: Date.now() - lastActivityRef.current,
        }),
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const [hintIndex, setHintIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setHintIndex((i) => (i + 1) % HINTS.length), HINT_ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  const qamposerConfig = useMemo(() => ({ maxQubits: BOARD_QUBITS }), []);

  const panelFor = (name: string) => {
    switch (name) {
      case 'results':
        return (
          <div key="results">
            <Histogram circuit={liveCircuit} />
            <NoisyRun circuit={liveCircuit} onMessage={pushStrip} />
          </div>
        );
      case 'state':
        return <StatePanel key="state" circuit={liveCircuit} />;
      case 'qasm':
        return <QasmPanel key="qasm" qasm={circuit?.qasm} />;
      default:
        return null; // unknown panels (forward-compatible) and not-yet-built ones
    }
  };

  return (
    <div className="bo">
      <header className="bo-topbar">
        <div className="bo-brand">
          <span className="en">En</span>tangible
        </div>
        <span className="bo-pill">{mode}</span>
        <span className="bo-spacer" />
        {status?.camera && (
          <span className="bo-pill is-camera">
            <span className="bo-dot" aria-hidden="true" />
            {status.camera.kind === 'push' ? 'iPhone camera' : status.camera.kind}
          </span>
        )}
        <span className={`bo-pill ${conn.cls}`}>
          <span className="bo-dot" aria-hidden="true" />
          {conn.label}
        </span>
        {(status?.clients ?? 0) > 1 && (
          <span className="bo-pill">{status?.clients} viewers</span>
        )}
        {branding && (
          <div className="bo-evbrand">
            <span className="bo-ev-eyebrow">presented at</span>
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.name ?? 'event logo'} />
            ) : (
              <span className="bo-ev-name">{branding.name}</span>
            )}
          </div>
        )}
      </header>

      <ThemeProvider defaultTheme="dark">
        <QamposerProvider circuit={liveCircuit} config={qamposerConfig}>
          <main className="bo-main">
            <section className="bo-stage">
              <div className="bo-stage-editor">
                <CircuitEditor />
              </div>
              <MessageStrip message={strip} />
            </section>
            <aside className="bo-side">{panels.map(panelFor)}</aside>
          </main>
        </QamposerProvider>
      </ThemeProvider>

      <footer className={`bo-footer ${warnings.length > 0 ? 'has-warnings' : ''}`}>
        {warnings.length > 0 ? (
          <>
            <span className="bo-warnicon" aria-hidden="true">⚠</span>
            <div role="status">{warnings.map((w) => friendlyWarning(w)).join('  ·  ')}</div>
          </>
        ) : (
          <div key={hintIndex}>{HINTS[hintIndex]}</div>
        )}
      </footer>

      <Celebrations celebration={celebration} />
      {attract && <AttractMode />}
    </div>
  );
}

export default BoothView;
