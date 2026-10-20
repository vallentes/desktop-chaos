// Dev-only: renders README GIFs from the real effect engine, frame by frame, over a drawn
// backdrop (never a real screen). Run `npm run dev:capture`, open /capture.html at
// 960x540, then call `await capture('hero')` in the console. Files land in docs/media.
import 'pixi.js/unsafe-eval';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { DEFAULT_TOOL_OPTIONS, EffectId } from '../shared/effects';
import { IMPLS, runTrigger } from '../overlay/registry';
import { Stage } from '../overlay/stage';
import { backdrop } from './backdrop';

const W = 960;
const H = 540;
const TASKBAR = 34;

type Step = [number, (s: Stage) => void];

let seed = 1000;
const fire = (effect: EffectId, x: number, y: number, duration: number | null = null, intensity = 0.85) => (s: Stage) =>
  runTrigger(s, { effect, monitor: 0, x, y, intensity, duration, seed: seed++, source: 'user' });
const hit = (effect: EffectId, x: number, y: number) => (s: Stage) => IMPLS[effect].down?.(s, x * W, y * H);

const SCENES: Record<string, { secs: number; steps: Step[] }> = {
  hero: {
    secs: 11,
    steps: [
      [0.2, hit('hammer', 0.22, 0.35)],
      [0.5, hit('hammer', 0.22, 0.35)],
      [0.8, hit('hammer', 0.23, 0.36)],
      [1.2, fire('machinegun', 0.62, 0.3, 1.2, 0.7)],
      [2.2, fire('paintball', 0.8, 0.62, null, 0.6)],
      [3.0, fire('meteor', 0.45, 0.72, null, 0.8)],
      [4.2, fire('laser', 0.72, 0.4, 2.2, 0.6)],
      [5.0, fire('flamethrower', 0.15, 0.75, 1.6, 0.7)],
      [6.6, fire('blackhole', 0.5, 0.42, 2.6, 0.9)],
      [8.0, fire('bomb', 0.5, 0.5)],
    ],
  },
  impact: {
    secs: 7,
    steps: [
      [0.2, hit('hammer', 0.25, 0.4)],
      [0.6, hit('hammer', 0.25, 0.4)],
      [1.0, hit('hammer', 0.26, 0.41)],
      [1.4, hit('hammer', 0.25, 0.4)],
      [2.0, fire('machinegun', 0.55, 0.3, 1.4, 0.7)],
      [3.6, fire('glass', 0.72, 0.55, null, 0.7)],
      [4.6, fire('paintball', 0.4, 0.65, null, 0.6)],
    ],
  },
  'fire-water': {
    secs: 8,
    steps: [
      [0.2, fire('flamethrower', 0.45, 0.5, 2.4, 0.8)],
      [4.2, fire('water', 0.45, 0.5, 2.6, 0.8)],
    ],
  },
  sky: {
    secs: 7,
    steps: [
      [0.2, fire('snow', 0.5, 0.5, 7, 1)],
      [0.8, fire('lightning', 0.3, 0.6, null, 0.4)],
      [2.4, fire('meteor', 0.7, 0.7, null, 0.6)],
      [4.5, fire('lightning', 0.55, 0.55, null, 0.3)],
    ],
  },
  blackhole: {
    secs: 8,
    steps: [
      [0.1, fire('paintball', 0.3, 0.4, null, 0.7)],
      [0.2, fire('gravity', 0.5, 0, null, 0.7)],
      [1.0, fire('glass', 0.7, 0.35, null, 0.5)],
      [3.0, fire('blackhole', 0.5, 0.45, 4, 1)],
    ],
  },
  monster: {
    secs: 10,
    steps: [[0.1, fire('monster', 0.5, 0.5, null, 0.6)]],
  },
  'laser-quake': {
    secs: 7,
    steps: [
      [0.2, fire('laser', 0.4, 0.42, 2.6, 0.8)],
      [3.2, fire('earthquake', 0.5, 0.5, 3.2, 0.9)],
    ],
  },
  bomb: {
    secs: 6,
    steps: [
      [0.1, fire('meteor', 0.3, 0.7, null, 0.6)],
      [0.2, fire('paintball', 0.7, 0.4, null, 0.7)],
      [0.4, fire('gravity', 0.6, 0, null, 0.5)],
      [1.2, fire('bomb', 0.5, 0.5)],
    ],
  },
};

const stage = new Stage();
const bg = backdrop();
const out = document.createElement('canvas');
const ctx = out.getContext('2d', { willReadFrequently: true })!;

async function capture(name: string, fps = 15, scale = 0.75) {
  const scene = SCENES[name];
  if (!scene) throw new Error(`no scene ${name}`);
  seed = 1000;
  stage.clearNow();
  await stage.getPhysics();
  const ow = Math.round(W * scale);
  const oh = Math.round(H * scale);
  out.width = ow;
  out.height = oh;
  const steps = [...scene.steps];
  const dt = 1 / 30;
  const perFrame = Math.round(30 / fps);
  const frames: Uint8ClampedArray[] = [];
  let t = 0;
  let frame = 0;
  while (t < scene.secs) {
    while (steps.length && steps[0][0] <= t) steps.shift()![1](stage);
    (stage as unknown as { update(dt: number): void }).update(dt);
    t += dt;
    if (frame++ % perFrame) continue;
    stage.app.render();
    ctx.drawImage(bg, 0, 0, ow, oh);
    ctx.drawImage(stage.app.canvas, 0, 0, ow, oh);
    frames.push(ctx.getImageData(0, 0, ow, oh).data);
    if (frame % 30 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  // One palette for the whole clip (sampled from every few frames), 255 colours + 1 transparent.
  const sampleFrames = frames.filter((_, i) => i % 6 === 0);
  const sample = new Uint8ClampedArray(sampleFrames.length * ow * oh);
  sampleFrames.forEach((f, k) => {
    for (let i = 0, j = k * ow * oh; i < ow * oh; i += 4, j += 4) sample.set(f.subarray(i * 4, i * 4 + 4), j);
  });
  const palette = quantize(sample, 255);
  const clear = palette.length;
  palette.push([0, 0, 0]);
  // Each frame only stores pixels that changed since the last one; the rest are transparent.
  const gif = GIFEncoder();
  let prev: Uint8Array | null = null;
  for (const f of frames) {
    const idx = applyPalette(f, palette);
    const outIdx = prev ? idx.map((v: number, i: number) => (v === prev![i] ? clear : v)) : idx;
    gif.writeFrame(outIdx, ow, oh, { palette, delay: Math.round(1000 / fps), transparent: prev !== null, transparentIndex: clear, dispose: 1 });
    prev = idx;
  }
  gif.finish();
  const bytes = gif.bytes();
  await fetch(`/__capture?name=${name}.gif`, { method: 'POST', body: bytes });
  return `${name}.gif ${(bytes.length / 1024 / 1024).toFixed(2)} MB`;
}

async function still(name: string, effects: [EffectId, number, number][], secs: number) {
  seed = 2000;
  stage.clearNow();
  await stage.getPhysics();
  for (const [e, x, y] of effects) fire(e, x, y)(stage);
  for (let t = 0; t < secs; t += 1 / 30) (stage as unknown as { update(dt: number): void }).update(1 / 30);
  stage.app.render();
  out.width = W;
  out.height = H;
  ctx.drawImage(bg, 0, 0);
  ctx.drawImage(stage.app.canvas, 0, 0, W, H);
  const blob = await new Promise<Blob>((r) => out.toBlob((b) => r(b!), 'image/png'));
  await fetch(`/__capture?name=${name}.png`, { method: 'POST', body: blob });
  return name;
}

void stage.init(document.getElementById('stage')!, TASKBAR, true).then(() => {
  stage.configure({ sound: false, volume: 0, reducedFlashing: true, quality: 'high', particleBudget: 4000, intensity: 0.85, toolOptions: DEFAULT_TOOL_OPTIONS, stopShortcut: '' });
  // The capture drives frames itself.
  stage.wake = () => {};
  Object.assign(window, { capture, still, stage, scenes: Object.keys(SCENES), ready: true });
}).catch((e) => Object.assign(window, { initError: String((e as Error)?.stack ?? e) }));
