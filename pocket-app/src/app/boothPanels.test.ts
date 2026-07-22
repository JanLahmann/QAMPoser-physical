// @vitest-environment jsdom
/**
 * Seam for the booth panel-overlay (task #48 fix 1): while connected the booth's
 * broadcast `panels` override the local `settings.panels`; standalone (or before
 * a layout arrives, `boothPanels` null) the local set stands. The overlay never
 * writes local settings, so a disconnect (null) restores them.
 */
import { describe, it, expect } from 'vitest';
import { boothOrLocalPanels } from './App';
import type { PanelId } from './settings';

const local: readonly PanelId[] = ['camera', 'results'];

describe('boothOrLocalPanels', () => {
  it('uses the local set when not connected (boothPanels null)', () => {
    expect(boothOrLocalPanels(null, local)).toBe(local);
  });

  it('uses the booth set (registry names, display order) while connected', () => {
    const booth = ['results', 'state', 'qasm'];
    expect(boothOrLocalPanels(booth, local)).toBe(booth);
  });

  it('honors an empty booth set (booth hid every panel) over the local one', () => {
    expect(boothOrLocalPanels([], local)).toEqual([]);
  });
});
