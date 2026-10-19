// Procedural geometry: glass cracks, lightning bolts, glass shards, paint splats.
// Pure functions of a seed so tests can pin them and OBS can redraw the same picture.

import { Rng } from './rng';

export interface Pt {
  x: number;
  y: number;
}

export interface Polyline {
  points: Pt[];
  width: number;
}

/** Radial cracks plus concentric "spider web" rings. `power` grows with repeated hits. */
export function crackPattern(cx: number, cy: number, radius: number, power: number, seed: number): Polyline[] {
  const r = new Rng(seed);
  const lines: Polyline[] = [];
  const spokes = Math.round(6 + power * 4 + r.range(0, 4));
  const angles: number[] = [];
  for (let i = 0; i < spokes; i++) angles.push(((i + r.range(-0.35, 0.35)) / spokes) * Math.PI * 2);

  const spokePts: Pt[][] = [];
  for (const a0 of angles) {
    const len = radius * r.range(0.55, 1.15);
    const pts: Pt[] = [{ x: cx, y: cy }];
    let a = a0;
    let d = 0;
    while (d < len) {
      d += r.range(radius * 0.06, radius * 0.16);
      a += r.range(-0.22, 0.22);
      pts.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d });
    }
    spokePts.push(pts);
    lines.push({ points: pts, width: r.range(1, 2.2) });
    // Side branches.
    const branches = r.int(0, Math.round(1 + power));
    for (let b = 0; b < branches; b++) {
      const from = pts[r.int(1, pts.length - 1)];
      let ba = a0 + r.pick([-1, 1]) * r.range(0.4, 0.9);
      const bl = len * r.range(0.15, 0.4);
      const bp: Pt[] = [from];
      let bd = 0;
      let p = from;
      while (bd < bl) {
        bd += r.range(6, 18);
        ba += r.range(-0.3, 0.3);
        p = { x: p.x + Math.cos(ba) * 12, y: p.y + Math.sin(ba) * 12 };
        bp.push(p);
      }
      lines.push({ points: bp, width: r.range(0.6, 1.2) });
    }
  }

  // Rings: connect neighbouring spokes at a few distances.
  const rings = Math.round(1 + power * 1.5);
  for (let k = 1; k <= rings; k++) {
    const frac = k / (rings + 1);
    for (let i = 0; i < spokePts.length; i++) {
      if (r.chance(0.25)) continue;
      const a = spokePts[i];
      const b = spokePts[(i + 1) % spokePts.length];
      const pa = a[Math.min(a.length - 1, Math.max(1, Math.round(frac * (a.length - 1))))];
      const pb = b[Math.min(b.length - 1, Math.max(1, Math.round(frac * (b.length - 1))))];
      const mid = { x: (pa.x + pb.x) / 2 + r.range(-4, 4), y: (pa.y + pb.y) / 2 + r.range(-4, 4) };
      lines.push({ points: [pa, mid, pb], width: r.range(0.5, 1.1) });
    }
  }
  return lines;
}

export interface Bolt {
  main: Pt[];
  branches: Pt[][];
}

/** Midpoint displacement lightning from (x0,y0) to (x1,y1) with forks. */
export function lightningBolt(x0: number, y0: number, x1: number, y1: number, seed: number, detail = 7, forks = true): Bolt {
  const r = new Rng(seed);
  const len = Math.hypot(x1 - x0, y1 - y0);
  let pts: Pt[] = [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ];
  let offset = len * 0.18;
  for (let g = 0; g < detail; g++) {
    const next: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y);
      const ny = b.x - a.x;
      const nl = Math.hypot(nx, ny) || 1;
      const o = r.range(-offset, offset);
      next.push({ x: mx + (nx / nl) * o, y: my + (ny / nl) * o }, b);
    }
    pts = next;
    offset *= 0.55;
  }
  const branches: Pt[][] = [];
  const count = forks ? r.int(2, 5) : 0;
  for (let k = 0; k < count; k++) {
    const startIdx = r.int(Math.floor(pts.length * 0.15), Math.floor(pts.length * 0.75));
    const s = pts[startIdx];
    const dir = Math.atan2(y1 - y0, x1 - x0) + r.pick([-1, 1]) * r.range(0.3, 0.8);
    const bl = len * r.range(0.12, 0.3);
    const sub = lightningBolt(s.x, s.y, s.x + Math.cos(dir) * bl, s.y + Math.sin(dir) * bl, r.int(1, 1e9), Math.max(3, detail - 3), false);
    branches.push(sub.main);
  }
  return { main: pts, branches };
}

/** Shatters a disc into wedge-shaped shards. Each shard polygon is relative to its own centroid. */
export function shatter(cx: number, cy: number, radius: number, seed: number, pieces = 14): { cx: number; cy: number; poly: Pt[] }[] {
  const r = new Rng(seed);
  const ringCount = 2;
  const angles: number[] = [];
  for (let i = 0; i < pieces; i++) angles.push(((i + r.range(-0.3, 0.3)) / pieces) * Math.PI * 2);
  angles.sort((a, b) => a - b);
  const radii = [0, radius * r.range(0.35, 0.55), radius];
  const out: { cx: number; cy: number; poly: Pt[] }[] = [];
  for (let ring = 0; ring < ringCount; ring++) {
    for (let i = 0; i < angles.length; i++) {
      const a0 = angles[i];
      const a1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
      const rin = radii[ring] * (ring === 0 ? 0 : r.range(0.9, 1.1));
      const rout = radii[ring + 1] * r.range(0.85, 1.1);
      const pts: Pt[] =
        ring === 0
          ? [
              { x: cx, y: cy },
              { x: cx + Math.cos(a0) * rout, y: cy + Math.sin(a0) * rout },
              { x: cx + Math.cos((a0 + a1) / 2) * rout * r.range(0.9, 1.05), y: cy + Math.sin((a0 + a1) / 2) * rout * r.range(0.9, 1.05) },
              { x: cx + Math.cos(a1) * rout, y: cy + Math.sin(a1) * rout },
            ]
          : [
              { x: cx + Math.cos(a0) * rin, y: cy + Math.sin(a0) * rin },
              { x: cx + Math.cos(a0) * rout, y: cy + Math.sin(a0) * rout },
              { x: cx + Math.cos(a1) * rout, y: cy + Math.sin(a1) * rout },
              { x: cx + Math.cos(a1) * rin, y: cy + Math.sin(a1) * rin },
            ];
      const c = centroid(pts);
      out.push({ cx: c.x, cy: c.y, poly: pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y })) });
    }
  }
  return out;
}

export function centroid(pts: Pt[]): Pt {
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    x += (p.x + q.x) * c;
    y += (p.y + q.y) * c;
  }
  if (Math.abs(a) < 1e-9) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }
  a *= 0.5;
  return { x: x / (6 * a), y: y / (6 * a) };
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Blobby splat outline: a wobbly circle with a few spikes. */
export function splatOutline(cx: number, cy: number, radius: number, seed: number): Pt[] {
  const r = new Rng(seed);
  const n = 28;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let rr = radius * r.range(0.78, 1.08);
    if (r.chance(0.18)) rr *= r.range(1.3, 1.8);
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pts;
}
