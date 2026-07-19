/**
 * Wording test for the shared `friendlyWarning`, exercised through the SUPERSET
 * of codes both apps feed it (booth `DetectionWarning.code`, Pocket
 * `BuildWarning.kind` → `code`, including Pocket's `off_grid`).
 */
import { describe, it, expect } from 'vitest';
import { friendlyWarning } from './warnings';

describe('friendlyWarning', () => {
  it('names the CNOT partner for lone control/target, with a 1-based column', () => {
    expect(friendlyWarning({ code: 'lone_control', col: 2 })).toBe(
      'A ● control tile is missing its ⊕ partner in column 3.',
    );
    expect(friendlyWarning({ code: 'lone_target', col: 0 })).toBe(
      'A ⊕ target tile is missing its ● partner in column 1.',
    );
  });

  it('omits the column phrase when col is absent or null', () => {
    expect(friendlyWarning({ code: 'lone_control' })).toBe(
      'A ● control tile is missing its ⊕ partner.',
    );
    expect(friendlyWarning({ code: 'lone_target', col: null })).toBe(
      'A ⊕ target tile is missing its ● partner.',
    );
  });

  it('phrases a cell conflict', () => {
    expect(friendlyWarning({ code: 'cell_conflict', col: 1 })).toBe(
      'Two tiles are competing for the same cell in column 2 — nudge one aside.',
    );
  });

  it('phrases a cell conflict without a column when col is absent', () => {
    expect(friendlyWarning({ code: 'cell_conflict' })).toBe(
      'Two tiles are competing for the same cell — nudge one aside.',
    );
  });

  it('phrases the Pocket-only off_grid code, ignoring any column', () => {
    expect(friendlyWarning({ code: 'off_grid', col: 4 })).toBe(
      'A tile is off the grid — slide it onto a cell.',
    );
    expect(friendlyWarning({ code: 'off_grid' })).toBe(
      'A tile is off the grid — slide it onto a cell.',
    );
  });

  it('falls back to the caller message for unknown codes (e.g. lone_swap)', () => {
    expect(friendlyWarning({ code: 'lone_swap', col: 1, message: 'SWAP has no partner.' })).toBe(
      'SWAP has no partner.',
    );
  });

  it('uses a generic prompt when an unknown code has no message', () => {
    expect(friendlyWarning({ code: 'mystery', col: 2 })).toBe('Check the board in column 3.');
    expect(friendlyWarning({ code: 'mystery' })).toBe('Check the board.');
  });
});
