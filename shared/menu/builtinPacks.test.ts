/**
 * The bundled packs are the canonical fixtures: each must be ALREADY normalized,
 * so a round-trip through validatePack returns it unchanged with zero warnings.
 * If a builtin ever drifts out of normal form (unsorted items, a missing emoji,
 * an unfilled code), this suite catches it.
 */
import { describe, it, expect } from 'vitest';
import { validatePack } from './pack';
import { BUILTIN_PACKS, builtinPack } from './builtinPacks';

describe('BUILTIN_PACKS — every pack is pre-normalized', () => {
  for (const pack of BUILTIN_PACKS) {
    it(`${pack.id} round-trips validatePack unchanged with no warnings`, () => {
      const res = validatePack(pack);
      if (!res.ok) throw new Error(`${pack.id} failed validation: ${res.errors.join('; ')}`);
      expect(res.warnings).toEqual([]);
      expect(res.pack).toEqual(pack);
    });
  }

  it('has unique ids', () => {
    const ids = BUILTIN_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builtinPack looks up by id (and misses gracefully)', () => {
    expect(builtinPack('coffee')?.title).toBe('QoffeeMaker');
    expect(builtinPack('nope')).toBeUndefined();
  });
});

describe('BUILTIN_PACKS — scenario specifics', () => {
  it('coffee keeps the Espresso FillQuantity = 50 program option', () => {
    const coffee = builtinPack('coffee')!;
    const espresso = coffee.items.find((it) => it.name === 'Espresso')!;
    expect(espresso.program?.key).toContain('Espresso');
    expect(espresso.program?.options).toEqual([
      { key: 'ConsumerProducts.CoffeeMaker.Option.FillQuantity', value: 50 },
    ]);
  });

  it('coffee carries its footer links', () => {
    const coffee = builtinPack('coffee')!;
    expect(coffee.links?.map((l) => l.name)).toEqual(['IBM Quantum', 'Qiskit', 'Qoffee Maker']);
  });

  it('icecream is shots mode with bounds {min:1, max:3, default:3}', () => {
    const icecream = builtinPack('icecream')!;
    expect(icecream.serve).toEqual({ mode: 'shots', shots: { min: 1, max: 3, default: 3 } });
    // The house-precedent item.
    expect(icecream.items.find((it) => it.code === '111')?.name).toBe('Melted :(');
  });

  it('juice is subset mode with qubits 0, 1, 2', () => {
    const juice = builtinPack('juice')!;
    expect(juice.serve.mode).toBe('subset');
    expect(juice.qubits).toBe(3);
    expect(juice.items.map((it) => it.qubit)).toEqual([0, 1, 2]);
    expect(juice.items.every((it) => it.code === undefined)).toBe(true);
  });

  it('demo is a 2-qubit, 4-item single pack', () => {
    const demo = builtinPack('demo')!;
    expect(demo.qubits).toBe(2);
    expect(demo.serve).toEqual({ mode: 'single' });
    expect(demo.items.map((it) => it.code)).toEqual(['00', '01', '10', '11']);
  });
});
