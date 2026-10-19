// Rigid bodies (falling objects, glass shards) on Rapier 2D. Loaded on first use, so an overlay
// that only ever shows bullet holes never pays for the physics engine.

import type RAPIER_NS from '@dimforge/rapier2d-compat';
import type { Pt } from './shapes';

type Rapier = typeof RAPIER_NS;

/** Pixels per physics metre. */
export const PPM = 60;

export interface BodyHandle<T = unknown> {
  id: number;
  body: RAPIER_NS.RigidBody;
  data: T;
  born: number;
  /** Seconds after which the body fades out and is removed (0 = keep). */
  ttl: number;
}

let rapierPromise: Promise<Rapier> | null = null;

export function loadRapier(): Promise<Rapier> {
  rapierPromise ??= import('@dimforge/rapier2d-compat').then(async (m) => {
    const R = (m.default ?? m) as Rapier;
    await R.init();
    return R;
  });
  return rapierPromise;
}

export class Physics<T = unknown> {
  readonly world: RAPIER_NS.World;
  private bounds: RAPIER_NS.RigidBody;
  bodies: BodyHandle<T>[] = [];
  maxBodies = 160;
  time = 0;
  private nextId = 1;

  constructor(
    readonly R: Rapier,
    public width: number,
    public floorY: number,
  ) {
    this.world = new R.World({ x: 0, y: 9.81 * 1.6 });
    this.bounds = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.buildBounds();
  }

  private buildBounds() {
    const R = this.R;
    const w = this.width / PPM;
    const f = this.floorY / PPM;
    // Floor plus two tall walls so piles stay on screen.
    this.world.createCollider(R.ColliderDesc.cuboid(w, 0.5).setTranslation(w / 2, f + 0.5).setFriction(0.8), this.bounds);
    this.world.createCollider(R.ColliderDesc.cuboid(0.5, 60).setTranslation(-0.5, f - 30), this.bounds);
    this.world.createCollider(R.ColliderDesc.cuboid(0.5, 60).setTranslation(w + 0.5, f - 30), this.bounds);
  }

  private admit() {
    // Over budget: the oldest body goes first.
    while (this.bodies.length >= this.maxBodies) {
      const old = this.bodies.shift();
      if (old) this.world.removeRigidBody(old.body);
    }
  }

  private add(desc: RAPIER_NS.RigidBodyDesc, col: RAPIER_NS.ColliderDesc, data: T, ttl: number): BodyHandle<T> {
    this.admit();
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(col, body);
    const h: BodyHandle<T> = { id: this.nextId++, body, data, born: this.time, ttl };
    this.bodies.push(h);
    return h;
  }

  addBox(x: number, y: number, w: number, h: number, angle: number, vx: number, vy: number, spin: number, data: T, opts: { restitution?: number; density?: number; ttl?: number } = {}) {
    const R = this.R;
    return this.add(
      R.RigidBodyDesc.dynamic().setTranslation(x / PPM, y / PPM).setRotation(angle).setLinvel(vx / PPM, vy / PPM).setAngvel(spin).setCcdEnabled(true),
      R.ColliderDesc.cuboid(w / 2 / PPM, h / 2 / PPM).setRestitution(opts.restitution ?? 0.25).setFriction(0.7).setDensity(opts.density ?? 1),
      data,
      opts.ttl ?? 0,
    );
  }

  addBall(x: number, y: number, r: number, vx: number, vy: number, data: T, opts: { restitution?: number; ttl?: number } = {}) {
    const R = this.R;
    return this.add(
      R.RigidBodyDesc.dynamic().setTranslation(x / PPM, y / PPM).setLinvel(vx / PPM, vy / PPM).setCcdEnabled(true),
      R.ColliderDesc.ball(r / PPM).setRestitution(opts.restitution ?? 0.6).setFriction(0.5),
      data,
      opts.ttl ?? 0,
    );
  }

  /** Convex polygon relative to (x, y). Falls back to a box when the hull is degenerate. */
  addPolygon(x: number, y: number, poly: Pt[], vx: number, vy: number, spin: number, data: T, opts: { ttl?: number } = {}) {
    const R = this.R;
    const flat = new Float32Array(poly.length * 2);
    poly.forEach((p, i) => {
      flat[i * 2] = p.x / PPM;
      flat[i * 2 + 1] = p.y / PPM;
    });
    const col = R.ColliderDesc.convexHull(flat) ?? R.ColliderDesc.cuboid(0.1, 0.1);
    col.setRestitution(0.15).setFriction(0.6).setDensity(0.6);
    return this.add(R.RigidBodyDesc.dynamic().setTranslation(x / PPM, y / PPM).setLinvel(vx / PPM, vy / PPM).setAngvel(spin).setCcdEnabled(true), col, data, opts.ttl ?? 0);
  }

  /** Black hole pull and swallow. Returns bodies that fell in. */
  pull(x: number, y: number, strength: number, radius: number, eat: number): BodyHandle<T>[] {
    const eaten: BodyHandle<T>[] = [];
    for (const h of this.bodies) {
      const t = h.body.translation();
      const dx = x / PPM - t.x;
      const dy = y / PPM - t.y;
      const d = Math.hypot(dx, dy);
      if (d * PPM < eat) {
        eaten.push(h);
      } else if (d * PPM < radius) {
        const k = (strength * (1 - (d * PPM) / radius)) / Math.max(d, 0.3);
        h.body.applyImpulse({ x: dx * k * h.body.mass() * 0.02 - dy * k * 0.01 * h.body.mass(), y: dy * k * h.body.mass() * 0.02 + dx * k * 0.01 * h.body.mass() }, true);
      }
    }
    for (const h of eaten) this.remove(h);
    return eaten;
  }

  /** Radial push from an explosion. */
  blast(x: number, y: number, power: number, radius: number) {
    for (const h of this.bodies) {
      const t = h.body.translation();
      const dx = t.x - x / PPM;
      const dy = t.y - y / PPM;
      const d = Math.hypot(dx, dy) * PPM;
      if (d < radius) {
        const k = (power * (1 - d / radius)) / Math.max(1, d / PPM);
        h.body.applyImpulse({ x: dx * k * h.body.mass(), y: (dy - 0.5) * k * h.body.mass() }, true);
        h.body.applyTorqueImpulse((Math.random() - 0.5) * power * 0.05 * h.body.mass(), true);
      }
    }
  }

  /** Kicks everything a little (earthquake). */
  jolt(amount: number) {
    for (const h of this.bodies) {
      h.body.applyImpulse({ x: (Math.random() - 0.5) * amount * h.body.mass(), y: -Math.random() * amount * h.body.mass() }, true);
    }
  }

  remove(h: BodyHandle<T>) {
    const i = this.bodies.indexOf(h);
    if (i >= 0) this.bodies.splice(i, 1);
    this.world.removeRigidBody(h.body);
  }

  /** Steps the world; returns bodies whose ttl ran out. */
  step(dt: number): BodyHandle<T>[] {
    this.time += dt;
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
    const expired: BodyHandle<T>[] = [];
    for (const h of this.bodies) {
      const t = h.body.translation();
      if (t.y * PPM > this.floorY + 400 || (h.ttl > 0 && this.time - h.born > h.ttl)) expired.push(h);
    }
    return expired;
  }

  get allAsleep(): boolean {
    return this.bodies.every((h) => h.body.isSleeping());
  }

  clear() {
    for (const h of this.bodies) this.world.removeRigidBody(h.body);
    this.bodies = [];
  }

  resize(width: number, floorY: number) {
    if (width === this.width && floorY === this.floorY) return;
    this.width = width;
    this.floorY = floorY;
    this.world.removeRigidBody(this.bounds);
    this.bounds = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
    this.buildBounds();
  }
}
