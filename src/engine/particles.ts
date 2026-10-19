// Struct-of-arrays particle pool. No allocation per particle, swap-remove on death, and a hard
// budget so a black hole full of sparks can't take the machine down.

export const enum Kind {
  Spark = 0,
  Fire = 1,
  Smoke = 2,
  Water = 3,
  Snow = 4,
  Paint = 5,
  Debris = 6,
  Dust = 7,
  Glint = 8,
  Ember = 9,
  Steam = 10,
  Bolt = 11,
}

export const KIND_COUNT = 12;

/** Additive kinds glow (fire, sparks); the rest blend normally. */
export const ADDITIVE = new Set<number>([Kind.Spark, Kind.Fire, Kind.Ember, Kind.Glint, Kind.Bolt]);

export interface SpawnSpec {
  kind: Kind;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  life: number;
  size: number;
  size1?: number;
  color: number;
  color1?: number;
  alpha?: number;
  alpha1?: number;
  gravity?: number;
  drag?: number;
  rot?: number;
  spin?: number;
  /** Particles with a floor collide with it and bounce/settle. */
  bounce?: number;
}

export interface Force {
  x: number;
  y: number;
  strength: number;
  radius: number;
  /** Particles closer than this are swallowed. */
  eat: number;
}

export class ParticlePool {
  readonly cap: number;
  count = 0;
  budget: number;
  floor = Infinity;
  dropped = 0;

  readonly kind: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  readonly color0: Uint32Array;
  readonly color1: Uint32Array;
  readonly alpha0: Float32Array;
  readonly alpha1: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  readonly bounce: Float32Array;

  constructor(cap: number) {
    this.cap = cap;
    this.budget = cap;
    this.kind = new Uint8Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.size0 = new Float32Array(cap);
    this.size1 = new Float32Array(cap);
    this.color0 = new Uint32Array(cap);
    this.color1 = new Uint32Array(cap);
    this.alpha0 = new Float32Array(cap);
    this.alpha1 = new Float32Array(cap);
    this.gravity = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    this.bounce = new Float32Array(cap);
  }

  /** Free slots under the current budget. Effects scale their spawn counts with this. */
  get free(): number {
    return Math.max(0, Math.min(this.budget, this.cap) - this.count);
  }

  spawn(s: SpawnSpec): number {
    if (this.count >= Math.min(this.budget, this.cap)) {
      this.dropped++;
      return -1;
    }
    const i = this.count++;
    this.kind[i] = s.kind;
    this.x[i] = s.x;
    this.y[i] = s.y;
    this.vx[i] = s.vx ?? 0;
    this.vy[i] = s.vy ?? 0;
    this.age[i] = 0;
    this.life[i] = Math.max(0.01, s.life);
    this.size0[i] = s.size;
    this.size1[i] = s.size1 ?? s.size;
    this.color0[i] = s.color;
    this.color1[i] = s.color1 ?? s.color;
    this.alpha0[i] = s.alpha ?? 1;
    this.alpha1[i] = s.alpha1 ?? 0;
    this.gravity[i] = s.gravity ?? 0;
    this.drag[i] = s.drag ?? 0;
    this.rot[i] = s.rot ?? 0;
    this.spin[i] = s.spin ?? 0;
    this.bounce[i] = s.bounce ?? -1;
    return i;
  }

  kill(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.kind[i] = this.kind[last];
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size0[i] = this.size0[last];
    this.size1[i] = this.size1[last];
    this.color0[i] = this.color0[last];
    this.color1[i] = this.color1[last];
    this.alpha0[i] = this.alpha0[last];
    this.alpha1[i] = this.alpha1[last];
    this.gravity[i] = this.gravity[last];
    this.drag[i] = this.drag[last];
    this.rot[i] = this.rot[last];
    this.spin[i] = this.spin[last];
    this.bounce[i] = this.bounce[last];
  }

  clear() {
    this.count = 0;
  }

  /** Advances every particle. `onEaten` sees each particle a force swallows before it dies. */
  step(dt: number, forces: readonly Force[] = [], onEaten?: (i: number) => void) {
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      let vx = this.vx[i];
      let vy = this.vy[i] + this.gravity[i] * dt;
      let eaten = false;
      for (const f of forces) {
        const dx = f.x - this.x[i];
        const dy = f.y - this.y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < f.eat * f.eat) {
          eaten = true;
          break;
        }
        if (d2 < f.radius * f.radius) {
          const d = Math.sqrt(d2) || 1;
          const a = (f.strength * (1 - d / f.radius)) / Math.max(d, 20);
          // Pull in plus a swirl so things spiral rather than drop straight in.
          vx += (dx * a - dy * a * 0.6) * dt * 60;
          vy += (dy * a + dx * a * 0.6) * dt * 60;
        }
      }
      if (eaten) {
        onEaten?.(i);
        this.kill(i);
        continue;
      }
      const drag = this.drag[i];
      if (drag > 0) {
        const k = Math.max(0, 1 - drag * dt);
        vx *= k;
        vy *= k;
      }
      let y = this.y[i] + vy * dt;
      if (this.bounce[i] >= 0 && y > this.floor) {
        y = this.floor;
        vy = -vy * this.bounce[i];
        vx *= 0.7;
        if (Math.abs(vy) < 20) vy = 0;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.x[i] += vx * dt;
      this.y[i] = y;
      this.rot[i] += this.spin[i] * dt;
    }
  }

  /** 0..1 life progress. */
  t(i: number): number {
    return this.age[i] / this.life[i];
  }
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function lerpColor(a: number, b: number, t: number): number {
  if (a === b) return a;
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return (r << 16) | (g << 8) | bl;
}
