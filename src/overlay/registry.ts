import type { EffectId } from '../shared/effects';
import type { FxTrigger } from '../shared/types';
import { Rng } from '../engine/rng';
import type { Stage } from './stage';
import type { EffectImpl } from './effects/common';
import { glass, hammer, machinegun, paintball } from './effects/impact';
import { flamethrower, laser, lightning, snow, water } from './effects/elements';
import { blackhole, bombFx, earthquake, meteor } from './effects/cosmic';
import { gravity, monster } from './effects/critters';

export const IMPLS: Record<EffectId, EffectImpl> = {
  hammer,
  machinegun,
  flamethrower,
  water,
  lightning,
  meteor,
  blackhole,
  monster,
  gravity,
  glass,
  paintball,
  snow,
  earthquake,
  laser,
  bomb: bombFx,
};

/** Seconds a continuous effect runs when the trigger does not say. */
export const DEFAULT_DURATION: Partial<Record<EffectId, number>> = {
  machinegun: 2,
  flamethrower: 3,
  water: 3,
  snow: 15,
  earthquake: 4,
  laser: 3,
  blackhole: 7,
};

/** Where an effect lands when the trigger gives no position (normalized). */
function defaultPos(effect: EffectId, r: Rng): { x: number; y: number } {
  switch (effect) {
    case 'bomb':
      return { x: 0.5, y: 0.5 };
    case 'meteor':
    case 'lightning':
      return { x: r.range(0.12, 0.88), y: r.range(0.45, 0.9) };
    case 'gravity':
      return { x: r.range(0.2, 0.8), y: 0 };
    default:
      return { x: r.range(0.12, 0.88), y: r.range(0.15, 0.85) };
  }
}

export function runTrigger(s: Stage, t: FxTrigger) {
  const impl = IMPLS[t.effect];
  if (!impl) return;
  const rng = new Rng(t.seed);
  const pos = t.x !== null && t.y !== null ? { x: t.x, y: t.y } : defaultPos(t.effect, rng);
  impl.trigger(s, {
    x: Math.min(1, Math.max(0, pos.x)) * s.w,
    y: Math.min(1, Math.max(0, pos.y)) * s.h,
    intensity: Math.min(1, Math.max(0.05, t.intensity)),
    duration: t.duration ?? DEFAULT_DURATION[t.effect] ?? 0,
    rng,
    seed: t.seed,
  });
  s.wake();
}
