// @vitest-environment jsdom
/**
 * Task #48 fix 1: while connected as a booth viewer the booth drives the panel
 * set, so the drawer's PANELS section is read-only (disabled toggles + a
 * "Controlled by booth." note). Disconnected, the toggles are live again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { SettingsControl } from './SettingsDrawer';
import { boothLink } from './boothLink';

function openDrawer() {
  render(<SettingsControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
}

afterEach(() => {
  boothLink.disconnect();
  cleanup();
});

describe('SettingsDrawer PANELS section', () => {
  it('is live (enabled, no booth note) when standalone', () => {
    openDrawer();
    expect((screen.getByRole('switch', { name: 'Results' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByText('Controlled by booth.')).toBeNull();
  });

  it('is disabled with a "Controlled by booth." note while connected', () => {
    boothLink.connect('wss://booth.local:8443');
    openDrawer();
    for (const name of ['Camera preview', 'Results', 'State', 'OpenQASM']) {
      expect((screen.getByRole('switch', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText('Controlled by booth.')).toBeTruthy();
  });
});
