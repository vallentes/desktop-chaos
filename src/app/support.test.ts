import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { EFFECTS, EFFECT_IDS, normalizeToolOptions } from '../shared/effects';

const REVOLUT_URL = 'https://revolut.me/vallentes';

function render(text: string, scale = 8, margin = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const size = (n + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.modules.get(x, y)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 25;
        }
      }
    }
  }
  return { data, size };
}

describe('support', () => {
  it('the Revolut QR code scans to revolut.me/vallentes', () => {
    const { data, size } = render(REVOLUT_URL);
    expect(jsQR(data, size, size)?.data).toBe(REVOLUT_URL);
  });

  it('the Support screen and the Rust command use the same two links', async () => {
    const fs = await import('node:fs');
    const screen = fs.readFileSync('src/app/screens/Support.tsx', 'utf8');
    const rust = fs.readFileSync('src-tauri/src/commands.rs', 'utf8');
    expect(screen).toContain(`'${REVOLUT_URL}'`);
    expect(rust).toContain(`"${REVOLUT_URL}"`);
    expect(rust).toContain('"https://buymeacoffee.com/vallentes"');
  });
});

describe('arsenal', () => {
  it('has 15 effects with unique ids and keys', () => {
    expect(EFFECTS.length).toBe(15);
    expect(new Set(EFFECTS.map((e) => e.id)).size).toBe(15);
    expect(new Set(EFFECTS.map((e) => e.key)).size).toBe(15);
    expect(EFFECTS.map((e) => e.id)).toEqual([...EFFECT_IDS]);
  });

  it('every effect has an implementation', async () => {
    const fs = await import('node:fs');
    const reg = fs.readFileSync('src/overlay/registry.ts', 'utf8');
    for (const id of EFFECT_IDS) expect(reg).toMatch(new RegExp(`^\\s+${id}(: \\w+)?,$`, 'm'));
  });

  it('tool options are clamped', () => {
    const o = normalizeToolOptions({ fireRate: 1e9, laserColor: 'ultraviolet' as never, snowDensity: -3 });
    expect(o.fireRate).toBe(1200);
    expect(o.laserColor).toBe('red');
    expect(o.snowDensity).toBe(0.05);
  });

  it('no em dashes in user-facing text', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = [...walk('src'), 'README.md', 'PRIVACY.md'].filter((f) => /\.(tsx?|md)$/.test(f) && !f.endsWith('.test.ts') && fs.existsSync(f));
    for (const f of files) expect(fs.readFileSync(f, 'utf8').includes('—'), f).toBe(false);
  });
});
