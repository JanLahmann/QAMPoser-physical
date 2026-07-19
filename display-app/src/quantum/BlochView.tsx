/**
 * BlochView — a 2D-projected Bloch sphere for Quantum Golf level 1.
 *
 * Shares the Q-sphere's projection + interaction machinery (`qsphere.ts`,
 * `useSphereRotation`): the reduced single-qubit Bloch vector `(x, y, z)` lives
 * in the same model space (z = pole axis), so |0⟩ sits at the top pole and |1⟩
 * at the bottom. Renders the sphere silhouette, an equator guide, the state
 * arrow + ball, and a purple target flag at |+⟩. Level 1's "any qubit" rule is
 * handled by `bestBlochQubit`, so whichever qubit is in superposition drives the
 * view. Structural SVG only — `${classPrefix}-bl-*` classes carry the styling.
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { projectPoint } from './qsphere';
import { blochVector, bestBlochQubit, TARGET_PLUS, type BlochVector } from './bloch';
import { statevector, type StateVector } from './statevector';
import { useSphereRotation } from './useSphereRotation';
import { ResetOrientationButton } from './ResetOrientationButton';

const MARGIN = 26;
const GUIDE_SAMPLES = 48;

export interface BlochViewProps {
  /** Provide a circuit (best superposition qubit auto-picked) or an explicit vector. */
  circuit?: Circuit;
  statevector?: StateVector;
  /** Force a specific qubit; otherwise the most-superposed qubit is chosen. */
  qubit?: number;
  size?: number;
  classPrefix: string;
  title?: string;
}

export function BlochView({
  circuit,
  statevector: svProp,
  qubit,
  size = 220,
  classPrefix,
  title = 'Bloch sphere state projection',
}: BlochViewProps) {
  const p = classPrefix;
  const sv = useMemo<StateVector>(
    () => svProp ?? (circuit ? statevector(circuit) : statevector({ qubits: 5, gates: [] } as Circuit)),
    [svProp, circuit],
  );
  const q = qubit ?? bestBlochQubit(sv);
  const vec: BlochVector = useMemo(() => blochVector(sv, q), [sv, q]);

  const { yaw, pitch, dragging, reset, handlers } = useSphereRotation();

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - MARGIN;
  const sX = (x: number) => cx + x * R;
  const sY = (y: number) => cy + y * R;
  const pt = (v: { x: number; y: number; z: number }) => {
    const pr = projectPoint(v, yaw, pitch);
    return { x: sX(pr.x), y: sY(pr.y), depth: pr.depth };
  };

  // Equator guide (z = 0 latitude), sampled + projected.
  const equator = useMemo(() => {
    const pts: string[] = [];
    for (let k = 0; k <= GUIDE_SAMPLES; k++) {
      const t = (2 * Math.PI * k) / GUIDE_SAMPLES;
      const pr = projectPoint({ x: Math.cos(t), y: Math.sin(t), z: 0 }, yaw, pitch);
      pts.push(`${sX(pr.x).toFixed(2)},${sY(pr.y).toFixed(2)}`);
    }
    return pts.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yaw, pitch, size]);

  const zero = pt({ x: 0, y: 0, z: 1 }); // |0⟩ pole
  const one = pt({ x: 0, y: 0, z: -1 }); // |1⟩ pole
  const state = pt(vec);
  const target = pt(TARGET_PLUS); // |+⟩

  return (
    <div className={`${p}-bloch`}>
      <ResetOrientationButton classPrefix={p} onReset={reset} />
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        className={`${p}-bl-svg`}
        role="img"
        aria-label={title}
        style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
        {...handlers}
      >
        <circle className={`${p}-bl-sphere`} cx={cx} cy={cy} r={R} />
        <polyline className={`${p}-bl-guide`} points={equator} fill="none" />
        {/* pole axis */}
        <line className={`${p}-bl-axis`} x1={zero.x} y1={zero.y} x2={one.x} y2={one.y} />

        {/* target flag at |+⟩ */}
        <g className={`${p}-bl-target`} opacity={target.depth < 0 ? 0.4 : 1}>
          <line x1={target.x} y1={target.y} x2={target.x} y2={target.y - 18} />
          <path d={`M ${target.x} ${target.y - 18} l 12 4 l -12 4 z`} />
          <circle cx={target.x} cy={target.y} r={3} />
        </g>

        {/* pole labels */}
        <text className={`${p}-bl-ket`} x={zero.x} y={zero.y - 6} textAnchor="middle">
          |0⟩
        </text>
        <text className={`${p}-bl-ket`} x={one.x} y={one.y + 14} textAnchor="middle">
          |1⟩
        </text>

        {/* state arrow + ball */}
        <g opacity={state.depth < 0 ? 0.5 : 1}>
          <line className={`${p}-bl-arrow`} x1={cx} y1={cy} x2={state.x} y2={state.y} />
          <circle className={`${p}-bl-ball`} cx={state.x} cy={state.y} r={7} />
        </g>

        <text className={`${p}-bl-qubit`} x={size - 6} y={size - 6} textAnchor="end">
          q{q}
        </text>
      </svg>
    </div>
  );
}

export default BlochView;
