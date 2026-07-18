/**
 * Degradation benchmark for the pocket marker detector (`npm run bench`).
 *
 * Renders the GHZ-3 and all_families boards (via tests/utils/render_board.py),
 * applies a menu of parameterised degradations in TS — gaussian blur,
 * downscale/upscale (distance), additive noise, gamma/contrast reduction, motion
 * blur — and measures the per-marker detection rate for each, comparing:
 *
 *   before   the pre-change detector (id-dedupe, basic sampling, no guided pass)
 *   after    subpixel + robust sampling + grid-guided redetection (defaults)
 *   +robust / +subpix / +guided   single-lever ablations, to attribute the gain
 *   python   the OpenCV reference (cv2.aruco) on the identical degraded PNGs
 *
 * Averaged over several seeds (noise is stochastic). Also reports the added
 * per-frame cost of the guided pass. This is measurement, not vibes: the table
 * it prints is the deliverable.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { PocketPipeline, type PipelineOptions } from '../src/vision/pipeline';
import type { RgbaImage } from '../src/vision/detect';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const RENDER = resolve(REPO_ROOT, 'tests/utils/render_board.py');
const DETECT = resolve(HERE, 'detect_png.py');

const PX_PER_MM = 1.6; // marker 36 mm -> ~57 px (~9.6 px/module); a phone-at-screen base
const WARP = 0.05; // mild keystone, as from an iPhone held at a slight angle
const SEEDS = 5;
const BASE_NOISE = 3; // always-present sensor noise so rates are meaningful

type Placement = [number, number, number]; // marker_id, row, col

const SCENARIOS: Record<string, Placement[]> = {
  ghz3: [
    [10, 0, 0],
    [14, 0, 1],
    [15, 1, 1],
    [14, 0, 2],
    [15, 2, 2],
  ],
  all_families: [
    [10, 0, 0],
    [11, 1, 0],
    [12, 2, 0],
    [13, 3, 0],
    [21, 0, 1],
    [24, 1, 1],
    [30, 2, 1],
    [14, 0, 2],
    [15, 1, 2],
    [31, 3, 3],
  ],
};

interface Level {
  name: string;
  blur?: number;
  scale?: number;
  noise?: number;
  gamma?: number; // contrast factor in (0,1]: v -> 128 + (v-128)*gamma
  motion?: number; // horizontal motion-blur length (px)
}

const LEVELS: Level[] = [
  { name: 'clean' },
  { name: 'blur s=0.5', blur: 0.5 },
  { name: 'blur s=1.0', blur: 1.0 },
  { name: 'blur s=2.0', blur: 2.0 },
  { name: 'down 0.8x', scale: 0.8 },
  { name: 'down 0.6x', scale: 0.6 },
  { name: 'noise +15', noise: 15 },
  { name: 'contrast .5', gamma: 0.5 },
  { name: 'motion 7px', motion: 7 },
  { name: 'TARGET s1+0.6x', blur: 1.0, scale: 0.6 },
  { name: 'far 0.5x', scale: 0.5 },
  { name: 'hard s1.5+0.55x', blur: 1.5, scale: 0.55 },
];

const CONFIGS: Record<string, PipelineOptions> = {
  // The true original: id-keyed dedupe (collapses GHZ's repeated CNOT ids),
  // basic sampling, no subpixel, no guided pass.
  orig: { guided: false, detect: { legacyIdDedupe: true, subpixel: false, robustSample: false } },
  // Spatial dedupe only (the structural fix), still basic sampling / no guided.
  'fix-dedupe': { guided: false, detect: { subpixel: false, robustSample: false } },
  '+subpix': { guided: false, detect: { subpixel: true, robustSample: false } },
  '+robust': { guided: false, detect: { subpixel: false, robustSample: true } },
  '+guided': { guided: true, detect: { subpixel: false, robustSample: false } },
  after: { guided: true, detect: { subpixel: true, robustSample: true } },
};

// --------------------------------------------------------------------------
// Gray-image degradations (Float32, one channel; detection greyscales anyway)
// --------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toGrayF(img: RgbaImage): Float32Array {
  const { data, width, height } = img;
  const g = new Float32Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) / 256;
  }
  return g;
}

function bilinearResample(
  src: Float32Array,
  w: number,
  h: number,
  nw: number,
  nh: number,
): Float32Array {
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy = ((y + 0.5) * h) / nh - 0.5;
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)));
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < nw; x++) {
      const sx = ((x + 0.5) * w) / nw - 0.5;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx)));
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const a = src[y0 * w + x0];
      const b = src[y0 * w + x1];
      const c = src[y1 * w + x0];
      const d = src[y1 * w + x1];
      out[y * nw + x] =
        a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }
  return out;
}

function downUp(src: Float32Array, w: number, h: number, scale: number): Float32Array {
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  return bilinearResample(bilinearResample(src, w, h, nw, nh), nw, nh, w, h);
}

function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.max(0, Math.min(w - 1, x + k));
        acc += src[y * w + xx] * kernel[k + radius];
      }
      tmp[y * w + x] = acc;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.max(0, Math.min(h - 1, y + k));
        acc += tmp[yy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

function motionBlurH(src: Float32Array, w: number, h: number, len: number): Float32Array {
  const r = Math.floor(len / 2);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.max(0, Math.min(w - 1, x + k));
        acc += src[y * w + xx];
        n++;
      }
      out[y * w + x] = acc / n;
    }
  }
  return out;
}

function applyLevel(base: Float32Array, w: number, h: number, level: Level, seed: number): Float32Array {
  let g = base;
  if (level.scale) g = downUp(g, w, h, level.scale);
  if (level.blur) g = gaussianBlur(g, w, h, level.blur);
  if (level.motion) g = motionBlurH(g, w, h, level.motion);
  if (level.gamma) {
    g = g.map((v) => 128 + (v - 128) * level.gamma!);
  }
  const rng = mulberry32(seed * 2654435761 + 12345);
  const noiseSigma = (level.noise ?? 0) + BASE_NOISE;
  const out = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) {
    // Box-Muller.
    const u1 = Math.max(1e-9, rng());
    const u2 = rng();
    const nrm = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out[i] = Math.max(0, Math.min(255, g[i] + nrm * noiseSigma));
  }
  return out;
}

function grayToRgba(g: Float32Array, w: number, h: number): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const v = Math.round(g[i]);
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = 255;
  }
  return { data, width: w, height: h };
}

function writeGrayPng(g: Float32Array, w: number, h: number, path: string): void {
  const png = new PNG({ width: w, height: h });
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const v = Math.round(g[i]);
    png.data[p] = v;
    png.data[p + 1] = v;
    png.data[p + 2] = v;
    png.data[p + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}

// --------------------------------------------------------------------------
// Rendering + observation
// --------------------------------------------------------------------------

function renderClean(scenario: string, out: string): RgbaImage {
  execFileSync(
    'uv',
    [
      'run',
      'python',
      RENDER,
      '--scenario',
      scenario,
      '--px-per-mm',
      String(PX_PER_MM),
      '--warp',
      String(WARP),
      '--out',
      out,
    ],
    { cwd: REPO_ROOT, stdio: 'ignore' },
  );
  const png = PNG.sync.read(readFileSync(out));
  return { data: new Uint8Array(png.data), width: png.width, height: png.height };
}

const keyOf = (p: Placement): string => p.join(',');

function observeTS(img: RgbaImage, cfg: PipelineOptions): { hits: Set<string>; ms: number; stats: { candidates: number; blindHits: number; guidedRescues: number } } {
  const pipe = new PocketPipeline(cfg);
  const t0 = performance.now();
  const r = pipe.processFrame(img);
  const ms = performance.now() - t0;
  const hits = new Set<string>();
  for (const m of r.markers) {
    if (!m.offGrid && m.row !== null && m.col !== null) hits.add(`${m.id},${m.row},${m.col}`);
  }
  return { hits, ms, stats: r.stats };
}

function rate(hits: Set<string>, expected: Placement[]): number {
  let n = 0;
  for (const p of expected) if (hits.has(keyOf(p))) n++;
  return n / expected.length;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function pct(x: number): string {
  return (x * 100).toFixed(0).padStart(3) + '%';
}

function main(): void {
  const tmp = mkdtempSync(join(tmpdir(), 'pocket-bench-'));
  const configNames = Object.keys(CONFIGS);

  // Accumulators: rates[scenario][levelName][configName] = summed rate.
  const rates: Record<string, Record<string, Record<string, number>>> = {};
  const pyRates: Record<string, Record<string, number>> = {};
  const guidedCostMs: number[] = [];
  const noGuidedCostMs: number[] = [];
  const pyPaths: string[] = [];
  const pyMeta: Array<{ scenario: string; level: string }> = [];

  for (const scenario of Object.keys(SCENARIOS)) {
    const expected = SCENARIOS[scenario];
    const cleanPng = join(tmp, `${scenario}_clean.png`);
    const clean = renderClean(scenario, cleanPng);
    const baseGray = toGrayF(clean);
    const w = clean.width;
    const h = clean.height;
    rates[scenario] = {};
    pyRates[scenario] = {};

    for (const level of LEVELS) {
      rates[scenario][level.name] = Object.fromEntries(configNames.map((c) => [c, 0]));
      pyRates[scenario][level.name] = 0;

      for (let s = 0; s < SEEDS; s++) {
        const g = applyLevel(baseGray, w, h, level, s + 1);
        const img = grayToRgba(g, w, h);

        for (const cfg of configNames) {
          const { hits, ms } = observeTS(img, CONFIGS[cfg]);
          rates[scenario][level.name][cfg] += rate(hits, expected);
          if (cfg === 'after') guidedCostMs.push(ms);
        }
        // Guided-off variant timing on the same frame (isolates guided cost).
        const off = observeTS(img, { guided: false, detect: { subpixel: true, robustSample: true } });
        noGuidedCostMs.push(off.ms);

        // Persist this exact frame for the python reference detector.
        const pth = join(tmp, `${scenario}_${level.name.replace(/[^a-z0-9]/gi, '_')}_${s}.png`);
        writeGrayPng(g, w, h, pth);
        pyPaths.push(pth);
        pyMeta.push({ scenario, level: level.name });
      }
    }
  }

  // Batch the python reference over every degraded frame.
  const pyOut = execFileSync('uv', ['run', 'python', DETECT, ...pyPaths], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const pyJson = JSON.parse(pyOut) as Record<string, Placement[]>;
  pyPaths.forEach((pth, i) => {
    const { scenario, level } = pyMeta[i];
    const hits = new Set((pyJson[pth] ?? []).map(keyOf));
    pyRates[scenario][level] += rate(hits, SCENARIOS[scenario]);
  });

  // ---- report ----
  const cols = [...configNames, 'python'];
  for (const scenario of Object.keys(SCENARIOS)) {
    console.log(`\n=== ${scenario} (${SCENARIOS[scenario].length} tiles) — per-marker detection rate, mean of ${SEEDS} seeds ===`);
    console.log(['level'.padEnd(16), ...cols.map((c) => c.padStart(8))].join(' '));
    for (const level of LEVELS) {
      const cells = configNames.map((c) => pct(rates[scenario][level.name][c] / SEEDS));
      cells.push(pct(pyRates[scenario][level.name] / SEEDS));
      console.log([level.name.padEnd(16), ...cells.map((c) => c.padStart(8))].join(' '));
    }
  }

  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  console.log('\n=== per-frame cost ===');
  console.log(`base image: ${PX_PER_MM} px/mm, warp ${WARP}`);
  console.log(`after (with guided):     ${mean(guidedCostMs).toFixed(1)} ms/frame`);
  console.log(`after (guided disabled): ${mean(noGuidedCostMs).toFixed(1)} ms/frame`);
  console.log(`added guided cost:       ${(mean(guidedCostMs) - mean(noGuidedCostMs)).toFixed(1)} ms/frame`);

  rmSync(tmp, { recursive: true, force: true });
}

main();
