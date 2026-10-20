// Meteor, black hole, earthquake, reset bomb.

import { Kind } from '../../engine/particles';
import { Rng } from '../../engine/rng';
import { crackPattern } from '../../engine/shapes';
import { burnMark, Stage } from '../stage';
import { EffectImpl, debris, dust, repeat, shockwave, sparks, strokePath } from './common';
import { groundCrack } from './impact';

// ---------------------------------------------------------------------------------------------
// Meteor
// ---------------------------------------------------------------------------------------------

function crater(s: Stage, x: number, y: number, r: number, seed: number) {
  const rng = new Rng(seed);
  const g = burnMark(x, y, r * 1.6, rng);
  g.ellipse(x, y, r, r * 0.8).fill({ color: 0x140c08, alpha: 0.75 });
  g.ellipse(x, y + r * 0.1, r * 0.7, r * 0.5).fill({ color: 0x060403, alpha: 0.6 });
  g.ellipse(x, y, r, r * 0.8).stroke({ color: 0x7a5534, width: 4, alpha: 0.6 });
  g.ellipse(x - r * 0.2, y - r * 0.2, r * 0.5, r * 0.3).fill({ color: 0xff7a2a, alpha: 0.25 });
  for (let i = 0; i < 10; i++) {
    const a = rng.range(0, Math.PI * 2);
    g.circle(x + Math.cos(a) * r * rng.range(0.9, 1.3), y + Math.sin(a) * r * 0.8 * rng.range(0.9, 1.3), rng.range(2, 6)).fill({ color: 0x3a2a1c, alpha: 0.9 });
  }
  for (const l of crackPattern(x, y, r * 2.6, 2, seed + 3)) strokePath(g, l.points, { color: 0x000000, width: l.width + 0.5, alpha: 0.45 });
  s.decal(g);
}

function impact(s: Stage, x: number, y: number, intensity: number, seed: number) {
  const r = 30 + intensity * 45;
  crater(s, x, y, r, seed);
  shockwave(s, x, y, 160 + intensity * 260, 0.7);
  s.flash(0xffb070, 0.1 + intensity * 0.15);
  s.shake(6 + intensity * 12, 0.5);
  debris(s, x, y, 40, [0x4a3626, 0x6b4b33, 0x2b1d14, 0x8c6a4a], 500 + intensity * 300);
  sparks(s, x, y, 40, { speed: 600 });
  dust(s, x, y, 18, 0x6e5a48, r);
  if (intensity > 0.5) for (let i = 0; i < 3; i++) s.fire.ignite(x + s.rng.range(-r, r), y + s.rng.range(-r * 0.5, r * 0.3), 0.5);
  s.physics?.blast(x, y, 6 + intensity * 8, 350);
  s.audio.play('boom', 0.6 + intensity * 0.4);
}

function launchMeteor(s: Stage, tx: number, ty: number, intensity: number, seed: number) {
  const rng = new Rng(seed);
  const dir = rng.chance(0.5) ? 1 : -1;
  const x0 = tx + dir * (ty + 200) * rng.range(0.4, 0.8);
  const y0 = -120;
  const secs = rng.range(0.7, 1.0);
  const size = 14 + intensity * 16;
  const rock = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    const rr = size * rng.range(0.75, 1.1);
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  }).flat();
  let t = 0;
  s.audio.play('meteor', 0.8);
  s.add({
    update(dt, st) {
      t += dt;
      const k = Math.min(1, t / secs);
      const e = k * k;
      const x = x0 + (tx - x0) * e;
      const y = y0 + (ty - y0) * e;
      // Trail.
      for (let i = 0; i < st.many(Math.ceil(240 * dt)); i++) {
        st.spawn({ kind: Kind.Fire, x: x + st.rng.range(-size / 2, size / 2), y: y + st.rng.range(-size / 2, size / 2), vx: st.rng.range(-30, 30), vy: st.rng.range(-30, 30), life: st.rng.range(0.3, 0.6), size: size * 1.6, size1: 4, color: 0xfff0b0, color1: 0xff3a0a, alpha: 0.9, alpha1: 0 });
      }
      if (st.rng.chance(dt * 30)) st.spawn({ kind: Kind.Smoke, x, y, vx: 0, vy: -10, life: 1.5, size: size, size1: size * 4, color: 0x332b26, alpha: 0.35, alpha1: 0, drag: 0.5 });
      const g = st.fx;
      g.circle(x, y, size * 2.2).fill({ color: 0xff6a1a, alpha: 0.25 });
      g.poly(rock.map((v, i) => v + (i % 2 ? y : x))).fill({ color: 0x3b2a20 }).stroke({ color: 0xffa040, width: 3, alpha: 0.9 });
      if (k >= 1) {
        impact(st, tx, ty, intensity, seed);
        return false;
      }
      return true;
    },
  });
}

export const meteor: EffectImpl = {
  trigger(s, t) {
    const n = 1 + Math.floor(t.intensity * 2.5);
    repeat(s, n, 0.45, (i) => {
      const x = i === 0 ? t.x : t.rng.range(s.w * 0.1, s.w * 0.9);
      const y = i === 0 ? t.y : t.rng.range(s.h * 0.35, s.h * 0.9);
      launchMeteor(s, x, y, t.intensity, t.rng.int(1, 1e9));
    });
  },
  down(s, x, y) {
    launchMeteor(s, x, y, s.intensity, s.rng.int(1, 1e9));
  },
};

// ---------------------------------------------------------------------------------------------
// Black hole
// ---------------------------------------------------------------------------------------------

function blackHole(s: Stage, x: number, y: number, secs: number, intensity: number) {
  let t = 0;
  const maxR = 34 + intensity * 30;
  let eraseAt = 0;
  s.audio.play('blackhole', 0.8);
  s.add({
    update(dt, st) {
      t += dt;
      const grow = Math.min(1, t / 0.7);
      const shrink = t > secs ? Math.max(0, 1 - (t - secs) / 0.5) : 1;
      const r = maxR * grow * shrink;
      if (shrink <= 0) {
        st.flash(0xd9b8ff, 0.2);
        shockwave(st, x, y, 220, 0.5, 0xc8a2ff);
        st.audio.play('pop', 1);
        return false;
      }
      st.forces.push({ x, y, strength: 26 * (0.6 + intensity), radius: 900, eat: r * 0.8 });
      // Fires get dragged in too.
      for (const f of st.fire.sources) {
        const dx = x - f.x;
        const dy = y - f.y;
        const d = Math.hypot(dx, dy);
        if (d < r) f.heat = 0;
        else if (d < 600) {
          f.x += (dx / d) * 120 * dt;
          f.y += (dy / d) * 120 * dt;
        }
      }
      // Rub out decals around it, wider over time.
      eraseAt -= dt;
      if (eraseAt <= 0) {
        eraseAt = 0.15;
        st.eraseDecal(x, y, r * (1 + t * 0.4));
      }
      // Debris streams in from the edges so the pull is visible.
      for (let i = 0; i < st.many(Math.ceil(60 * dt)); i++) {
        const a = st.rng.range(0, Math.PI * 2);
        const d = st.rng.range(250, 600);
        st.spawn({ kind: Kind.Dust, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: -Math.sin(a) * 120, vy: Math.cos(a) * 120, life: 4, size: st.rng.range(2, 5), color: st.rng.pick([0xb18cff, 0xff9a5a, 0xffffff]), alpha: 0.9, alpha1: 0.5 });
      }
      const g = st.fx;
      for (let k = 0; k < 4; k++) {
        const rr = r * (1.5 + k * 0.45);
        const a0 = t * (3 - k * 0.5) + k;
        g.arc(x, y, rr, a0, a0 + Math.PI * 1.2).stroke({ color: k % 2 ? 0xff8a3d : 0x9b6bff, width: 3 - k * 0.5, alpha: 0.55 - k * 0.1 });
      }
      g.circle(x, y, r * 1.35).fill({ color: 0x6a3cff, alpha: 0.18 });
      g.circle(x, y, r).fill({ color: 0x000000, alpha: 1 }).stroke({ color: 0xd2b6ff, width: 2, alpha: 0.8 });
      return true;
    },
  });
}

export const blackhole: EffectImpl = {
  trigger(s, t) {
    blackHole(s, t.x, t.y, Math.max(3, t.duration || 7), t.intensity);
  },
  down(s, x, y) {
    blackHole(s, x, y, 6, s.intensity);
  },
};

// ---------------------------------------------------------------------------------------------
// Earthquake
// ---------------------------------------------------------------------------------------------

function quake(s: Stage, secs: number, intensity: number) {
  let t = 0;
  let crackAt = 0.3;
  s.audio.play('rumble', 0.6 + intensity * 0.4);
  s.physics?.jolt(2 + intensity * 4);
  s.add({
    update(dt, st) {
      t += dt;
      if (t > secs) return false;
      const env = Math.sin(Math.min(1, t / secs) * Math.PI);
      st.shake((4 + intensity * 14) * env, 0.1);
      if (st.rng.chance(dt * 4)) st.physics?.jolt(1 + intensity * 3);
      if (st.snow.total > 0) st.snow.settle(0.2 * dt);
      for (let i = 0; i < st.many(Math.ceil(50 * dt * env)); i++) {
        st.spawn({ kind: Kind.Debris, x: st.rng.range(0, st.w), y: -5, vx: st.rng.range(-20, 20), vy: st.rng.range(50, 200), life: 3, size: st.rng.range(2, 5), color: st.rng.pick([0x6b5a48, 0x857260, 0x4a3d31]), gravity: 900, spin: st.rng.range(-8, 8), alpha: 0.9, alpha1: 0.5, bounce: 0.2 });
      }
      if (st.rng.chance(dt * 3 * env)) dust(st, st.rng.range(0, st.w), st.rng.range(0, 40), 3, 0x9b8a78, 60);
      crackAt -= dt;
      if (crackAt <= 0) {
        crackAt = 0.5 / (0.5 + intensity);
        groundCrack(st, st.rng.range(st.w * 0.05, st.w * 0.95), st.floor - 2, st.rng.int(1, 1e9));
      }
      return true;
    },
  });
}

export const earthquake: EffectImpl = {
  trigger(s, t) {
    quake(s, Math.max(2, t.duration || 4), t.intensity);
  },
  down(s) {
    quake(s, 3.5, s.intensity);
  },
};

// ---------------------------------------------------------------------------------------------
// Reset bomb
// ---------------------------------------------------------------------------------------------

function bomb(s: Stage, x: number, y: number) {
  let t = 0;
  const fall = 0.6;
  const fuse = 2.4;
  let beeps = 0;
  let exploded = false;
  s.audio.play('whoosh', 0.6);
  s.add({
    update(dt, st) {
      t += dt;
      if (exploded) return false;
      const k = Math.min(1, t / fall);
      const by = -60 + (y + 60) * (1 - Math.pow(1 - k, 3)) - (k >= 1 ? Math.abs(Math.sin((t - fall) * 12)) * 6 * Math.max(0, 1 - (t - fall) * 2) : 0);
      const g = st.fx;
      const r = 30;
      g.circle(x, by, r).fill({ color: 0x141414 }).stroke({ color: 0x444444, width: 2 });
      g.circle(x - 10, by - 10, 8).fill({ color: 0xffffff, alpha: 0.18 });
      g.rect(x - 9, by - r - 8, 18, 10).fill({ color: 0x333333 });
      const fx0 = x;
      const fy0 = by - r - 8;
      const burnt = Math.max(0, (t - fall) / fuse);
      const fx1 = fx0 + 18 - burnt * 10;
      const fy1 = fy0 - 22 + burnt * 14;
      g.moveTo(fx0, fy0).quadraticCurveTo(fx0 + 4, fy0 - 18, fx1, fy1).stroke({ color: 0xc9a46b, width: 3 });
      if (t > fall) {
        sparks(st, fx1, fy1, Math.ceil(80 * dt), { speed: 160, life: 0.35, gravity: 200 });
        const remaining = fuse - (t - fall);
        const want = 3 - Math.ceil(remaining / (fuse / 3));
        while (beeps <= want && beeps < 3) {
          beeps++;
          st.audio.play('beep', 1);
          st.audio.loop('hiss', 0.5);
        }
        if (remaining <= 0) {
          exploded = true;
          st.audio.loop('hiss', 0);
          explode(st, x, by);
          return false;
        }
      }
      return true;
    },
  });
}

function explode(s: Stage, x: number, y: number) {
  s.audio.play('boom', 1);
  s.flash(0xfff1d0, 0.6);
  s.shake(16, 0.5);
  s.physics?.blast(x, y, 20, 2000);
  sparks(s, x, y, 120, { speed: 900, life: 0.8 });
  debris(s, x, y, 60, [0x222222, 0x555555, 0xff8a2a], 900);
  // Let the blast read for a moment, then wipe everything and leave only the afterglow.
  let t = 0;
  let wiped = false;
  s.add({
    update(dt, st) {
      t += dt;
      const r = t * 2600;
      st.fx.circle(x, y, r).fill({ color: 0xffb060, alpha: Math.max(0, 0.35 - t * 0.6) });
      st.eraseDecal(x, y, r);
      if (!wiped && t > 0.35) {
        wiped = true;
        st.clearNow();
        shockwave(st, x, y, Math.hypot(st.w, st.h), 0.9, 0xffc27a);
        sparks(st, x, y, 50, { speed: 700, life: 0.6 });
        return false;
      }
      return true;
    },
  });
}

export const bombFx: EffectImpl = {
  trigger(s, t) {
    bomb(s, t.x, t.y);
  },
  down(s, x, y) {
    bomb(s, x, y);
  },
};

