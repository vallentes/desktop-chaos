// Dev-only page for checking effects in a normal browser: `npm run dev`, open /harness.html.
// window.fx('meteor', 0.5, 0.5) fires one; window.stage is the live Stage.
import 'pixi.js/unsafe-eval';
import { DEFAULT_TOOL_OPTIONS, EffectId } from '../shared/effects';
import { IMPLS, runTrigger } from '../overlay/registry';
import { Stage } from '../overlay/stage';

const stage = new Stage();
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

void stage.init(document.getElementById('stage')!, 40).then(() => {
  stage.configure({ sound: false, volume: 0, reducedFlashing: false, quality: 'high', particleBudget: 3000, intensity: 1, toolOptions: DEFAULT_TOOL_OPTIONS, stopShortcut: '' });
  Object.assign(window, {
    stage,
    errors,
    fx: (effect: EffectId, x = 0.5, y = 0.5, duration: number | null = null) =>
      runTrigger(stage, { effect, monitor: 0, x, y, intensity: 1, duration, seed: (Math.random() * 1e9) >>> 0, source: 'user' }),
    down: (effect: EffectId, x: number, y: number) => IMPLS[effect].down?.(stage, x, y),
    clear: () => stage.clearNow(),
    ready: true,
  });
});
