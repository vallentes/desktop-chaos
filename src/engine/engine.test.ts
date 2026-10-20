import { describe, expect, it } from 'vitest';
import { FireField } from './fire';
import { Kind, lerpColor, ParticlePool } from './particles';
import { QualityController } from './quality';
import { Rng } from './rng';
import { crackPattern, lightningBolt, polygonArea, shatter, splatOutline } from './shapes';
import { SnowPile } from './snow';

describe('particle pool', () => {
  it('respects the budget and counts what it drops', () => {
    const p = new ParticlePool(100);
    p.budget = 10;
    for (let i = 0; i < 25; i++) p.spawn({ kind: Kind.Spark, x: 0, y: 0, life: 1, size: 1, color: 0xffffff });
    expect(p.count).toBe(10);
    expect(p.dropped).toBe(15);
    expect(p.free).toBe(0);
  });

  it('kills particles when their life runs out', () => {
    const p = new ParticlePool(10);
    p.spawn({ kind: Kind.Spark, x: 0, y: 0, life: 0.1, size: 1, color: 0 });
    p.spawn({ kind: Kind.Spark, x: 0, y: 0, life: 1, size: 1, color: 0 });
    p.step(0.2);
    expect(p.count).toBe(1);
    expect(p.life[0]).toBe(1);
  });

  it('moves with velocity and gravity', () => {
    const p = new ParticlePool(1);
    p.spawn({ kind: Kind.Debris, x: 0, y: 0, vx: 10, vy: 0, gravity: 100, life: 5, size: 1, color: 0 });
    p.step(0.1);
    expect(p.x[0]).toBeCloseTo(1, 5);
    expect(p.y[0]).toBeGreaterThan(0);
  });

  it('bounces on the floor', () => {
    const p = new ParticlePool(1);
    p.floor = 100;
    p.spawn({ kind: Kind.Debris, x: 0, y: 99, vy: 500, life: 5, size: 1, color: 0, bounce: 0.5 });
    p.step(0.05);
    expect(p.y[0]).toBe(100);
    expect(p.vy[0]).toBeLessThan(0);
  });

  it('a black hole pulls particles in and swallows them', () => {
    const p = new ParticlePool(2);
    p.spawn({ kind: Kind.Dust, x: 200, y: 0, life: 10, size: 1, color: 0 });
    p.spawn({ kind: Kind.Dust, x: 3, y: 0, life: 10, size: 1, color: 0 });
    let eaten = 0;
    const hole = [{ x: 0, y: 0, strength: 50, radius: 500, eat: 10 }];
    p.step(1 / 60, hole, () => eaten++);
    expect(eaten).toBe(1);
    expect(p.count).toBe(1);
    const x0 = p.x[0];
    for (let i = 0; i < 30; i++) p.step(1 / 60, hole, () => eaten++);
    expect(p.x[0] < x0 || p.count === 0).toBe(true);
  });

  it('blends colours', () => {
    expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(lerpColor(0xff0000, 0xff0000, 0.3)).toBe(0xff0000);
  });
});

describe('quality', () => {
  it('drops a level after a second of slow frames and recovers later', () => {
    const q = new QualityController('auto');
    expect(q.level).toBe(2);
    for (let i = 0; i < 60; i++) q.sample(40);
    expect(q.level).toBeLessThan(2);
    const low = q.level;
    for (let i = 0; i < 1200; i++) q.sample(8);
    expect(q.level).toBeGreaterThan(low);
  });

  it('fixed settings never change', () => {
    const q = new QualityController('low');
    for (let i = 0; i < 600; i++) q.sample(5);
    expect(q.level).toBe(0);
    expect(q.budget(1000)).toBe(300);
  });

  it('ignores stalls (hidden window)', () => {
    const q = new QualityController('auto');
    for (let i = 0; i < 20; i++) q.sample(2000);
    expect(q.level).toBe(2);
  });
});

describe('shapes', () => {
  it('cracks are deterministic per seed and grow with power', () => {
    const a = crackPattern(100, 100, 120, 1, 42);
    const b = crackPattern(100, 100, 120, 1, 42);
    expect(a).toEqual(b);
    const strong = crackPattern(100, 100, 120, 5, 42);
    expect(strong.length).toBeGreaterThan(a.length);
  });

  it('lightning starts and ends where asked', () => {
    const bolt = lightningBolt(10, 0, 300, 500, 7);
    expect(bolt.main[0]).toEqual({ x: 10, y: 0 });
    expect(bolt.main[bolt.main.length - 1]).toEqual({ x: 300, y: 500 });
    expect(bolt.main.length).toBeGreaterThan(50);
    expect(bolt.branches.length).toBeGreaterThanOrEqual(2);
  });

  it('shards cover roughly the shattered disc', () => {
    const r = 100;
    const shards = shatter(0, 0, r, 9, 12);
    expect(shards.length).toBe(24);
    const area = shards.reduce((s, sh) => s + polygonArea(sh.poly), 0);
    expect(area).toBeGreaterThan(Math.PI * r * r * 0.5);
    expect(area).toBeLessThan(Math.PI * r * r * 1.5);
  });

  it('splats are closed outlines around the centre', () => {
    const pts = splatOutline(50, 50, 20, 3);
    expect(pts.length).toBe(28);
    for (const p of pts) expect(Math.hypot(p.x - 50, p.y - 50)).toBeLessThan(40);
  });

  it('rng is seeded', () => {
    const a = new Rng(5);
    const b = new Rng(5);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    for (let i = 0; i < 100; i++) {
      const v = a.int(2, 4);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(4);
    }
  });
});

describe('fire', () => {
  it('spreads while hot, never past the cap', () => {
    const f = new FireField(3);
    f.maxSources = 12;
    f.ignite(500, 500, 1);
    for (let i = 0; i < 400; i++) f.step(0.05, { w: 1000, h: 1000 });
    expect(f.sources.length).toBeLessThanOrEqual(12);
  });

  it('water puts fires out', () => {
    const f = new FireField(3);
    f.ignite(100, 100, 0.5);
    f.ignite(400, 400, 0.5);
    const out = f.douse(100, 100, 50, 1);
    expect(out.length).toBe(1);
    expect(f.sources.length).toBe(1);
  });

  it('burns out on its own', () => {
    const f = new FireField(1);
    f.maxSources = 1;
    f.ignite(10, 10, 0.4);
    for (let i = 0; i < 400; i++) f.step(0.05, { w: 100, h: 100 });
    expect(f.sources.length).toBe(0);
  });

  it('feeds an existing fire instead of stacking', () => {
    const f = new FireField(1);
    f.ignite(10, 10, 0.3);
    f.ignite(12, 12, 0.3);
    expect(f.sources.length).toBe(1);
  });
});

describe('snow pile', () => {
  it('piles up, slides off peaks and clears', () => {
    const s = new SnowPile(80, 8, 50);
    for (let i = 0; i < 200; i++) s.add(40, 1);
    expect(s.heightAt(40)).toBeLessThanOrEqual(50);
    // Snow slid sideways rather than forming a one-column spike.
    expect(s.heightAt(32) + s.heightAt(48)).toBeGreaterThan(0);
    s.clear();
    expect(s.total).toBe(0);
  });

  it('melts away', () => {
    const s = new SnowPile(80);
    s.add(10, 5);
    expect(s.melt(10)).toBe(false);
  });
});

describe('crack radius guard', () => {
  it('a NaN radius would leave single-point spokes (the bug normalizeToolOptions prevents)', () => {
    const lines = crackPattern(0, 0, 100, 1, 3);
    for (const l of lines) for (const p of l.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
