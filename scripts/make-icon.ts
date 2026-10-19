// Draws src-tauri/app-icon.png (1024x1024): a cracked dark tile with a hot orange impact.
// `tauri icon` then derives every platform size from it. Run with: npm run icons
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { crackPattern } from '../src/engine/shapes';

const S = 1024;
const c = createCanvas(S, S);
const g = c.getContext('2d');

// Rounded tile with a dark gradient.
const r = 210;
g.beginPath();
g.moveTo(r, 40);
g.arcTo(S - 40, 40, S - 40, S - 40, r);
g.arcTo(S - 40, S - 40, 40, S - 40, r);
g.arcTo(40, S - 40, 40, 40, r);
g.arcTo(40, 40, S - 40, 40, r);
g.closePath();
const bg = g.createLinearGradient(0, 40, 0, S - 40);
bg.addColorStop(0, '#1d1f2b');
bg.addColorStop(1, '#0a0b10');
g.fillStyle = bg;
g.fill();
g.save();
g.clip();

// Glow behind the impact.
const cx = S * 0.47;
const cy = S * 0.5;
const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 420);
glow.addColorStop(0, 'rgba(255,120,40,0.75)');
glow.addColorStop(0.35, 'rgba(255,60,40,0.25)');
glow.addColorStop(1, 'rgba(255,40,40,0)');
g.fillStyle = glow;
g.fillRect(0, 0, S, S);

// Cracks.
const lines = crackPattern(cx, cy, 470, 0.6, 20261019);
g.lineCap = 'round';
g.lineJoin = 'round';
for (const pass of [
  { color: 'rgba(255,90,30,0.55)', extra: 22 },
  { color: '#ffd9b8', extra: 3 },
]) {
  g.strokeStyle = pass.color;
  for (const l of lines) {
    g.lineWidth = l.width * 7 + pass.extra;
    g.beginPath();
    l.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
  }
}

// Impact core.
const core = g.createRadialGradient(cx, cy, 0, cx, cy, 90);
core.addColorStop(0, '#ffffff');
core.addColorStop(0.4, '#ffb070');
core.addColorStop(1, 'rgba(255,80,30,0)');
g.fillStyle = core;
g.beginPath();
g.arc(cx, cy, 90, 0, Math.PI * 2);
g.fill();
g.restore();

writeFileSync('src-tauri/app-icon.png', c.toBuffer('image/png'));
console.log('wrote src-tauri/app-icon.png');
