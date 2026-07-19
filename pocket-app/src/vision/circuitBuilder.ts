/**
 * Build a `@qamposer/react` Circuit from per-cell tile placements.
 * EXACT port of `circuit_builder.py` — same deterministic gate ids
 * (`type-qubit-position` / `cnot-control-position`, lowercase), same CNOT
 * pairing (globally nearest control/target by row), same structured warnings
 * (`cell_conflict` / `lone_control` / `lone_target`), same ordering. The golden
 * fixtures in `tests/fixtures/circuits/*.json` pass through byte-identically.
 */
import { MARKER_TABLE, ROTATION_ANGLES, type GateSpec } from './markers';

const CNOT_CONTROL_ID = 14;
const CNOT_TARGET_ID = 15;
// The SWAP tile (×). Two in one column pair into a SWAP between their rows.
const SWAP_ID = 45;

export interface TilePlacement {
  readonly markerId: number;
  readonly row: number;
  readonly col: number;
  /**
   * Board-frame clockwise 90° step (0-3). Only meaningful for dial tiles
   * (42/43/44), where it selects `ROTATION_ANGLES[rotation]`; every other tile
   * is orientation-free and leaves it at the default 0.
   */
  readonly rotation?: number;
}

// 'off_grid' is emitted by the pipeline (not the builder) but shares the shape.
export type WarningKind =
  | 'cell_conflict'
  | 'lone_control'
  | 'lone_target'
  | 'lone_swap'
  | 'off_grid';

export interface BuildWarning {
  readonly kind: WarningKind;
  readonly message: string;
  readonly row: number | null;
  readonly col: number | null;
  readonly marker_ids: number[];
}

export interface CircuitGate {
  id: string;
  type: string;
  qubit?: number;
  control?: number;
  target?: number;
  position: number;
  parameter?: number;
}

export interface BuiltCircuit {
  qubits: number;
  gates: CircuitGate[];
}

export interface BuildResult {
  circuit: BuiltCircuit;
  warnings: BuildWarning[];
}

function specFor(markerId: number): GateSpec {
  const spec = MARKER_TABLE.get(markerId);
  if (!spec) throw new Error(`no marker table entry for id ${markerId}`);
  return spec;
}

function singleQubitGate(
  spec: GateSpec,
  row: number,
  col: number,
  rotation: number,
): CircuitGate {
  // Dial tiles (42/43/44): the angle comes from the tile's board-frame rotation,
  // ROTATION_ANGLES[rotation]. The emitted gate is byte-identical to a classic
  // rotation tile of that axis/angle at the same cell (same id, type, parameter)
  // — indistinguishable downstream. The rotation is part of the stabilizer key.
  if (spec.dialAxis) {
    const axis = spec.dialAxis;
    const angle = ROTATION_ANGLES[rotation % ROTATION_ANGLES.length];
    return {
      id: `${axis.toLowerCase()}-${row}-${col}`,
      type: axis,
      qubit: row,
      position: col,
      parameter: angle,
    };
  }

  // Tiles without a native @qamposer/react type (S / T) are emitted as their
  // RZ equivalent via `emitAs` — so the circuit JSON only ever carries RZ.
  if (spec.emitAs) {
    const [emitType, emitParameter] = spec.emitAs;
    return {
      id: `${emitType.toLowerCase()}-${row}-${col}`,
      type: emitType,
      qubit: row,
      position: col,
      parameter: emitParameter,
    };
  }

  const gate: CircuitGate = {
    id: `${spec.gate.toLowerCase()}-${row}-${col}`,
    type: spec.gate,
    qubit: row,
    position: col,
  };
  if (spec.parameter !== undefined) gate.parameter = spec.parameter;
  return gate;
}

function cnotGate(controlRow: number, targetRow: number, col: number): CircuitGate {
  return {
    id: `cnot-${controlRow}-${col}`,
    type: 'CNOT',
    control: controlRow,
    target: targetRow,
    position: col,
  };
}

/**
 * Emit a SWAP between `rowA`/`rowB` at column `col`. EXACT port of Python
 * `emit_swap`: until @qamposer/react gains a native SWAP type, a SWAP is its
 * 3-CNOT decomposition, all at position `col`, in array order
 * `cx(a,b), cx(b,a), cx(a,b)` with ids `swap-{a}-{col}-1/2/3` (a = lower row).
 * The single place that knows the decomposition — switching to a native
 * `{ type: 'SWAP', ... }` gate later is a one-function edit here.
 */
export function emitSwap(rowA: number, rowB: number, col: number): CircuitGate[] {
  const prefix = `swap-${rowA}-${col}`;
  return [
    { id: `${prefix}-1`, type: 'CNOT', control: rowA, target: rowB, position: col },
    { id: `${prefix}-2`, type: 'CNOT', control: rowB, target: rowA, position: col },
    { id: `${prefix}-3`, type: 'CNOT', control: rowA, target: rowB, position: col },
  ];
}

/** Pair × tiles in one column into SWAPs, nearest-by-row first (port of `_pair_swaps`). */
function pairSwaps(
  swapRows: number[],
  col: number,
): { pairs: Array<[number, number]>; warnings: BuildWarning[] } {
  const remaining = [...swapRows].sort((a, b) => a - b);
  const pairs: Array<[number, number]> = [];

  while (remaining.length >= 2) {
    let best: [number, number, number] | null = null; // (dist, a, b)
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const a = remaining[i];
        const b = remaining[j];
        const key: [number, number, number] = [b - a, a, b]; // remaining sorted → b > a
        if (best === null || lessThan3(key, best)) best = key;
      }
    }
    const [, aRow, bRow] = best as [number, number, number];
    pairs.push([aRow, bRow]);
    remaining.splice(remaining.indexOf(aRow), 1);
    remaining.splice(remaining.indexOf(bRow), 1);
  }

  const warnings: BuildWarning[] = [];
  for (const r of remaining) {
    warnings.push({
      kind: 'lone_swap',
      message: `SWAP tile at row ${r}, column ${col} has no partner in its column; excluded.`,
      row: r,
      col,
      marker_ids: [SWAP_ID],
    });
  }
  return { pairs, warnings };
}

/** Pair controls with targets in one column, nearest-by-row first. */
function pairCnots(
  controlRows: number[],
  targetRows: number[],
  col: number,
): { pairs: Array<[number, number]>; warnings: BuildWarning[] } {
  const remainingC = [...controlRows].sort((a, b) => a - b);
  const remainingT = [...targetRows].sort((a, b) => a - b);
  const pairs: Array<[number, number]> = [];

  while (remainingC.length > 0 && remainingT.length > 0) {
    let best: [number, number, number] | null = null; // (dist, c, t)
    for (const c of remainingC) {
      for (const t of remainingT) {
        const dist = Math.abs(c - t);
        const key: [number, number, number] = [dist, c, t];
        if (best === null || lessThan3(key, best)) best = key;
      }
    }
    // best is non-null here (loops ran at least once).
    const [, cRow, tRow] = best as [number, number, number];
    pairs.push([cRow, tRow]);
    remainingC.splice(remainingC.indexOf(cRow), 1);
    remainingT.splice(remainingT.indexOf(tRow), 1);
  }

  const warnings: BuildWarning[] = [];
  for (const c of remainingC) {
    warnings.push({
      kind: 'lone_control',
      message: `CNOT control at row ${c}, column ${col} has no target in its column; excluded.`,
      row: c,
      col,
      marker_ids: [CNOT_CONTROL_ID],
    });
  }
  for (const t of remainingT) {
    warnings.push({
      kind: 'lone_target',
      message: `CNOT target at row ${t}, column ${col} has no control in its column; excluded.`,
      row: t,
      col,
      marker_ids: [CNOT_TARGET_ID],
    });
  }
  return { pairs, warnings };
}

/**
 * The anchor row of a SWAP-decomposition CNOT (the lower row `a`, parsed from
 * its `swap-{a}-{col}-{n}` id), or null for any other gate. Used only for the
 * final ordering so a SWAP's three CNOTs sort as a unit and keep emission order.
 */
function swapAnchor(gate: CircuitGate): number | null {
  if (!gate.id.startsWith('swap-')) return null;
  return Number(gate.id.split('-')[1]);
}

/** Lexicographic `<` for 3-tuples (mirrors Python tuple comparison). */
function lessThan3(a: [number, number, number], b: [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}

export function buildCircuit(placements: TilePlacement[], qubits: number): BuildResult {
  const warnings: BuildWarning[] = [];

  // 1. Resolve cell conflicts: at most one tile per (row, col).
  const byCell = new Map<string, TilePlacement[]>();
  for (const p of placements) {
    const key = `${p.row},${p.col}`;
    const list = byCell.get(key);
    if (list) list.push(p);
    else byCell.set(key, [p]);
  }

  const kept: TilePlacement[] = [];
  for (const cellTiles of byCell.values()) {
    if (cellTiles.length > 1) {
      const { row, col } = cellTiles[0];
      warnings.push({
        kind: 'cell_conflict',
        message: `${cellTiles.length} tiles occupy cell (row ${row}, column ${col}); all excluded.`,
        row,
        col,
        marker_ids: [...cellTiles.map((t) => t.markerId)].sort((a, b) => a - b),
      });
      continue;
    }
    kept.push(cellTiles[0]);
  }

  // 2. Split kept tiles into single-qubit gates, CNOT halves and SWAP tiles.
  const gates: CircuitGate[] = [];
  const controlsByCol = new Map<number, number[]>();
  const targetsByCol = new Map<number, number[]>();
  const swapsByCol = new Map<number, number[]>();

  for (const p of kept) {
    const spec = specFor(p.markerId);
    if (spec.gate === 'CNOT') {
      const map = spec.role === 'control' ? controlsByCol : targetsByCol;
      const list = map.get(p.col);
      if (list) list.push(p.row);
      else map.set(p.col, [p.row]);
    } else if (spec.gate === 'SWAP') {
      const list = swapsByCol.get(p.col);
      if (list) list.push(p.row);
      else swapsByCol.set(p.col, [p.row]);
    } else {
      gates.push(singleQubitGate(spec, p.row, p.col, p.rotation ?? 0));
    }
  }

  // 3. Pair CNOT halves per column.
  const cols = [...new Set([...controlsByCol.keys(), ...targetsByCol.keys()])].sort(
    (a, b) => a - b,
  );
  for (const col of cols) {
    const { pairs, warnings: colWarnings } = pairCnots(
      controlsByCol.get(col) ?? [],
      targetsByCol.get(col) ?? [],
      col,
    );
    warnings.push(...colWarnings);
    for (const [controlRow, targetRow] of pairs) {
      gates.push(cnotGate(controlRow, targetRow, col));
    }
  }

  // 3b. Pair SWAP (×) tiles per column and emit each as its 3-CNOT form.
  for (const col of [...swapsByCol.keys()].sort((a, b) => a - b)) {
    const { pairs, warnings: colWarnings } = pairSwaps(swapsByCol.get(col) ?? [], col);
    warnings.push(...colWarnings);
    for (const [rowA, rowB] of pairs) {
      gates.push(...emitSwap(rowA, rowB, col));
    }
  }

  // 4. Deterministic gate ordering: by column, then by primary row, then type.
  gates.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    const ra = swapAnchor(a) ?? a.qubit ?? a.control ?? 0;
    const rb = swapAnchor(b) ?? b.qubit ?? b.control ?? 0;
    if (ra !== rb) return ra - rb;
    // A SWAP's three CNOTs share (position, anchor, "CNOT"); a stable sort keeps
    // their emission order (cx(a,b), cx(b,a), cx(a,b)) — the control row would
    // reorder them, so anchor all three at the SWAP's lower row instead.
    const ta = swapAnchor(a) !== null ? 'CNOT' : a.type;
    const tb = swapAnchor(b) !== null ? 'CNOT' : b.type;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  // Deterministic warning ordering.
  warnings.sort((a, b) => {
    const ca = a.col ?? 0;
    const cb = b.col ?? 0;
    if (ca !== cb) return ca - cb;
    const rowA = a.row ?? 0;
    const rowB = b.row ?? 0;
    if (rowA !== rowB) return rowA - rowB;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });

  return { circuit: { qubits, gates }, warnings };
}
