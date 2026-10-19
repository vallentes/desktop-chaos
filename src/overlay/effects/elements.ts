// Flamethrower, water cannon, lightning, snowstorm, laser.

import { Graphics } from 'pixi.js';
import { Kind } from '../../engine/particles';
import { Rng } from '../../engine/rng';
import { lightningBolt, Pt } from '../../engine/shapes';
import { burnMark, Entity, Stage } from '../stage';
import { EffectImpl, repeat, sparks, strokePath, sweep, wander } from './common';

const FLIGHT = 0.35;

/** Launch velocity so a particle under `g` lands on (tx,ty) after `t` seconds. */
function aim(x0: number, y0: number, tx: number, ty: number, t: number, g: number) {
  return { vx: (tx - x0) / t, vy: (ty - y0) / t - 0.5 * g * t };
}

// ---------------------------------------------------------------------------------------------
// Flamethrower
// ---------------------------------------------------------------------------------------------

const flameState = new WeakMap<Stage, { ignite: number }>();

function flameJet(s: Stage, tx: number, ty: number, dt: number) {
  const ox = s.w * 0.82;
  const oy = s.h + 20;
  const n = s.many(Math.ceil(260 * dt));
  for (let i = 0; i < n; i++) {
    const jx = tx + s.rng.range(-18, 18);
    const jy = ty + s.rng.range(-18, 18);
    const t = FLIGHT * s.rng.range(0.85, 1.15);
    const v = aim(ox, oy, jx, jy, t, -120);
    s.spawn({ kind: Kind.Fire, x: ox + s.rng.range(-6, 6), y: oy, vx: v.vx, vy: v.vy, life: t * 1.15, size: 10, size1: s.rng.range(30, 46), color: 0xfff8d0, color1: 0xff4a12, alpha: 0.95, alpha1: 0.1, gravity: -120 });
  }
  if (s.rng.chance(dt * 10)) s.spawn({ kind: Kind.Smoke, x: tx, y: ty - 20, vx: s.rng.range(-20, 20), vy: -60, life: 1.8, size: 20, size1: 70, color: 0x2e2a28, alpha: 0.3, alpha1: 0, drag: 0.4 });
  const st = flameState.get(s) ?? { ignite: 0 };
  flameState.set(s, st);
  st.ignite += dt;
  if (st.ignite > 0.12) {
    st.ignite = 0;
    s.fire.ignite(tx + s.rng.range(-20, 20), ty + s.rng.range(-20, 20), 0.5);
  }
  s.audio.loop('hiss', 0.6);
}

export const flamethrower: EffectImpl = {
  trigger(s, t) {
    sweep(s, Math.max(1, t.duration), wander(s, t, 0.25), (p, dt) => flameJet(s, p.x, p.y, dt), () => s.audio.loop('hiss', 0));
  },
  hold(s, x, y, dt) {
    flameJet(s, x, y, dt);
  },
  up(s) {
    s.audio.loop('hiss', 0);
  },
  disarm(s) {
    s.audio.loop('hiss', 0);
  },
};

// ---------------------------------------------------------------------------------------------
// Water cannon
// ---------------------------------------------------------------------------------------------

function waterJet(s: Stage, tx: number, ty: number, dt: number) {
  const ox = s.w * 0.18;
  const oy = s.h + 20;
  const g = 900;
  const n = s.many(Math.ceil(240 * dt));
  for (let i = 0; i < n; i++) {
    const jx = tx + s.rng.range(-10, 10);
    const jy = ty + s.rng.range(-10, 10);
    const t = FLIGHT * s.rng.range(0.9, 1.1);
    const v = aim(ox, oy, jx, jy, t, g);
    s.spawn({ kind: Kind.Water, x: ox, y: oy, vx: v.vx, vy: v.vy, life: t, size: s.rng.range(5, 9), color: 0xbfe6ff, color1: 0x4aa8ff, alpha: 0.85, alpha1: 0.6, gravity: g });
  }
  // Splash where it lands.
  for (let i = 0; i < s.many(Math.ceil(90 * dt)); i++) {
    s.spawn({ kind: Kind.Water, x: tx, y: ty, vx: s.rng.range(-220, 220), vy: s.rng.range(-260, -40), life: s.rng.range(0.3, 0.7), size: s.rng.range(3, 6), color: 0xd8f0ff, color1: 0x6fb8ff, alpha: 0.8, alpha1: 0, gravity: 1100, bounce: 0.2 });
  }
  const out = s.fire.douse(tx, ty, 80, 2.5 * dt);
  for (const f of out) {
    for (let i = 0; i < s.many(12); i++) {
      s.spawn({ kind: Kind.Steam, x: f.x + s.rng.range(-15, 15), y: f.y, vx: s.rng.range(-30, 30), vy: s.rng.range(-120, -50), life: s.rng.range(1, 2), size: 16, size1: 60, color: 0xf2f6fa, alpha: 0.45, alpha1: 0, drag: 0.8 });
    }
    s.audio.play('fuse', 0.6);
  }
  if (s.snow.total > 0 && s.rng.chance(dt * 4)) s.snow.melt(0.4);
  s.audio.loop('water', 0.7);
}

export const water: EffectImpl = {
  trigger(s, t) {
    // Aim at the fires first when there are any.
    const targets: Pt[] = s.fire.sources.slice(0, 8).map((f) => ({ x: f.x, y: f.y }));
    if (targets.length) {
      const secs = Math.max(1.5, t.duration);
      sweep(
        s,
        secs,
        (k) => {
          const i = Math.min(targets.length - 1, Math.floor(k * targets.length));
          return targets[i];
        },
        (p, dt) => waterJet(s, p.x, p.y, dt),
        () => s.audio.loop('water', 0),
      );
      return;
    }
    sweep(s, Math.max(1, t.duration), wander(s, t, 0.25), (p, dt) => waterJet(s, p.x, p.y, dt), () => s.audio.loop('water', 0));
  },
  hold(s, x, y, dt) {
    waterJet(s, x, y, dt);
  },
  up(s) {
    s.audio.loop('water', 0);
  },
  disarm(s) {
    s.audio.loop('water', 0);
  },
};

// ---------------------------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------------------------

function strike(s: Stage, x: number, y: number, seed: number, intensity: number) {
  const r = new Rng(seed);
  const bolt = lightningBolt(x + r.range(-s.w * 0.15, s.w * 0.15), -10, x, y, seed, 7);
  const reduced = s.reducedFlashing;
  let t = 0;
  const life = reduced ? 0.6 : 0.45;
  // Re-strikes flicker the bolt; reduced flashing draws it once and fades it smoothly.
  const flickers = reduced ? [] : [0.08, 0.16, 0.26];
  const draw = (g: Graphics, a: number) => {
    strokePath(g, bolt.main, { color: 0x8fc8ff, width: 14, alpha: 0.18 * a });
    strokePath(g, bolt.main, { color: 0xbfe2ff, width: 5, alpha: 0.5 * a });
    strokePath(g, bolt.main, { color: 0xffffff, width: 2.2, alpha: a });
    for (const b of bolt.branches) {
      strokePath(g, b, { color: 0x9fd0ff, width: 6, alpha: 0.15 * a });
      strokePath(g, b, { color: 0xffffff, width: 1.2, alpha: 0.8 * a });
    }
  };
  s.add({
    update(dt, st) {
      t += dt;
      if (t >= life) return false;
      const off = flickers.some((f) => t > f && t < f + 0.035);
      if (!off) draw(st.fx, reduced ? 1 - t / life : 1 - (t / life) * 0.6);
      return true;
    },
  });
  s.flash(0xdfefff, 0.35 + intensity * 0.25);
  const g = burnMark(x, y, 22, r);
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, Math.PI * 2);
    const len = r.range(20, 50);
    g.moveTo(x, y).lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  g.stroke({ color: 0x10141c, width: 2, alpha: 0.6 });
  s.decal(g);
  sparks(s, x, y, 24, { color: 0xffffff, color1: 0x6fb6ff, speed: 520 });
  if (r.chance(0.3 * intensity)) s.fire.ignite(x, y, 0.5);
  s.shake(3 + intensity * 4, 0.2);
  window.setTimeout(() => s.audio.play('thunder', 0.6 + intensity * 0.4), r.range(60, 260));
}

export const lightning: EffectImpl = {
  trigger(s, t) {
    const n = 1 + Math.round(t.intensity * (s.reducedFlashing ? 1 : 3));
    // Reduced flashing spaces strikes at least a second apart.
    repeat(s, n, s.reducedFlashing ? 1.2 : 0.35, (i) => {
      const x = i === 0 ? t.x : t.rng.range(s.w * 0.1, s.w * 0.9);
      const y = i === 0 ? t.y : t.rng.range(s.h * 0.4, s.h * 0.9);
      strike(s, x, y, t.rng.int(1, 1e9), t.intensity);
    });
  },
  down(s, x, y) {
    strike(s, x, y, s.rng.int(1, 1e9), s.intensity);
  },
};

// ---------------------------------------------------------------------------------------------
// Snowstorm
// ---------------------------------------------------------------------------------------------

class Storm implements Entity {
  t = 0;
  stopping = false;
  constructor(
    public secs: number,
    public density: number,
  ) {}
  update(dt: number, s: Stage): boolean {
    this.t += dt;
    if (this.t > this.secs) this.stopping = true;
    const ramp = Math.min(1, this.t / 2) * (this.stopping ? Math.max(0, 1 - (this.t - this.secs) / 2) : 1);
    const wind = s.options.snowWind;
    const rate = 40 + this.density * 260;
    const n = s.many(Math.round(rate * dt * ramp + (s.rng.chance((rate * dt * ramp) % 1) ? 1 : 0)));
    for (let i = 0; i < n; i++) {
      const size = s.rng.range(3, 10);
      s.spawn({ kind: Kind.Snow, x: s.rng.range(-s.w * 0.2, s.w * 1.2), y: -10, vx: wind * 90 + s.rng.range(-15, 15), vy: 30 + size * 9, life: 60, size, color: 0xffffff, alpha: 0.95, alpha1: 0.95, rot: s.rng.range(0, 6), spin: s.rng.range(-1.5, 1.5) });
    }
    // Sway, and settle on the pile.
    const P = s.particles;
    for (let i = P.count - 1; i >= 0; i--) {
      if (P.kind[i] !== Kind.Snow) continue;
      P.vx[i] += Math.sin(P.age[i] * 2 + i) * 18 * dt;
      if (P.y[i] >= s.floor - s.snow.heightAt(P.x[i])) {
        s.snow.add(P.x[i], P.size0[i] * 0.09);
        P.kill(i);
      } else if (P.x[i] < -s.w * 0.3 || P.x[i] > s.w * 1.3) {
        P.kill(i);
      }
    }
    let flakes = 0;
    for (let i = 0; i < P.count; i++) if (P.kind[i] === Kind.Snow) flakes++;
    s.audio.loop('wind', ramp * (0.3 + this.density * 0.6));
    if (this.stopping && ramp <= 0 && flakes === 0) {
      s.audio.loop('wind', 0);
      return false;
    }
    return true;
  }
  destroy(s: Stage) {
    s.audio.loop('wind', 0);
  }
}

const storms = new WeakMap<Stage, Storm>();

function startStorm(s: Stage, secs: number, density: number) {
  const cur = storms.get(s);
  if (cur && s.entities.includes(cur) && !cur.stopping) {
    cur.secs = Math.max(cur.secs, cur.t + secs);
    cur.density = Math.max(cur.density, density);
    return;
  }
  const storm = new Storm(secs, density);
  storms.set(s, storm);
  s.add(storm);
}

export const snow: EffectImpl = {
  trigger(s, t) {
    startStorm(s, Math.max(5, t.duration), s.options.snowDensity * (0.5 + t.intensity * 0.5));
  },
  down(s) {
    // Click toggles the storm.
    const cur = storms.get(s);
    if (cur && s.entities.includes(cur) && !cur.stopping) {
      cur.secs = cur.t;
      cur.stopping = true;
    } else {
      startStorm(s, 3600, s.options.snowDensity);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Laser
// ---------------------------------------------------------------------------------------------

const LASER_HEX: Record<string, number> = { red: 0xff2a2a, green: 0x39ff6a, blue: 0x3a8bff, purple: 0xc04bff };

function hsl(h: number): number {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

function laserColor(s: Stage, t: number): number {
  return s.options.laserColor === 'rainbow' ? hsl((t * 0.25) % 1) : LASER_HEX[s.options.laserColor] ?? 0xff2a2a;
}

interface LaserState {
  last: Pt | null;
  t: number;
}
const laserState = new WeakMap<Stage, LaserState>();

function beam(s: Stage, x: number, y: number, color: number, firing: boolean) {
  const ox = x < s.w / 2 ? -10 : s.w + 10;
  const oy = -10;
  const w = s.options.laserWidth;
  const g = s.fx;
  g.moveTo(ox, oy).lineTo(x, y).stroke({ color, width: (firing ? 14 : 6) * w, alpha: firing ? 0.25 : 0.12 });
  g.moveTo(ox, oy).lineTo(x, y).stroke({ color: 0xffffff, width: (firing ? 3 : 1.2) * w, alpha: firing ? 0.95 : 0.5 });
  g.circle(x, y, (firing ? 10 : 4) * w).fill({ color, alpha: firing ? 0.6 : 0.4 });
  g.circle(x, y, (firing ? 4 : 2) * w).fill({ color: 0xffffff, alpha: 0.9 });
}

function burn(s: Stage, st: LaserState, x: number, y: number, color: number, dt: number) {
  const w = s.options.laserWidth;
  const from = st.last ?? { x, y };
  const g = new Graphics();
  g.moveTo(from.x, from.y).lineTo(x + 0.01, y).stroke({ color: 0x120804, width: 9 * w, alpha: 0.5, cap: 'round' });
  g.moveTo(from.x, from.y).lineTo(x + 0.01, y).stroke({ color, width: 3 * w, alpha: 0.85, cap: 'round' });
  g.moveTo(from.x, from.y).lineTo(x + 0.01, y).stroke({ color: 0xffffff, width: 1 * w, alpha: 0.6, cap: 'round' });
  s.decal(g);
  st.last = { x, y };
  sparks(s, x, y, Math.ceil(60 * dt), { color: 0xffffff, color1: color, speed: 260, life: 0.3 });
  if (s.rng.chance(dt * 8)) s.spawn({ kind: Kind.Smoke, x, y, vx: s.rng.range(-10, 10), vy: -50, life: 1.2, size: 8, size1: 30, color: 0x403a38, alpha: 0.3, alpha1: 0 });
}

/** Patterns the auto laser burns in. */
const PATTERNS: ((k: number, r: number) => Pt)[] = [
  // star
  (k, r) => {
    const pts = 5;
    const a = k * Math.PI * 2 * 2 - Math.PI / 2;
    const idx = Math.floor(k * pts * 2);
    const rr = idx % 2 ? r * 0.45 : r;
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
  },
  // spiral
  (k, r) => ({ x: Math.cos(k * Math.PI * 8) * r * k, y: Math.sin(k * Math.PI * 8) * r * k }),
  // zigzag
  (k, r) => ({ x: (k - 0.5) * r * 2.4, y: (Math.abs(((k * 8) % 2) - 1) - 0.5) * r }),
  // circle
  (k, r) => ({ x: Math.cos(k * Math.PI * 2) * r, y: Math.sin(k * Math.PI * 2) * r }),
  // infinity
  (k, r) => {
    const a = k * Math.PI * 2;
    return { x: (Math.cos(a) * r) / (1 + Math.sin(a) ** 2), y: (Math.sin(a) * Math.cos(a) * r) / (1 + Math.sin(a) ** 2) };
  },
];

export const laser: EffectImpl = {
  trigger(s, t) {
    const pattern = t.rng.pick(PATTERNS);
    const r = Math.min(s.w, s.h) * (0.1 + t.intensity * 0.12);
    const st: LaserState = { last: null, t: 0 };
    let time = 0;
    sweep(
      s,
      Math.max(1.5, t.duration),
      (k) => {
        const p = pattern(k, r);
        return { x: t.x + p.x, y: t.y + p.y };
      },
      (p, dt) => {
        time += dt;
        const c = laserColor(s, time);
        beam(s, p.x, p.y, c, true);
        burn(s, st, p.x, p.y, c, dt);
        s.audio.loop('laser', 0.8);
      },
      () => s.audio.loop('laser', 0),
    );
  },
  down(s, x, y) {
    laserState.set(s, { last: { x, y }, t: laserState.get(s)?.t ?? 0 });
    s.audio.play('zap', 0.6);
  },
  hold(s, x, y, dt) {
    const st = laserState.get(s) ?? { last: null, t: 0 };
    laserState.set(s, st);
    burn(s, st, x, y, laserColor(s, st.t), dt);
  },
  up(s) {
    const st = laserState.get(s);
    if (st) st.last = null;
  },
  hover(s, x, y, dt) {
    const st = laserState.get(s) ?? { last: null, t: 0 };
    laserState.set(s, st);
    st.t += dt;
    beam(s, x, y, laserColor(s, st.t), st.last !== null);
    s.audio.loop('laser', st.last ? 1 : 0.35);
  },
  disarm(s) {
    s.audio.loop('laser', 0);
    laserState.delete(s);
  },
};
