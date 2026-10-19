// Monster (eats drawn fake icons) and gravity objects (Rapier bodies that pile up).

import { Container, Graphics, Text } from 'pixi.js';
import { Kind } from '../../engine/particles';
import { Rng } from '../../engine/rng';
import type { BodyData, Entity, Stage } from '../stage';
import { EffectImpl, NEON, repeat } from './common';

// ---------------------------------------------------------------------------------------------
// Fake icons. Drawn shapes with made-up names: the real desktop is never touched.
// ---------------------------------------------------------------------------------------------

const ICON_NAMES = ['homework', 'taxes_FINAL_v3', 'cat.png', 'budget.xlsx', 'New folder (7)', 'notes.txt', 'memes', 'do_not_open', 'resume_2.pdf', 'game_saves', 'vacation', 'todo.txt', 'song.mp3', 'secret_plans', 'backup_old', 'recipes'];

interface FakeIcon {
  c: Container;
  x: number;
  y: number;
  eaten: boolean;
}

function drawIcon(kind: number, rng: Rng): Graphics {
  const g = new Graphics();
  switch (kind % 4) {
    case 0: // folder
      g.roundRect(-22, -14, 20, 8, 2).fill(0xe8b33a);
      g.roundRect(-22, -10, 44, 30, 3).fill(0xf6c94a).stroke({ color: 0xc8932a, width: 1 });
      break;
    case 1: // document
      g.poly([-16, -20, 8, -20, 16, -12, 16, 20, -16, 20]).fill(0xfafafa).stroke({ color: 0x9aa0a6, width: 1 });
      for (let i = 0; i < 4; i++) g.rect(-10, -8 + i * 6, rng.range(14, 22), 2).fill(0x8ab4f8);
      break;
    case 2: // picture
      g.roundRect(-20, -16, 40, 32, 3).fill(0xffffff).stroke({ color: 0x9aa0a6, width: 1 });
      g.rect(-16, -12, 32, 24).fill(0x7ec8ff);
      g.poly([-16, 12, -4, -2, 6, 8, 10, 4, 16, 12]).fill(0x3aa655);
      g.circle(8, -5, 3).fill(0xffe066);
      break;
    default: // app
      g.roundRect(-20, -20, 40, 40, 9).fill(rng.pick(NEON));
      g.circle(0, 0, 9).stroke({ color: 0xffffff, width: 3 });
      break;
  }
  return g;
}

function spawnIcons(s: Stage, n: number, seed: number, near?: { x: number; y: number }): FakeIcon[] {
  const rng = new Rng(seed);
  const icons: FakeIcon[] = [];
  const rows = Math.max(1, Math.floor((s.floor - 40) / 96));
  for (let i = 0; i < n; i++) {
    const x = near ? near.x : 60 + Math.floor(i / rows) * 92;
    const y = near ? near.y : 60 + (i % rows) * 96;
    const c = new Container();
    c.addChild(drawIcon(rng.int(0, 3), rng));
    const label = new Text({
      text: rng.pick(ICON_NAMES),
      style: { fontFamily: 'Segoe UI, -apple-system, sans-serif', fontSize: 12, fill: 0xffffff, align: 'center', wordWrap: true, wordWrapWidth: 84, dropShadow: { color: 0x000000, alpha: 0.9, blur: 2, distance: 1 } },
    });
    label.anchor.set(0.5, 0);
    label.position.set(0, 24);
    c.addChild(label);
    c.position.set(x, y);
    s.bodyLayer.addChild(c);
    icons.push({ c, x, y, eaten: false });
  }
  return icons;
}

// ---------------------------------------------------------------------------------------------
// The monster
// ---------------------------------------------------------------------------------------------

class Monster implements Entity {
  body = new Container();
  private gfx = new Graphics();
  x: number;
  y: number;
  private target: FakeIcon | null = null;
  private chew = 0;
  private t = 0;
  private leaving = false;
  private burped = false;
  private bubble: Text | null = null;
  private face = 1;
  hue: number;

  constructor(
    s: Stage,
    public icons: FakeIcon[],
    rng: Rng,
  ) {
    this.x = s.w + 80;
    this.y = Math.min(s.floor - 60, 120 + rng.range(0, s.h * 0.4));
    this.hue = rng.pick([0x7d4bff, 0x2ecc71, 0xff5e3a, 0x1fb6ff]);
    this.body.addChild(this.gfx);
    s.bodyLayer.addChild(this.body);
  }

  update(dt: number, s: Stage): boolean {
    this.t += dt;
    if (this.chew > 0) {
      this.chew -= dt;
      if (this.chew <= 0 && this.target) {
        this.target.eaten = true;
        this.target.c.destroy({ children: true });
        this.target = null;
      }
    } else {
      if (!this.target && !this.leaving) {
        const left = this.icons.filter((i) => !i.eaten && !i.c.destroyed);
        if (!left.length) {
          this.leaving = true;
          this.say(s, 'burp');
          s.audio.play('chomp', 0.4);
        } else {
          left.sort((a, b) => (a.x - this.x) ** 2 + (a.y - this.y) ** 2 - ((b.x - this.x) ** 2 + (b.y - this.y) ** 2));
          this.target = left[0];
        }
      }
      const tx = this.leaving ? s.w + 200 : this.target!.x + 26;
      const ty = this.leaving ? this.y : this.target!.y - 4;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      const speed = 170;
      if (d > 4) {
        this.face = dx < 0 ? -1 : 1;
        this.x += (dx / d) * Math.min(d, speed * dt);
        this.y += (dy / d) * Math.min(d, speed * dt);
      } else if (this.target) {
        this.chew = 0.7;
        this.face = -1;
        s.audio.play('chomp', 0.8);
        for (let i = 0; i < s.many(16); i++) {
          s.spawn({ kind: Kind.Debris, x: this.target.x, y: this.target.y, vx: s.rng.range(-150, 150), vy: s.rng.range(-250, -50), life: 1.2, size: s.rng.range(2, 5), color: s.rng.pick([0xf6c94a, 0xffffff, 0x8ab4f8, 0x9aa0a6]), gravity: 900, spin: s.rng.range(-10, 10), alpha: 1, alpha1: 0, bounce: 0.3 });
        }
      }
      if (this.leaving && this.x > s.w + 150) return false;
    }
    if (this.target && this.chew > 0) {
      const k = Math.max(0, this.chew / 0.7);
      this.target.c.scale.set(k);
      this.target.c.rotation += dt * 6;
    }
    this.draw();
    if (this.bubble) {
      this.bubble.position.set(this.x, this.y - 70);
      this.bubble.alpha = Math.max(0, this.bubble.alpha - dt * 0.5);
    }
    return true;
  }

  private say(s: Stage, text: string) {
    if (this.burped) return;
    this.burped = true;
    this.bubble = new Text({ text, style: { fontFamily: 'Rajdhani, Segoe UI, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xffffff, dropShadow: { color: 0x000000, alpha: 1, blur: 3, distance: 1 } } });
    this.bubble.anchor.set(0.5);
    s.bodyLayer.addChild(this.bubble);
  }

  private draw() {
    const g = this.gfx;
    g.clear();
    const bob = Math.sin(this.t * 10) * 3;
    const mouth = this.chew > 0 ? Math.abs(Math.sin(this.t * 18)) : 0.15;
    this.body.position.set(this.x, this.y + bob);
    this.body.scale.x = this.face;
    // Legs.
    for (let i = 0; i < 2; i++) {
      const sw = Math.sin(this.t * 12 + i * Math.PI) * 6;
      g.roundRect(-18 + i * 22 + sw, 28, 12, 18, 5).fill(darken(this.hue));
    }
    // Furry body.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      g.circle(Math.cos(a) * 36, Math.sin(a) * 32, 9).fill(this.hue);
    }
    g.ellipse(0, 0, 38, 34).fill(this.hue);
    // Mouth.
    const mh = 4 + mouth * 22;
    g.roundRect(-4, 4 - mh / 2 + 6, 34, mh, 6).fill(0x2a0a14);
    for (let i = 0; i < 4; i++) {
      g.poly([-1 + i * 8, 4 - mh / 2 + 6, 3 + i * 8, 10 - mh / 2 + 6, 7 + i * 8, 4 - mh / 2 + 6]).fill(0xffffff);
      g.poly([-1 + i * 8, 4 + mh / 2 + 6, 3 + i * 8, -2 + mh / 2 + 6, 7 + i * 8, 4 + mh / 2 + 6]).fill(0xffffff);
    }
    // Eyes.
    for (const ex of [4, 22]) {
      g.circle(ex, -14, 9).fill(0xffffff);
      g.circle(ex + 3, -13, 4).fill(0x111111);
    }
    g.poly([-30, -26, -22, -46, -14, -28]).fill(darken(this.hue));
    g.poly([10, -32, 20, -52, 26, -30]).fill(darken(this.hue));
  }

  destroy() {
    if (!this.body.destroyed) this.body.destroy({ children: true });
    if (this.bubble && !this.bubble.destroyed) this.bubble.destroy();
    for (const i of this.icons) if (!i.c.destroyed) i.c.destroy({ children: true });
  }
}

function darken(c: number): number {
  return (((c >> 16) & 255) * 0.65) << 16 | (((c >> 8) & 255) * 0.65) << 8 | ((c & 255) * 0.65);
}

const monsters = new WeakMap<Stage, Monster>();

function summon(s: Stage, icons: number, seed: number, near?: { x: number; y: number }) {
  const cur = monsters.get(s);
  if (cur && s.entities.includes(cur)) {
    cur.icons.push(...spawnIcons(s, icons, seed, near));
    return;
  }
  const rng = new Rng(seed);
  const m = new Monster(s, spawnIcons(s, icons, seed, near), rng);
  monsters.set(s, m);
  s.add(m);
}

export const monster: EffectImpl = {
  trigger(s, t) {
    summon(s, Math.max(3, Math.round(s.options.monsterIcons * (0.5 + t.intensity * 0.5))), t.seed);
  },
  down(s, x, y) {
    // Armed: each click drops a snack where you clicked.
    summon(s, 1, s.rng.int(1, 1e9), { x, y });
  },
};

// ---------------------------------------------------------------------------------------------
// Gravity objects
// ---------------------------------------------------------------------------------------------

type Obj = 'crate' | 'ball' | 'brick';

function makeObject(kind: Obj, rng: Rng): { g: Graphics; w: number; h: number } {
  const g = new Graphics();
  if (kind === 'crate') {
    const s = rng.range(40, 70);
    g.rect(-s / 2, -s / 2, s, s).fill(0xa86f3a).stroke({ color: 0x5c3a1c, width: 3 });
    g.rect(-s / 2 + 5, -s / 2 + 5, s - 10, s - 10).stroke({ color: 0x7a4e26, width: 2 });
    g.moveTo(-s / 2 + 5, -s / 2 + 5).lineTo(s / 2 - 5, s / 2 - 5).stroke({ color: 0x7a4e26, width: 4 });
    return { g, w: s, h: s };
  }
  if (kind === 'brick') {
    const w = rng.range(56, 76);
    const h = w * 0.42;
    g.rect(-w / 2, -h / 2, w, h).fill(0xb4432d).stroke({ color: 0x6b2215, width: 2 });
    g.rect(-w / 2 + 4, -h / 2 + 4, w - 8, 3).fill({ color: 0xffffff, alpha: 0.15 });
    return { g, w, h };
  }
  const r = rng.range(14, 30);
  const c = rng.pick(NEON);
  g.circle(0, 0, r).fill(c).stroke({ color: 0x000000, width: 2, alpha: 0.4 });
  g.moveTo(-r, 0).lineTo(r, 0).stroke({ color: 0xffffff, width: 3, alpha: 0.8 });
  g.circle(-r * 0.35, -r * 0.35, r * 0.25).fill({ color: 0xffffff, alpha: 0.35 });
  return { g, w: r * 2, h: r * 2 };
}

async function drop(s: Stage, x: number, y: number, kind: Obj, rng: Rng, vy = 0) {
  const phys = await s.getPhysics();
  const o = makeObject(kind, rng);
  const data: BodyData = { g: o.g, kind: kind === 'crate' ? 'box' : kind };
  const h =
    kind === 'ball'
      ? phys.addBall(x, y, o.w / 2, rng.range(-120, 120), vy, data, { restitution: 0.7 })
      : phys.addBox(x, y, o.w, o.h, rng.range(-0.6, 0.6), rng.range(-80, 80), vy, rng.range(-3, 3), data, { restitution: kind === 'brick' ? 0.1 : 0.25, density: kind === 'brick' ? 2 : 1 });
  s.addBody(h);
  s.audio.play('pop', 0.3);
}

function pickKind(s: Stage, rng: Rng): Obj {
  const k = s.options.gravityKind;
  if (k === 'crates') return 'crate';
  if (k === 'balls') return 'ball';
  if (k === 'bricks') return 'brick';
  return rng.pick(['crate', 'ball', 'brick'] as const);
}

export const gravity: EffectImpl = {
  trigger(s, t) {
    const n = 3 + Math.round(t.intensity * 12);
    repeat(s, n, 0.12, () => void drop(s, t.x + t.rng.range(-200, 200), -60 - t.rng.range(0, 80), pickKind(s, t.rng), t.rng, t.rng.range(0, 200)));
  },
  down(s, x, y) {
    void drop(s, x, y, pickKind(s, s.rng), s.rng);
  },
};
