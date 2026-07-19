/**
 * Touch-to-inspect — the booth's enable decision plus a re-export of the shared
 * copy helpers (docs/booth-ux.md, "Variant-A refinements → Touch").
 *
 * Touch is OPTIONAL on the booth and never edits the circuit (the physical
 * table is the editor). The framework-free copy/decision logic
 * (`gateInspectCopy`, `outcomeInspectCopy`, `formatAngle`, `POPOVER_MS`) now
 * lives in `@quantum/inspectCopy` so pocket can share it; it is re-exported
 * here so existing booth callers (`TouchInspector`, tests) keep importing from
 * `./touch`. Only the booth-specific `?touch` / coarse-pointer enable decision
 * stays local — pocket has touch always on.
 */
export {
  POPOVER_MS,
  formatAngle,
  gateInspectCopy,
  outcomeInspectCopy,
} from '@quantum/inspectCopy';

/**
 * Whether touch-to-inspect should be active: explicit `?touch=1` (or `0` to
 * force off) wins; otherwise it follows a coarse pointer (a touchscreen).
 */
export function isTouchEnabled(search: string, coarsePointer: boolean): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('touch');
  if (raw !== null) {
    return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
  }
  return coarsePointer;
}
