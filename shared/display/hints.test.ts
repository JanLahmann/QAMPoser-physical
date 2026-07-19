/**
 * Drift guard for the shared footer hint copy. Both apps render these lines on
 * the same rotation, so pin the content + interval here (SC1).
 */
import { describe, it, expect } from 'vitest';
import { HINTS, HINT_ROTATE_MS } from './hints';

describe('shared hint ticker', () => {
  it('carries exactly the four teaching lines', () => {
    expect(HINTS).toHaveLength(4);
  });

  it('mentions each core concept (CNOT, superposition, time order, correlation)', () => {
    const all = HINTS.join(' ');
    expect(all).toContain('CNOT');
    expect(all).toContain('superposition');
    expect(all).toContain('left-to-right');
    expect(all).toContain('entangled');
  });

  it('every line is a non-empty string', () => {
    for (const h of HINTS) expect(h.trim().length).toBeGreaterThan(0);
  });

  it('rotates on a 7 second cadence', () => {
    expect(HINT_ROTATE_MS).toBe(7000);
  });
});
