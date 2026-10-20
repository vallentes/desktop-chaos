// Hammer, machine gun, broken glass, paintball.

import { Container, Graphics, Text } from 'pixi.js';
import { Kind } from '../../engine/particles';
import { Rng } from '../../engine/rng';
import { crackPattern, Pt, shatter, splatOutline } from '../../engine/shapes';
import type { Stage } from '../stage';
import { EffectImpl, NEON, repeat, sparks, strokePath, sweep, wander } from './common';

// ---------------------------------------------------------------------------------------------
// Hammer
// ---------------------------------------------------------------------------------------------

interface Hit {
  x: number;
  y: number;
  count: number;
  at: number;
}
const hits = new WeakMap<Stage, Hit[]>();

function drawCracks(s: Stage, x: number, y: number, power: number, seed: number) {
  const radius = (55 + power * 32) * s.options.hammerPower;
  const lines = crackPattern(x, y, radius, power, seed);
  const g = new Graphics();
  // Dark under-stroke keeps cracks readable on white pages, bright stroke on dark ones.
  for (const l of lines) strokePath(g, l.points.map((p) => ({ x: p.x + 1, y: p.y + 1 })), { color: 0x000000, width: l.width + 1, alpha: 0.35 });
  for (const l of lines) strokePath(g, l.points, { color: 0xffffff, width: l.width, alpha: 0.9 });
  g.circle(x, y, 4 + power * 2).fill({ color: 0xffffff, alpha: 0.7 });
  g.circle(x, y, 10 + power * 5).stroke({ color: 0xffffff, width: 1, alpha: 0.35 });
  s.decal(g);
}

function hammerHit(s: Stage, x: number, y: number) {
  let list = hits.get(s);
  if (!list) {
    const fresh: Hit[] = [];
    list = fresh;
    hits.set(s, fresh);
    s.onClear.push(() => (fresh.length = 0));
  }
  const now = performance.now();
  let h = list.find((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 55 * 55);
  if (!h) {
    h = { x, y, count: 0, at: now };
    list.push(h);
    if (list.length > 60) list.shift();
  }
  h.count++;
  h.at = now;
  const power = Math.min(5, h.count);
  drawCracks(s, h.x + s.rng.range(-6, 6), h.y + s.rng.range(-6, 6), power, s.rng.int(1, 1e9));
  for (let i = 0; i < s.many(6 + power * 3); i++) {
    s.spawn({ kind: Kind.Glint, x, y, vx: s.rng.range(-160, 160), vy: s.rng.range(-220, 40), life: s.rng.range(0.6, 1.2), size: s.rng.range(3, 7), color: 0xe8f6ff, alpha: 0.9, alpha1: 0, gravity: 900, spin: s.rng.range(-15, 15), bounce: 0.3 });
  }
  s.audio.play('hammer', 0.5 + power * 0.1);
  s.shake(1.5 + power * 0.8, 0.12);
  // Hit the same spot enough and pieces fall out.
  if (h.count === 5) void glassShards(s, h.x, h.y, 70, s.rng.int(1, 1e9), 8);
}

export const hammer: EffectImpl = {
  trigger(s, t) {
    const n = 1 + Math.round(t.intensity * 2);
    const x = t.x;
    const y = t.y;
    repeat(s, n, 0.18, () => hammerHit(s, x + t.rng.range(-10, 10), y + t.rng.range(-10, 10)));
  },
  down(s, x, y) {
    hammerHit(s, x, y);
  },
};

// ---------------------------------------------------------------------------------------------
// Machine gun
// ---------------------------------------------------------------------------------------------

function bulletHole(s: Stage, x: number, y: number) {
  const r = s.rng;
  const g = new Graphics();
  const n = r.int(5, 9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.range(-0.3, 0.3);
    const len = r.range(6, 16);
    g.moveTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3).lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  g.stroke({ color: 0xffffff, width: 1, alpha: 0.65 });
  g.circle(x, y, 6.5).fill({ color: 0x9aa4ad, alpha: 0.35 });
  g.circle(x, y, 4).fill({ color: 0x0b0b0c, alpha: 0.92 });
  g.circle(x - 1, y - 1, 1.6).fill({ color: 0x2a2d31, alpha: 0.9 });
  s.decal(g);
}

function shot(s: Stage, x: number, y: number, spread: number) {
  const r = s.rng;
  const px = x + r.gauss() * spread;
  const py = y + r.gauss() * spread;
  bulletHole(s, px, py);
  sparks(s, px, py, 6, { speed: 380, life: 0.25 });
  s.spawn({ kind: Kind.Glint, x: px, y: py, life: 0.06, size: 26, color: 0xfff6d0, alpha: 1, alpha1: 0 });
  // Brass casing flicked out to the right.
  s.spawn({ kind: Kind.Debris, x: px + 30, y: py + 20, vx: r.range(120, 260), vy: r.range(-420, -260), life: 1.6, size: 5, color: 0xd4a640, gravity: 1400, spin: r.range(-25, 25), alpha: 1, alpha1: 0.4, bounce: 0.4 });
  s.audio.play('gun', 0.7);
  s.shake(1.2, 0.05);
}

const gunState = new WeakMap<Stage, { acc: number; heat: number }>();

export const machinegun: EffectImpl = {
  trigger(s, t) {
    const secs = Math.max(0.6, t.duration);
    const interval = 60 / s.options.fireRate;
    const path = wander(s, t, 0.3);
    let acc = interval;
    sweep(s, secs, path, (p, dt) => {
      acc += dt;
      while (acc >= interval) {
        acc -= interval;
        shot(s, p.x, p.y, 8 + t.intensity * 10);
      }
    });
  },
  down(s, x, y) {
    gunState.set(s, { acc: 0, heat: 0 });
    shot(s, x, y, 2);
  },
  hold(s, x, y, dt) {
    const st = gunState.get(s) ?? { acc: 0, heat: 0 };
    gunState.set(s, st);
    const interval = 60 / s.options.fireRate;
    st.acc += dt;
    st.heat = Math.min(1, st.heat + dt * 0.4);
    while (st.acc >= interval) {
      st.acc -= interval;
      shot(s, x, y, 3 + st.heat * 14); // recoil opens the spread
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Broken glass
// ---------------------------------------------------------------------------------------------

async function glassShards(s: Stage, x: number, y: number, radius: number, seed: number, pieces: number) {
  const phys = await s.getPhysics();
  const r = new Rng(seed);
  for (const sh of shatter(x, y, radius, seed, pieces)) {
    const g = new Graphics();
    g.poly(sh.poly.flatMap((p) => [p.x, p.y])).fill({ color: 0xd6ecff, alpha: 0.28 }).stroke({ color: 0xffffff, width: 1.2, alpha: 0.85 });
    if (sh.poly.length > 2) strokePath(g, [sh.poly[0], sh.poly[1]].map((p) => ({ x: p.x * 0.7, y: p.y * 0.7 })), { color: 0xffffff, width: 2, alpha: 0.5 });
    const dx = sh.cx - x;
    const dy = sh.cy - y;
    const d = Math.hypot(dx, dy) || 1;
    const push = r.range(40, 160);
    const h = phys.addPolygon(sh.cx, sh.cy, sh.poly, (dx / d) * push, (dy / d) * push - r.range(0, 80), r.range(-4, 4), { g, kind: 'shard' }, { ttl: r.range(5, 9) });
    s.addBody(h);
  }
}

function hole(s: Stage, x: number, y: number, radius: number, seed: number) {
  const r = new Rng(seed);
  const c = new Container();
  const g = new Graphics();
  const outline = splatOutline(x, y, radius * 0.42, seed).map((p) => [p.x, p.y]).flat();
  g.poly(outline).fill({ color: 0x050807, alpha: 0.88 }).stroke({ color: 0xffffff, width: 2, alpha: 0.6 });
  c.addChild(g);
  // A little green "code" seen through the hole.
  const digits = new Text({
    text: Array.from({ length: 6 }, () => Array.from({ length: 7 }, () => r.int(0, 9)).join('')).join('\n'),
    style: { fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: Math.max(9, radius * 0.07), fill: 0x2bff6a, lineHeight: Math.max(10, radius * 0.08) },
  });
  digits.alpha = 0.55;
  digits.anchor.set(0.5);
  digits.position.set(x, y);
  const mask = new Graphics().poly(outline).fill(0xffffff);
  digits.mask = mask;
  c.addChild(mask, digits);
  const cracks = crackPattern(x, y, radius * 1.3, 3, seed + 1);
  const cg = new Graphics();
  for (const l of cracks) strokePath(cg, l.points, { color: 0xffffff, width: l.width, alpha: 0.8 });
  c.addChild(cg);
  s.decal(c);
}

function shatterAt(s: Stage, x: number, y: number, intensity: number, seed: number) {
  const radius = 90 + intensity * 150;
  hole(s, x, y, radius, seed);
  void glassShards(s, x, y, radius * 0.45, seed, Math.round(8 + intensity * 8));
  for (let i = 0; i < s.many(30); i++) {
    s.spawn({ kind: Kind.Glint, x: x + s.rng.range(-20, 20), y: y + s.rng.range(-20, 20), vx: s.rng.range(-300, 300), vy: s.rng.range(-300, 100), life: s.rng.range(0.8, 1.6), size: s.rng.range(3, 8), color: 0xeaf6ff, alpha: 1, alpha1: 0, gravity: 1000, spin: s.rng.range(-20, 20), bounce: 0.3 });
  }
  s.audio.play('glass', 0.6 + intensity * 0.4);
  s.shake(3 + intensity * 5, 0.25);
}

export const glass: EffectImpl = {
  trigger(s, t) {
    shatterAt(s, t.x, t.y, t.intensity, t.seed);
  },
  down(s, x, y) {
    shatterAt(s, x, y, s.intensity, s.rng.int(1, 1e9));
  },
};

export { glassShards };

// ---------------------------------------------------------------------------------------------
// Paintball
// ---------------------------------------------------------------------------------------------

function splat(s: Stage, x: number, y: number, color: number, size: number, seed: number) {
  const r = new Rng(seed);
  const radius = r.range(22, 42) * size;
  const g = new Graphics();
  g.poly(splatOutline(x, y, radius, seed).flatMap((p) => [p.x, p.y])).fill({ color, alpha: 0.92 });
  const drops = r.int(6, 14);
  for (let i = 0; i < drops; i++) {
    const a = r.range(0, Math.PI * 2);
    const d = radius * r.range(1.1, 2.4);
    g.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, r.range(2, 7) * size).fill({ color, alpha: 0.9 });
  }
  g.ellipse(x - radius * 0.3, y - radius * 0.35, radius * 0.28, radius * 0.14).fill({ color: 0xffffff, alpha: 0.28 });
  s.decal(g);
  for (let i = 0; i < s.many(14); i++) {
    const a = r.range(0, Math.PI * 2);
    const v = r.range(120, 380);
    s.spawn({ kind: Kind.Paint, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: r.range(0.3, 0.6), size: r.range(3, 7) * size, color, alpha: 1, alpha1: 0.8, gravity: 900 });
  }
  // Drips run down and leave a trail.
  const dripCount = r.int(1, 3);
  for (let k = 0; k < dripCount; k++) {
    const sx = x + r.range(-radius * 0.6, radius * 0.6);
    let py = y + radius * 0.5;
    let speed = r.range(30, 70);
    const len = r.range(30, 140);
    let moved = 0;
    const w = r.range(3, 6) * size;
    s.add({
      update(dt, st) {
        const step = speed * dt;
        speed *= 0.995;
        moved += step;
        const dg = new Graphics().rect(sx - w / 2, py, w, step + 1).fill({ color, alpha: 0.92 });
        py += step;
        st.decal(dg);
        if (moved >= len) {
          st.decal(new Graphics().circle(sx, py, w * 0.8).fill({ color, alpha: 0.92 }));
          return false;
        }
        return true;
      },
    });
  }
  s.audio.play('splat', 0.8);
}

export const paintball: EffectImpl = {
  trigger(s, t) {
    const n = 2 + Math.round(t.intensity * 10);
    repeat(s, n, 0.12, () => {
      const x = t.x + t.rng.range(-220, 220) * t.intensity;
      const y = t.y + t.rng.range(-160, 160) * t.intensity;
      splat(s, x, y, t.rng.pick(NEON), s.options.paintSize, t.rng.int(1, 1e9));
    });
  },
  down(s, x, y) {
    splat(s, x, y, s.rng.pick(NEON), s.options.paintSize, s.rng.int(1, 1e9));
  },
};

/** Exported for tests and the earthquake (which reuses the crack drawing). */
export function groundCrack(s: Stage, x: number, y: number, seed: number) {
  const r = new Rng(seed);
  const pts: Pt[] = [{ x, y }];
  let a = -Math.PI / 2 + r.range(-0.6, 0.6);
  let p = { x, y };
  const len = r.range(60, 200);
  for (let d = 0; d < len; d += 10) {
    a += r.range(-0.5, 0.5);
    p = { x: p.x + Math.cos(a) * 10, y: p.y + Math.sin(a) * 10 };
    pts.push(p);
  }
  const g = new Graphics();
  strokePath(g, pts, { color: 0x1b120b, width: 5, alpha: 0.8 });
  strokePath(g, pts, { color: 0x000000, width: 2, alpha: 0.9 });
  strokePath(g, pts.map((q) => ({ x: q.x + 2, y: q.y })), { color: 0xc9b49a, width: 1, alpha: 0.5 });
  s.decal(g);
}

