// One Pixi scene per overlay window (or per OBS browser source). Owns the particle pool, the
// persistent decal layer, rigid bodies, fire and snow, and runs the frame loop only while
// something is moving: when everything is still, no frames are drawn at all.

import { Application, Container, Graphics, Particle, ParticleContainer, RenderTexture, Sprite, Texture, Rectangle } from 'pixi.js';
import { Synth } from '../engine/audio';
import { FireField } from '../engine/fire';
import { ADDITIVE, Force, Kind, KIND_COUNT, lerp, lerpColor, ParticlePool, SpawnSpec } from '../engine/particles';
import { loadRapier, Physics, PPM, BodyHandle } from '../engine/physics';
import { QualityController } from '../engine/quality';
import { Rng } from '../engine/rng';
import { SnowPile } from '../engine/snow';
import { DEFAULT_TOOL_OPTIONS, normalizeToolOptions, ToolOptions } from '../shared/effects';
import type { OverlayConfig } from '../shared/types';

export interface Entity {
  /** Return false when finished. */
  update(dt: number, s: Stage): boolean;
  destroy?(s: Stage): void;
}

export interface BodyData {
  g: Graphics;
  kind: 'box' | 'ball' | 'brick' | 'shard' | 'icon';
}

const POOL_CAP = 6000;

export class Stage {
  app = new Application();
  w = 0;
  h = 0;
  floor = 0;
  resolution = 1;
  rng = new Rng((Math.random() * 1e9) >>> 0);
  particles = new ParticlePool(POOL_CAP);
  quality = new QualityController('auto');
  audio = new Synth();
  fire = new FireField(7);
  snow!: SnowPile;
  options: ToolOptions = { ...DEFAULT_TOOL_OPTIONS };
  intensity = 0.8;
  reducedFlashing = false;
  baseBudget = 3000;
  entities: Entity[] = [];
  forces: Force[] = [];
  physics: Physics<BodyData> | null = null;
  private physicsLoading: Promise<Physics<BodyData>> | null = null;

  root = new Container(); // everything that shakes
  private decalRT!: RenderTexture;
  private decalSprite!: Sprite;
  private hasDecals = false;
  private decalFade = 0;
  bodyLayer = new Container();
  private snowGfx = new Graphics();
  fx = new Graphics(); // redrawn every frame by entities
  private partNormal!: ParticleContainer;
  private partAdd!: ParticleContainer;
  private poolNormal: Particle[] = [];
  private poolAdd: Particle[] = [];
  private textures: Texture[] = [];
  private flashGfx = new Graphics();
  private flashAlpha = 0;
  private flashColor = 0xffffff;
  private shakeAmp = 0;
  private shakeTime = 0;

  private running = false;
  private last = 0;
  /** True while a tool is armed and the user may move the mouse (keeps the loop alive). */
  interactive = false;
  /** Called when the loop goes to sleep; `empty` means nothing at all is on screen. */
  onIdle: (empty: boolean) => void = () => {};
  /** Set by the frame loop: per-frame hook for the armed tool (hold-to-fire). */
  onFrame: ((dt: number) => void) | null = null;
  onError: (e: unknown) => void = (e) => console.error(e);

  /** `keepFrames` keeps the last frame readable (README capture only). */
  async init(host: HTMLElement, floorFromBottom = 0, keepFrames = false) {
    this.resolution = Math.min(window.devicePixelRatio || 1, 2);
    await this.app.init({
      backgroundAlpha: 0,
      antialias: true,
      resizeTo: window,
      autoDensity: true,
      resolution: this.resolution,
      autoStart: false,
      preference: 'webgl',
      powerPreference: 'low-power',
      preserveDrawingBuffer: keepFrames,
    });
    this.app.ticker.stop();
    host.appendChild(this.app.canvas);
    this.measure(floorFromBottom);

    this.textures = makeTextures();
    const dyn = { position: true, rotation: true, vertex: true, color: true, uvs: true };
    this.partNormal = new ParticleContainer({ dynamicProperties: dyn });
    this.partAdd = new ParticleContainer({ dynamicProperties: dyn });
    this.partAdd.blendMode = 'add';
    this.decalRT = RenderTexture.create({ width: this.w, height: this.h, resolution: this.resolution });
    this.decalSprite = new Sprite(this.decalRT);
    this.root.addChild(this.decalSprite, this.snowGfx, this.bodyLayer, this.partNormal, this.fx, this.partAdd);
    this.app.stage.addChild(this.root, this.flashGfx);
    this.snow = new SnowPile(this.w);
    this.particles.floor = this.floor;

    window.addEventListener('resize', () => this.onResize(floorFromBottom));
  }

  private measure(floorFromBottom: number) {
    this.w = Math.max(1, window.innerWidth);
    this.h = Math.max(1, window.innerHeight);
    this.floor = this.h - floorFromBottom;
  }

  private onResize(floorFromBottom: number) {
    this.measure(floorFromBottom);
    this.particles.floor = this.floor;
    // A fresh texture for the new size (resizing in place leaves the sprite at the old size).
    // Overlay windows are created small and then sized to their monitor, so this always runs once.
    const old = this.decalRT;
    this.decalRT = RenderTexture.create({ width: this.w, height: this.h, resolution: this.resolution });
    this.decalSprite.texture = this.decalRT;
    old.destroy(true);
    this.hasDecals = false;
    this.snow = new SnowPile(this.w);
    this.physics?.resize(this.w, this.floor);
    this.app.render();
  }

  setFloor(fromBottom: number) {
    this.floor = this.h - fromBottom;
    this.particles.floor = this.floor;
    this.physics?.resize(this.w, this.floor);
  }

  configure(c: OverlayConfig) {
    this.audio.setEnabled(c.sound);
    this.audio.setVolume(c.volume);
    this.reducedFlashing = c.reducedFlashing;
    this.quality.configure(c.quality);
    this.baseBudget = c.particleBudget;
    this.particles.budget = this.quality.budget(this.baseBudget);
    this.intensity = c.intensity;
    this.options = normalizeToolOptions(c.toolOptions);
  }

  /** Scales a spawn count by quality and free budget. */
  many(n: number): number {
    const scaled = Math.round(n * this.quality.spawnScale);
    return Math.max(0, Math.min(scaled, this.particles.free));
  }

  spawn(s: SpawnSpec) {
    return this.particles.spawn(s);
  }

  add(e: Entity) {
    this.entities.push(e);
    this.wake();
  }

  /** Bakes a Graphics into the persistent decal layer, then frees it. */
  decal(g: Container) {
    this.app.renderer.render({ container: g, target: this.decalRT, clear: false });
    g.destroy({ children: true });
    this.hasDecals = true;
    this.decalFade = 0;
    this.decalSprite.alpha = 1;
    this.wake();
  }

  /** Rubs out decals in a circle (black hole, bomb). */
  eraseDecal(x: number, y: number, r: number) {
    if (!this.hasDecals) return;
    const g = new Graphics().circle(x, y, r).fill(0xffffff);
    g.blendMode = 'erase';
    // The blend mode only applies below the root of a render, so wrap it (otherwise it paints white).
    const wrap = new Container();
    wrap.addChild(g);
    this.app.renderer.render({ container: wrap, target: this.decalRT, clear: false });
    wrap.destroy({ children: true });
  }

  async getPhysics(): Promise<Physics<BodyData>> {
    if (this.physics) return this.physics;
    this.physicsLoading ??= loadRapier().then((R) => {
      this.physics = new Physics<BodyData>(R, this.w, this.floor);
      this.physics.maxBodies = Math.round(60 + 100 * (this.quality.level / 2));
      return this.physics;
    });
    return this.physicsLoading;
  }

  addBody(h: BodyHandle<BodyData>) {
    this.bodyLayer.addChild(h.data.g);
    this.syncBody(h);
    this.wake();
  }

  removeBody(h: BodyHandle<BodyData>) {
    this.physics?.remove(h);
    h.data.g.destroy();
  }

  private syncBody(h: BodyHandle<BodyData>) {
    const t = h.body.translation();
    h.data.g.position.set(t.x * PPM, t.y * PPM);
    h.data.g.rotation = h.body.rotation();
  }

  shake(amount: number, secs: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeTime = Math.max(this.shakeTime, secs);
    this.wake();
  }

  /** Screen flash. Reduced flashing turns it into a faint, slow glow. */
  flash(color: number, alpha: number) {
    const a = this.reducedFlashing ? Math.min(alpha, 0.08) : alpha;
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, a);
    this.wake();
  }

  clear(mode: 'instant' | 'fade') {
    if (mode === 'fade' && (this.hasDecals || this.entities.length || this.particles.count || this.physics?.bodies.length)) {
      this.decalFade = 0.0001;
      this.wake();
      return;
    }
    this.clearNow();
  }

  private generation = 0;
  /** Effects with their own memory (hammer hit counts) register a reset here. */
  onClear: (() => void)[] = [];

  clearNow() {
    this.generation++;
    for (const f of this.onClear) f();
    for (const e of this.entities) e.destroy?.(this);
    this.entities = [];
    this.forces = [];
    this.particles.clear();
    this.fire.clear();
    this.snow.clear();
    if (this.physics) {
      for (const h of this.physics.bodies) h.data.g.destroy();
      this.physics.clear();
    }
    this.app.renderer.render({ container: new Container(), target: this.decalRT, clear: true });
    this.hasDecals = false;
    this.decalFade = 0;
    this.decalSprite.alpha = 1;
    this.root.alpha = 1;
    this.shakeAmp = this.shakeTime = 0;
    this.flashAlpha = 0;
    this.audio.stopAll();
    this.snowGfx.clear();
    this.fx.clear();
    this.flashGfx.clear();
    this.root.position.set(0, 0);
    this.syncParticles();
    this.app.render();
    this.wake();
  }

  get empty(): boolean {
    return !this.hasDecals && !this.entities.length && !this.particles.count && !(this.physics?.bodies.length ?? 0) && this.snow.total === 0 && !this.fire.sources.length;
  }

  get busy(): boolean {
    return (
      this.interactive ||
      this.entities.length > 0 ||
      this.particles.count > 0 ||
      this.fire.sources.length > 0 ||
      this.shakeTime > 0 ||
      this.flashAlpha > 0.003 ||
      this.decalFade > 0 ||
      (this.physics !== null && this.physics.bodies.length > 0 && !this.physics.allAsleep)
    );
  }

  wake() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    const ms = now - this.last;
    this.last = now;
    const dt = Math.min(0.05, ms / 1000);
    if (this.quality.sample(ms)) {
      this.particles.budget = this.quality.budget(this.baseBudget);
      if (this.physics) this.physics.maxBodies = Math.round(60 + 100 * (this.quality.level / 2));
    }
    try {
      this.update(dt);
    } catch (e) {
      // One broken effect must never freeze the overlay: drop the moving parts and carry on.
      this.onError(e);
      this.entities = [];
      this.forces = [];
    }
    this.app.render();
    if (this.busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      // One more clean frame so nothing transient is left drawn.
      this.fx.clear();
      this.app.render();
      this.onIdle(this.empty);
    }
  };

  private update(dt: number) {
    this.forces = [];
    this.fx.clear();
    this.onFrame?.(dt);
    // Entities first: they register forces (black holes) and draw into fx.
    const list = this.entities;
    const gen = this.generation;
    this.entities = []; // anything spawned during this pass lands here
    const keep: Entity[] = [];
    for (const e of list) {
      if (this.generation !== gen) break;
      if (e.update(dt, this)) keep.push(e);
      else e.destroy?.(this);
    }
    if (this.generation !== gen) {
      // A reset bomb went off mid-pass: everything that existed before it is gone.
      for (const e of list) e.destroy?.(this);
    } else {
      this.entities = keep.concat(this.entities);
    }

    this.updateFire(dt);
    this.particles.step(dt, this.forces);
    this.updateSnow(dt);
    this.updatePhysics(dt);
    this.updateShakeFlash(dt);
    this.updateDecalFade(dt);
    this.syncParticles();
  }

  private updateFire(dt: number) {
    if (!this.fire.sources.length) {
      this.audio.loop('fire', 0);
      return;
    }
    const ev = this.fire.step(dt, { w: this.w, h: this.h });
    let heat = 0;
    for (const s of this.fire.sources) {
      heat += s.heat;
      const n = this.many(Math.ceil(3 * s.heat * 60 * dt));
      for (let i = 0; i < n; i++) {
        this.spawn({
          kind: Kind.Fire,
          x: s.x + this.rng.range(-14, 14) * s.heat,
          y: s.y + this.rng.range(-4, 6),
          vx: this.rng.range(-20, 20),
          vy: this.rng.range(-140, -60) * (0.6 + s.heat),
          life: this.rng.range(0.4, 0.9),
          size: this.rng.range(14, 26) * (0.6 + s.heat),
          size1: 4,
          color: 0xfff1a8,
          color1: 0xff3b0a,
          alpha: 0.9,
          alpha1: 0,
          drag: 1.2,
        });
      }
      if (this.rng.chance(dt * 6 * s.heat) && this.particles.free > 10) {
        this.spawn({ kind: Kind.Smoke, x: s.x + this.rng.range(-10, 10), y: s.y - 30, vx: this.rng.range(-15, 15), vy: this.rng.range(-70, -40), life: this.rng.range(1.6, 2.8), size: 18, size1: 60, color: 0x3a3330, color1: 0x1a1a1a, alpha: 0.35, alpha1: 0, drag: 0.4 });
      }
      if (this.rng.chance(dt * 4 * s.heat) && this.particles.free > 10) {
        this.spawn({ kind: Kind.Ember, x: s.x, y: s.y - 10, vx: this.rng.range(-60, 60), vy: this.rng.range(-220, -120), life: this.rng.range(0.6, 1.4), size: 3, size1: 1, color: 0xffd36b, color1: 0xff5a1a, gravity: 120, drag: 0.5, alpha: 1, alpha1: 0 });
      }
      if (!s.scorched && s.age > 1.2) {
        s.scorched = true;
        this.decal(burnMark(s.x, s.y, 26 + s.heat * 30, this.rng));
      }
    }
    for (const s of ev.died) {
      for (let i = 0; i < this.many(6); i++) {
        this.spawn({ kind: Kind.Smoke, x: s.x, y: s.y - 10, vx: this.rng.range(-20, 20), vy: this.rng.range(-60, -30), life: 2, size: 14, size1: 50, color: 0x444040, alpha: 0.3, alpha1: 0, drag: 0.5 });
      }
    }
    this.audio.loop('fire', Math.min(1, heat / 6));
  }

  private snowDrawAt = 0;
  private updateSnow(dt: number) {
    if (!this.snow.dirty) return;
    this.snowDrawAt -= dt;
    if (this.snowDrawAt > 0) return;
    this.snowDrawAt = 0.1;
    this.snow.dirty = false;
    const g = this.snowGfx;
    g.clear();
    if (this.snow.total <= 0) return;
    const c = this.snow.cols;
    const cw = this.snow.colWidth;
    g.moveTo(0, this.floor);
    for (let i = 0; i < c.length; i++) g.lineTo(i * cw, this.floor - c[i]);
    g.lineTo(this.w, this.floor).closePath().fill({ color: 0xf4f8ff, alpha: 0.95 });
    g.moveTo(0, this.floor - c[0]);
    for (let i = 1; i < c.length; i++) g.lineTo(i * cw, this.floor - c[i]);
    g.stroke({ color: 0xc8dcff, width: 2, alpha: 0.8 });
  }

  private updatePhysics(dt: number) {
    const p = this.physics;
    if (!p || !p.bodies.length) return;
    for (const f of this.forces) {
      for (const h of p.pull(f.x, f.y, f.strength * 0.08, f.radius, f.eat)) h.data.g.destroy();
    }
    const expired = p.step(dt);
    for (const h of expired) this.removeBody(h);
    for (const h of p.bodies) {
      this.syncBody(h);
      if (h.ttl > 0) {
        const left = h.ttl - (p.time - h.born);
        h.data.g.alpha = Math.min(1, left / 1.2);
      }
    }
  }

  private updateShakeFlash(dt: number) {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const a = this.shakeAmp * Math.min(1, this.shakeTime * 2);
      this.root.position.set(this.rng.range(-a, a), this.rng.range(-a, a));
      if (this.shakeTime <= 0) {
        this.shakeAmp = 0;
        this.root.position.set(0, 0);
      }
    }
    const g = this.flashGfx;
    g.clear();
    if (this.flashAlpha > 0.003) {
      g.rect(0, 0, this.w, this.h).fill({ color: this.flashColor, alpha: this.flashAlpha });
      this.flashAlpha *= Math.pow(this.reducedFlashing ? 0.2 : 0.004, dt);
    } else {
      this.flashAlpha = 0;
    }
  }

  private updateDecalFade(dt: number) {
    if (this.decalFade <= 0) return;
    this.decalFade += dt;
    const a = Math.max(0, 1 - this.decalFade / 1.5);
    this.root.alpha = a;
    if (a <= 0) this.clearNow();
  }

  private syncParticles() {
    const P = this.particles;
    const n = P.count;
    const normal = this.partNormal.particleChildren;
    const add = this.partAdd.particleChildren;
    normal.length = 0;
    add.length = 0;
    let ni = 0;
    let ai = 0;
    for (let i = 0; i < n; i++) {
      const kind = P.kind[i];
      const additive = ADDITIVE.has(kind);
      let part: Particle;
      if (additive) {
        part = this.poolAdd[ai] ??= new Particle({ texture: this.textures[0] });
        ai++;
        add.push(part);
      } else {
        part = this.poolNormal[ni] ??= new Particle({ texture: this.textures[0] });
        ni++;
        normal.push(part);
      }
      const t = P.t(i);
      const size = lerp(P.size0[i], P.size1[i], t);
      const tex = this.textures[kind] ?? this.textures[0];
      part.texture = tex;
      part.x = P.x[i];
      part.y = P.y[i];
      part.anchorX = 0.5;
      part.anchorY = 0.5;
      if (kind === Kind.Spark || kind === Kind.Water || kind === Kind.Bolt) {
        // Streaks point along their velocity.
        const v = Math.hypot(P.vx[i], P.vy[i]);
        part.rotation = Math.atan2(P.vy[i], P.vx[i]);
        part.scaleX = (size * (1 + Math.min(3, v / 300))) / tex.width;
        part.scaleY = size / tex.height;
      } else {
        part.rotation = P.rot[i];
        part.scaleX = size / tex.width;
        part.scaleY = size / tex.height;
      }
      part.tint = lerpColor(P.color0[i], P.color1[i], t);
      part.alpha = Math.max(0, Math.min(1, lerp(P.alpha0[i], P.alpha1[i], t * t)));
    }
    this.partNormal.update();
    this.partAdd.update();
  }
}

/** Irregular dark scorch with a brown rim. */
export function burnMark(x: number, y: number, r: number, rng: Rng): Graphics {
  const g = new Graphics();
  for (let k = 0; k < 5; k++) {
    const rr = r * (1 - k * 0.16);
    g.circle(x + rng.range(-r * 0.15, r * 0.15), y + rng.range(-r * 0.1, r * 0.1), rr).fill({ color: k === 0 ? 0x3b2410 : 0x0d0805, alpha: k === 0 ? 0.18 : 0.22 });
  }
  return g;
}

/** All particle shapes on one canvas, so both particle containers share one texture source. */
function makeTextures(): Texture[] {
  const cell = 64;
  const shapes = KIND_COUNT;
  const c = document.createElement('canvas');
  c.width = cell * shapes;
  c.height = cell;
  const g = c.getContext('2d')!;
  const soft = (cx: number, hard = 0) => {
    const grad = g.createRadialGradient(cx + 32, 32, 0, cx + 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(hard, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(cx, 0, cell, cell);
  };
  const disc = (cx: number) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx + 32, 32, 28, 0, Math.PI * 2);
    g.fill();
  };
  const streak = (cx: number) => {
    const grad = g.createLinearGradient(cx, 0, cx + cell, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.7, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0.6)');
    g.fillStyle = grad;
    g.fillRect(cx, 24, cell, 16);
  };
  // Snowflake with a thin dark rim, so it still shows on white pages.
  const flake = (cx: number) => {
    g.lineCap = 'round';
    for (const [style, width] of [['rgba(30,50,80,0.6)', 10], ['#fff', 5]] as const) {
      g.strokeStyle = style;
      g.lineWidth = width;
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        g.beginPath();
        g.moveTo(cx + 32 - Math.cos(a) * 25, 32 - Math.sin(a) * 25);
        g.lineTo(cx + 32 + Math.cos(a) * 25, 32 + Math.sin(a) * 25);
        g.stroke();
      }
    }
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx + 32, 32, 6, 0, Math.PI * 2);
    g.fill();
  };
  const shard = (cx: number) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(cx + 10, 8);
    g.lineTo(cx + 56, 24);
    g.lineTo(cx + 30, 58);
    g.closePath();
    g.fill();
  };
  const square = (cx: number) => {
    g.fillStyle = '#fff';
    g.fillRect(cx + 12, 12, 40, 40);
  };
  const painters: Record<number, (cx: number) => void> = {
    [Kind.Spark]: streak,
    [Kind.Fire]: (cx) => soft(cx, 0.1),
    [Kind.Smoke]: (cx) => soft(cx, 0),
    [Kind.Water]: streak,
    [Kind.Snow]: flake,
    [Kind.Paint]: disc,
    [Kind.Debris]: square,
    [Kind.Dust]: (cx) => soft(cx, 0.3),
    [Kind.Glint]: shard,
    [Kind.Ember]: (cx) => soft(cx, 0.4),
    [Kind.Steam]: (cx) => soft(cx, 0),
    [Kind.Bolt]: streak,
  };
  for (let k = 0; k < shapes; k++) painters[k]?.(k * cell);
  const base = Texture.from(c);
  return Array.from({ length: shapes }, (_, k) => new Texture({ source: base.source, frame: new Rectangle(k * cell, 0, cell, cell) }));
}
