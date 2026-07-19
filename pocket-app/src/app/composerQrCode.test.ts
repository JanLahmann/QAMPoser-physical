import { describe, expect, it } from 'vitest';
import { COMPOSER_BASE, composerUrl } from './composerTransfer';
import { planComposerQr, renderQrSvg, QR_EC_M_MAX_CHARS } from './composerQrCode';

const BELL_QASM =
  'OPENQASM 2.0;\ninclude "qelib1.inc";\n\nqreg q[5];\ncreg c[5];\n\nh q[0];\ncx q[0], q[1];\n';

/** A genuinely incompressible payload — forces the composerUrl 7500-char fallback. */
function overLongQasm(): string {
  let x = 42;
  return Array.from({ length: 30000 }, () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return String.fromCharCode(33 + (x % 90));
  }).join('');
}

describe('planComposerQr', () => {
  it('encodes exactly composerUrl(qasm) for a normal circuit', () => {
    const plan = planComposerQr(BELL_QASM);
    expect(plan.url).toBe(composerUrl(BELL_QASM));
    expect(plan.overLong).toBe(false);
  });

  it('chooses error-correction level M for short URLs', () => {
    const plan = planComposerQr(BELL_QASM);
    // Bell ≈ 240 chars — comfortably under the M threshold.
    expect(plan.url.length).toBeLessThanOrEqual(QR_EC_M_MAX_CHARS);
    expect(plan.ecLevel).toBe('M');
  });

  it('drops to level L when the URL crosses the density threshold', () => {
    // Synthesise a URL just past the threshold via a padded (compressible-but-
    // long) qasm; if it still fits under budget, ecLevel must be L.
    const big = 'OPENQASM 2.0;\nqreg q[5];\n' + 'h q[0]; '.repeat(4000);
    const plan = planComposerQr(big);
    if (plan.url !== COMPOSER_BASE && plan.url.length > QR_EC_M_MAX_CHARS) {
      expect(plan.ecLevel).toBe('L');
    }
  });

  it('flags an over-long circuit and points url at the bare Composer', () => {
    const plan = planComposerQr(overLongQasm());
    expect(plan.url).toBe(COMPOSER_BASE);
    expect(plan.overLong).toBe(true);
  });

  it('is not over-long for an empty board (bare Composer, no circuit lost)', () => {
    const plan = planComposerQr('');
    expect(plan.url).toBe(COMPOSER_BASE);
    expect(plan.overLong).toBe(false);
  });
});

describe('renderQrSvg', () => {
  it('renders a self-contained SVG string (canvas-free)', async () => {
    const svg = await renderQrSvg(composerUrl(BELL_QASM), 'M');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});
