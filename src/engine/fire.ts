// Fire that spreads and water that puts it out. Pure state, no drawing.

import { Rng } from './rng';

export interface FireSource {
  id: number;
  x: number;
  y: number;
  /** 0..1, grows while burning, drops when hit by water. */
  heat: number;
  age: number;
  /** Burn mark already left at this spot. */
  scorched: boolean;
}

export interface FireEvents {
  spread: FireSource[];
  died: FireSource[];
  extinguished: FireSource[];
}

export class FireField {
  sources: FireSource[] = [];
  maxSources = 40;
  spreadRadius = 70;
  private nextId = 1;
  private rng: Rng;

  constructor(seed = 1) {
    this.rng = new Rng(seed);
  }

  ignite(x: number, y: number, heat = 0.6): FireSource | null {
    // Feed an existing fire instead of stacking a new one on the same spot.
    for (const s of this.sources) {
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < 24 * 24) {
        s.heat = Math.min(1, s.heat + heat * 0.5);
        return s;
      }
    }
    if (this.sources.length >= this.maxSources) return null;
    const s: FireSource = { id: this.nextId++, x, y, heat: Math.min(1, heat), age: 0, scorched: false };
    this.sources.push(s);
    return s;
  }

  /** Water hitting (x,y) cools every fire within `radius`. */
  douse(x: number, y: number, radius: number, amount: number): FireSource[] {
    const out: FireSource[] = [];
    for (const s of this.sources) {
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < radius * radius) {
        s.heat -= amount;
        if (s.heat <= 0) out.push(s);
      }
    }
    if (out.length) this.sources = this.sources.filter((s) => s.heat > 0);
    return out;
  }

  /** Advance. Hot fires spread to neighbours; old fires burn out. */
  step(dt: number, bounds: { w: number; h: number }): FireEvents {
    const ev: FireEvents = { spread: [], died: [], extinguished: [] };
    for (const s of this.sources) {
      s.age += dt;
      // Heat rises for a few seconds, then the fuel runs out.
      s.heat += (s.age < 4 ? 0.12 : -0.06) * dt;
      if (s.heat > 0.55 && this.sources.length + ev.spread.length < this.maxSources && this.rng.chance(0.35 * dt * s.heat)) {
        const a = this.rng.range(-Math.PI, Math.PI);
        // Fire climbs more readily than it falls.
        const up = Math.sin(a) < 0 ? 1 : 0.5;
        const d = this.spreadRadius * this.rng.range(0.5, 1) * up;
        const nx = Math.min(bounds.w - 4, Math.max(4, s.x + Math.cos(a) * d));
        const ny = Math.min(bounds.h - 4, Math.max(4, s.y + Math.sin(a) * d));
        if (!this.sources.some((o) => (o.x - nx) ** 2 + (o.y - ny) ** 2 < 30 * 30)) {
          ev.spread.push({ id: this.nextId++, x: nx, y: ny, heat: 0.35, age: 0, scorched: false });
        }
      }
    }
    this.sources.push(...ev.spread);
    const keep: FireSource[] = [];
    for (const s of this.sources) {
      if (s.heat <= 0 || s.age > 14) ev.died.push(s);
      else keep.push(s);
    }
    this.sources = keep;
    return ev;
  }

  clear() {
    this.sources = [];
  }
}
