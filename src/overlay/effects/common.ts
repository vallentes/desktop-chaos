import { Graphics } from 'pixi.js';
import { Kind } from '../../engine/particles';
import { Rng } from '../../engine/rng';
import type { Pt } from '../../engine/shapes';
import type { Entity, Stage } from '../stage';

export interface TriggerCtx {
  x: number;
  y: number;
  intensity: number;
  /** Seconds for continuous effects. */
  duration: number;
  rng: Rng;
  seed: number;
}

export interface EffectImpl {
  /** Programmatic trigger: chaos, API, Arsenal "Fire" button. */
  trigger(s: Stage, t: TriggerCtx): void;
  /** Armed tool: button pressed. */
  down?(s: Stage, x: number, y: number): void;
  /** Armed tool: every frame while the button is held. */
  hold?(s: Stage, x: number, y: number, dt: number): void;
  up?(s: Stage, x: number, y: number): void;
  /** Armed tool: every frame while armed (laser beam follows the mouse). */
  hover?(s: Stage, x: number, y: number, dt: number): void;
  disarm?(s: Stage): void;
}

/** Runs `fn` after `secs`. */
export function after(s: Stage, secs: number, fn: () => void) {
  let t = 0;
  s.add({
    update(dt) {
      t += dt;
      if (t >= secs) {
        fn();
        return false;
      }
      return true;
    },
  });
}

/** Runs `fn(i)` `count` times, `interval` apart, starting now. */
export function repeat(s: Stage, count: number, interval: number, fn: (i: number) => void) {
  let i = 0;
  let t = interval;
  s.add({
    update(dt) {
      t += dt;
      while (t >= interval && i < count) {
        t -= interval;
        fn(i++);
      }
      return i < count;
    },
  });
}

export function sparks(s: Stage, x: number, y: number, n: number, opts: { color?: number; color1?: number; speed?: number; angle?: number; spread?: number; gravity?: number; life?: number; size?: number } = {}) {
  const r = s.rng;
  const count = s.many(n);
  for (let i = 0; i < count; i++) {
    const a = (opts.angle ?? 0) + (opts.spread !== undefined ? r.range(-opts.spread, opts.spread) : r.range(-Math.PI, Math.PI));
    const v = (opts.speed ?? 400) * r.range(0.3, 1);
    s.spawn({
      kind: Kind.Spark,
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: (opts.life ?? 0.45) * r.range(0.5, 1.2),
      size: opts.size ?? r.range(5, 9),
      size1: 1,
      color: opts.color ?? 0xfff3c4,
      color1: opts.color1 ?? 0xff7a1a,
      gravity: opts.gravity ?? 600,
      drag: 1.5,
      alpha: 1,
      alpha1: 0,
    });
  }
}

export function debris(s: Stage, x: number, y: number, n: number, colors: number[], speed = 420) {
  const r = s.rng;
  const count = s.many(n);
  for (let i = 0; i < count; i++) {
    const a = r.range(-Math.PI * 0.95, -Math.PI * 0.05);
    const v = speed * r.range(0.3, 1);
    s.spawn({
      kind: Kind.Debris,
      x: x + r.range(-6, 6),
      y: y + r.range(-6, 6),
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: r.range(1.2, 2.6),
      size: r.range(3, 9),
      color: r.pick(colors),
      gravity: 1100,
      drag: 0.4,
      spin: r.range(-12, 12),
      rot: r.range(0, 6),
      alpha: 1,
      alpha1: 0.6,
      bounce: 0.35,
    });
  }
}

export function dust(s: Stage, x: number, y: number, n: number, color = 0x8a7a68, spread = 40) {
  const r = s.rng;
  for (let i = 0; i < s.many(n); i++) {
    s.spawn({ kind: Kind.Dust, x: x + r.range(-spread, spread), y: y + r.range(-spread / 3, spread / 3), vx: r.range(-40, 40), vy: r.range(-60, -10), life: r.range(0.8, 1.8), size: r.range(10, 18), size1: r.range(30, 50), color, alpha: 0.3, alpha1: 0, drag: 1.2 });
  }
}

/** Expanding ring. */
export function shockwave(s: Stage, x: number, y: number, maxR: number, secs = 0.6, color = 0xffd9a0) {
  let t = 0;
  s.add({
    update(dt, st) {
      t += dt;
      const k = t / secs;
      if (k >= 1) return false;
      const ease = 1 - Math.pow(1 - k, 3);
      st.fx.circle(x, y, maxR * ease).stroke({ color, width: 14 * (1 - k) + 1, alpha: 0.7 * (1 - k) });
      st.fx.circle(x, y, maxR * ease * 0.92).stroke({ color: 0xffffff, width: 3 * (1 - k), alpha: 0.5 * (1 - k) });
      return true;
    },
  });
}

export function strokePath(g: Graphics, pts: Pt[], style: { color: number; width: number; alpha?: number }) {
  if (pts.length < 2) return g;
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  return g.stroke({ color: style.color, width: style.width, alpha: style.alpha ?? 1, cap: 'round', join: 'round' });
}

/** Moves a point along a path over `secs`, calling `fn` each frame (auto mode for hold tools). */
export function sweep(s: Stage, secs: number, path: (k: number) => Pt, fn: (p: Pt, dt: number, k: number) => void, done?: () => void): Entity {
  let t = 0;
  const e: Entity = {
    update(dt) {
      t += dt;
      const k = Math.min(1, t / secs);
      fn(path(k), dt, k);
      if (k >= 1) {
        done?.();
        return false;
      }
      return true;
    },
  };
  s.add(e);
  return e;
}

/** A wandering path across part of the screen, for hold tools in auto mode. */
export function wander(s: Stage, t: TriggerCtx, reach = 0.25): (k: number) => Pt {
  const r = new Rng(t.seed ^ 0x5a5a);
  const a = r.range(0, Math.PI * 2);
  const len = Math.min(s.w, s.h) * reach;
  const x0 = t.x - Math.cos(a) * len;
  const y0 = t.y - Math.sin(a) * len;
  const wob = r.range(20, 60);
  const freq = r.range(2, 5);
  return (k) => ({
    x: Math.min(s.w - 10, Math.max(10, x0 + Math.cos(a) * len * 2 * k + Math.sin(k * Math.PI * freq) * wob)),
    y: Math.min(s.h - 10, Math.max(10, y0 + Math.sin(a) * len * 2 * k + Math.cos(k * Math.PI * freq) * wob)),
  });
}

export const NEON = [0xff2d55, 0xff9f0a, 0xffd60a, 0x30d158, 0x64d2ff, 0x5e5ce6, 0xbf5af2, 0xff375f, 0x00f5d4];
