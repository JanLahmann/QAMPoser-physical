// @vitest-environment jsdom
/**
 * Regression seam for the phone "build on screen" bug: in manual mode the stage
 * carries `pk-stage--manual`, which pocket.css uses to floor the editor height so
 * the on-screen gate palette can't collapse the wires. Camera/booth stages must
 * stay the plain `.pk-stage` (their phone sizing is unchanged), so the class is
 * strictly manual-only.
 */
import { describe, it, expect } from 'vitest';
import { stageClassName } from './App';

describe('stageClassName', () => {
  it('adds the manual variant only in manual mode', () => {
    expect(stageClassName(true)).toBe('pk-stage pk-stage--manual');
  });

  it('is the plain stage in camera/booth mode', () => {
    expect(stageClassName(false)).toBe('pk-stage');
    expect(stageClassName(false)).not.toContain('pk-stage--manual');
  });
});
