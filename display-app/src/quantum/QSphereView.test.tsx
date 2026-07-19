import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QSphereView } from './QSphereView';
import { ghzState } from './statevector';

afterEach(cleanup);

describe('QSphereView', () => {
  it('sizes nodes by probability (populated nodes larger than faint lattice dots)', () => {
    // Bell pair on {0,1}: two populated basis states (p=0.5), the rest ~0.
    const { container } = render(<QSphereView statevector={ghzState([0, 1])} classPrefix="pk" />);
    const dots = Array.from(container.querySelectorAll('.pk-qs-dot')) as SVGCircleElement[];
    expect(dots.length).toBe(32);

    const radii = dots.map((d) => Number(d.getAttribute('r'))).sort((a, b) => b - a);
    // The two populated nodes are clearly larger than the faint (~1px) dots.
    expect(radii[0]).toBeGreaterThan(5);
    expect(radii[1]).toBeGreaterThan(5);
    expect(radii[2]).toBeLessThan(2); // first faint lattice dot
    expect(radii.filter((r) => r <= 1.01).length).toBe(30);
  });

  it('offers a rewind-arrow reset-orientation button', () => {
    render(<QSphereView statevector={ghzState([0, 1])} classPrefix="bo" />);
    const btn = screen.getByRole('button', { name: 'Reset orientation' });
    expect(btn).toBeTruthy();
    // Clicking is a no-op smoke (orientation is internal) — must not throw.
    fireEvent.click(btn);
  });

  it('renders the phase color-wheel legend', () => {
    const { container } = render(<QSphereView statevector={ghzState([0, 1])} classPrefix="pk" />);
    expect(container.querySelector('.pk-qs-legend')).not.toBeNull();
  });
});
