import { describe, expect, it } from 'vitest';
import { WIDGET_KINDS } from '../shared/widgets';
import * as f from './format';
import { THEME_VARS, themeVars } from './theme';

describe('formatting', () => {
  it('bytes and rates', () => {
    expect(f.bytes(0)).toBe('0 B');
    expect(f.bytes(1536)).toBe('1.5 KB');
    expect(f.bytes(31 * 1024 ** 3, 0)).toBe('31 GB');
    expect(f.bytes(null)).toBe(f.NA);
    expect(f.rate(882 * 1024)).toEqual(['882', 'KB/s']);
    expect(f.bits(25_000)).toEqual(['25.0', 'Kbps']);
    expect(f.bits(562_000)).toEqual(['562', 'Kbps']);
  });

  it('missing sensors read as unavailable, never as zero', () => {
    expect(f.temp(null)).toBe(f.NA);
    expect(f.watts(undefined)).toBe(f.NA);
    expect(f.pct(null)).toBe(f.NA);
    expect(f.ghz(null)).toBe(f.NA);
    expect(f.ms(NaN)).toBe(f.NA);
    expect(f.temp(54.6)).toBe('55°C');
  });

  it('times', () => {
    expect(f.uptime(593946)).toBe('164:59:06');
    expect(f.duration(90061)).toBe('1d 01:01:01');
    expect(f.hoursMinutes(15600)).toBe('4h 20m');
    expect(f.stopwatch(61_230)).toBe('01:01.23');
    expect(f.ms(0.65)).toBe('0.65 ms');
    expect(f.ms(42.4)).toBe('42 ms');
  });

  it('countdowns', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(f.countdown(now + 90_061_000, now)).toEqual({ done: false, d: 1, h: 1, m: 1, s: 1 });
    expect(f.countdown(now - 5, now).done).toBe(true);
  });

  it('time zones', () => {
    expect(f.validZone('Europe/London')).toBe(true);
    expect(f.validZone('Mars/Olympus')).toBe(false);
    expect(f.timeIn('Mars/Olympus', new Date(), false)).toMatch(/\d/);
  });
});

describe('themes', () => {
  it('every theme defines the same variables', () => {
    const keys = Object.keys(THEME_VARS.gaming).sort();
    for (const [name, vars] of Object.entries(THEME_VARS)) expect(Object.keys(vars).sort(), name).toEqual(keys);
  });

  it('custom theme uses the picked colours', () => {
    const v = themeVars('custom', { bg: '#102030', fg: '#ffffff', accent: '#ff0000', accent2: '#00ff00', radius: 6, font: 'mono' });
    expect(v['--bg']).toBe('rgba(16, 32, 48, 0.9)');
    expect(v['--accent']).toBe('#ff0000');
    expect(v['--radius']).toBe('6px');
    expect(v['--font']).toContain('JetBrains Mono');
  });

  it('widget kinds match the Rust list', async () => {
    const fs = await import('node:fs');
    const rust = fs.readFileSync('src-tauri/src/widgets.rs', 'utf8');
    for (const k of WIDGET_KINDS) expect(rust).toContain(`("${k.kind}",`);
    expect((rust.match(/^\s+\("[a-z]+", \d/gm) ?? []).length).toBe(WIDGET_KINDS.length);
  });
});
