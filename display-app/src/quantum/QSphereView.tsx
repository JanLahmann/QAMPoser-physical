/**
 * QSphereView — ONE structural SVG Q-sphere shared by both apps.
 *
 * Pure geometry comes from `qsphere.ts`; probability/phase visuals from
 * `basisVisuals` (IBM Composer convention — see qsphere.ts header). Unstyled by
 * design: every element carries a `${classPrefix}-qs-*` class so the booth
 * (`bo-`) and pocket (`pk-`) supply their own CSS. Nodes are depth-sorted
 * (painter's algorithm): the far hemisphere is drawn first and dimmed, then a
 * translucent sphere disc, then the near hemisphere on top. Node radius ∝
 * PROBABILITY p_k, fill = phase hue `hsl(φ_k, 70%, 60%)` where φ_k is relative to
 * the reference amplitude, stem opacity ∝ p_k. Zero-probability lattice points
 * render as tiny faint dots. Target basis states are outlined in `--entangle`.
 * Motion is view-only + drag-only (no auto-spin); a rewind-arrow button resets
 * orientation and a phase color-wheel legend sits in the corner.
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import {
  DEFAULT_QUBITS,
  basisVisuals,
  layout,
  project,
  projectPoint,
  ringLatitudes,
  type QNode,
} from './qsphere';
import { statevector, type StateVector } from './statevector';
import { useSphereRotation } from './useSphereRotation';
import { PhaseLegend } from './PhaseLegend';
import { ResetOrientationButton } from './ResetOrientationButton';

const MARGIN = 24;
const FAINT_NODE = 1; // tiny dot for p ≈ 0 lattice points
const MIN_NODE = 2.5; // smallest populated-node radius
const MAX_NODE = 13; // radius at p = 1
const FAR_OPACITY = 0.32;
const GUIDE_SAMPLES = 48;

export interface QSphereViewProps {
  /** Provide a circuit (simulated) or a precomputed statevector. */
  circuit?: Circuit;
  statevector?: StateVector;
  /** Qubit count of the displayed space (2^n nodes). Defaults to 5. */
  n?: number;
  /** Basis indices to outline as targets (golf). */
  targets?: ReadonlySet<number>;
  /** SVG viewBox size (square). */
  size?: number;
  /** Class prefix for CSS hooks, e.g. 'bo' or 'pk'. */
  classPrefix: string;
  /** Accessible label. */
  title?: string;
}

interface NodeDraw {
  index: number;
  sx: number;
  sy: number;
  depth: number;
  prob: number;
  phaseDeg: number;
  radius: number;
  faint: boolean;
  isTarget: boolean;
}

export function QSphereView({
  circuit,
  statevector: svProp,
  n = DEFAULT_QUBITS,
  targets,
  size = 220,
  classPrefix,
  title = 'Q-sphere state projection',
}: QSphereViewProps) {
  const p = classPrefix;
  const sv = useMemo<StateVector>(
    () => svProp ?? (circuit ? statevector(circuit) : statevector({ qubits: n, gates: [] } as Circuit)),
    [svProp, circuit, n],
  );
  const nodes = useMemo<QNode[]>(() => layout(n), [n]);
  const lats = useMemo(() => ringLatitudes(n), [n]);

  const { yaw, pitch, dragging, reset, handlers } = useSphereRotation();

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - MARGIN;
  const toScreenX = (x: number) => cx + x * R;
  const toScreenY = (y: number) => cy + y * R;

  const projected = useMemo(() => project(nodes, yaw, pitch), [nodes, yaw, pitch]);

  const draws = useMemo<NodeDraw[]>(() => {
    const visuals = basisVisuals(sv, 1 << n);
    const out: NodeDraw[] = projected.map((pr) => {
      const v = visuals[pr.index];
      const radius = v.faint ? FAINT_NODE : MIN_NODE + (MAX_NODE - MIN_NODE) * v.prob;
      return {
        index: pr.index,
        sx: toScreenX(pr.x),
        sy: toScreenY(pr.y),
        depth: pr.depth,
        prob: v.prob,
        phaseDeg: v.phaseDeg,
        radius,
        faint: v.faint,
        isTarget: targets?.has(pr.index) ?? false,
      };
    });
    // Painter's algorithm: far (small depth) first, near last.
    out.sort((a, b) => a.depth - b.depth);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projected, sv, targets, size, n]);

  // Guide latitude rings, sampled + projected into screen polylines.
  const guides = useMemo(() => {
    return lats.map(({ z, r }) => {
      const pts: string[] = [];
      for (let k = 0; k <= GUIDE_SAMPLES; k++) {
        const t = (2 * Math.PI * k) / GUIDE_SAMPLES;
        const pr = projectPoint({ x: r * Math.cos(t), y: r * Math.sin(t), z }, yaw, pitch);
        pts.push(`${toScreenX(pr.x).toFixed(2)},${toScreenY(pr.y).toFixed(2)}`);
      }
      return pts.join(' ');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lats, yaw, pitch, size]);

  const near = draws.filter((d) => d.depth >= 0);
  const far = draws.filter((d) => d.depth < 0);

  const renderNode = (d: NodeDraw) => {
    const dim = d.depth < 0;
    const groupOpacity = dim ? FAR_OPACITY : 1;
    return (
      <g key={d.index} className={`${p}-qs-node`} opacity={groupOpacity}>
        {!d.faint && (
          <line
            className={`${p}-qs-stem`}
            x1={cx}
            y1={cy}
            x2={d.sx}
            y2={d.sy}
            strokeOpacity={Math.max(0.08, d.prob)}
          />
        )}
        <circle
          className={`${p}-qs-dot${d.isTarget ? ` ${p}-qs-dot--target` : ''}`}
          cx={d.sx}
          cy={d.sy}
          r={d.radius}
          fill={d.faint ? 'var(--faint, #5c6370)' : `hsl(${d.phaseDeg.toFixed(0)}, 70%, 60%)`}
          fillOpacity={d.faint ? 0.5 : 0.96}
          stroke={d.isTarget ? 'var(--entangle, #7a5cff)' : 'none'}
          strokeWidth={d.isTarget ? 2 : 0}
        />
      </g>
    );
  };

  return (
    <div className={`${p}-qsphere`}>
      <ResetOrientationButton classPrefix={p} onReset={reset} />
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        className={`${p}-qs-svg`}
        role="img"
        aria-label={title}
        style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
        {...handlers}
      >
        {/* silhouette + latitude guides */}
        <circle className={`${p}-qs-sphere`} cx={cx} cy={cy} r={R} />
        {guides.map((pts, i) => (
          <polyline key={i} className={`${p}-qs-guide`} points={pts} fill="none" />
        ))}
        {/* far hemisphere (dimmed, behind the disc) */}
        {far.map(renderNode)}
        {/* translucent sphere disc separates the hemispheres */}
        <circle className={`${p}-qs-disc`} cx={cx} cy={cy} r={R} />
        {/* near hemisphere (on top) */}
        {near.map(renderNode)}
      </svg>
      <div className={`${p}-qs-legend-wrap`}>
        <PhaseLegend classPrefix={p} />
      </div>
    </div>
  );
}

export default QSphereView;
