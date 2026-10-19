import type { CustomTheme } from '../shared/types';

/** CSS variables per theme. "custom" takes the user's colours. */
export const THEME_VARS: Record<string, Record<string, string>> = {
  gaming: {
    '--bg': 'rgba(10, 12, 18, 0.92)',
    '--fg': '#e7edf5',
    '--muted': '#8892a0',
    '--line': 'rgba(120, 170, 220, 0.25)',
    '--accent': '#f5a623',
    '--good': '#4ade80',
    '--warm': '#fbbf24',
    '--hot': '#f43f5e',
    '--bar': '#22d3ee',
    '--graph1': '#22d3ee',
    '--graph2': '#4ade80',
    '--radius': '2px',
    '--font': "Inter, 'Segoe UI', sans-serif",
    '--title-font': "Inter, 'Segoe UI', sans-serif",
  },
  dark: {
    '--bg': 'rgba(24, 24, 27, 0.88)',
    '--fg': '#fafafa',
    '--muted': '#a1a1aa',
    '--line': 'rgba(255,255,255,0.08)',
    '--accent': '#fafafa',
    '--good': '#a3e635',
    '--warm': '#facc15',
    '--hot': '#f87171',
    '--bar': '#d4d4d8',
    '--graph1': '#e4e4e7',
    '--graph2': '#71717a',
    '--radius': '14px',
    '--font': "Inter, 'Segoe UI', sans-serif",
    '--title-font': "Inter, 'Segoe UI', sans-serif",
  },
  white: {
    '--bg': 'rgba(255, 255, 255, 0.9)',
    '--fg': '#18181b',
    '--muted': '#71717a',
    '--line': 'rgba(0,0,0,0.08)',
    '--accent': '#18181b',
    '--good': '#16a34a',
    '--warm': '#ca8a04',
    '--hot': '#dc2626',
    '--bar': '#3f3f46',
    '--graph1': '#2563eb',
    '--graph2': '#16a34a',
    '--radius': '14px',
    '--font': "Inter, 'Segoe UI', sans-serif",
    '--title-font': "Inter, 'Segoe UI', sans-serif",
  },
  cyberpunk: {
    '--bg': 'rgba(13, 2, 33, 0.9)',
    '--fg': '#fdf500',
    '--muted': '#d1c4ff',
    '--line': 'rgba(255, 0, 170, 0.45)',
    '--accent': '#ff2a6d',
    '--good': '#05ffa1',
    '--warm': '#fdf500',
    '--hot': '#ff2a6d',
    '--bar': '#00f0ff',
    '--graph1': '#00f0ff',
    '--graph2': '#ff2a6d',
    '--radius': '0px',
    '--font': "Rajdhani, 'Segoe UI', sans-serif",
    '--title-font': "Rajdhani, 'Segoe UI', sans-serif",
  },
  rgb: {
    '--bg': 'rgba(8, 8, 10, 0.92)',
    '--fg': '#ffffff',
    '--muted': '#9ca3af',
    '--line': 'rgba(255,255,255,0.12)',
    '--accent': '#ff5a1f',
    '--good': '#22c55e',
    '--warm': '#eab308',
    '--hot': '#ef4444',
    '--bar': '#a855f7',
    '--graph1': '#3b82f6',
    '--graph2': '#ec4899',
    '--radius': '10px',
    '--font': "Rajdhani, 'Segoe UI', sans-serif",
    '--title-font': "Rajdhani, 'Segoe UI', sans-serif",
  },
  professional: {
    '--bg': 'rgba(17, 24, 39, 0.9)',
    '--fg': '#f3f4f6',
    '--muted': '#9ca3af',
    '--line': 'rgba(255,255,255,0.08)',
    '--accent': '#60a5fa',
    '--good': '#34d399',
    '--warm': '#fbbf24',
    '--hot': '#f87171',
    '--bar': '#60a5fa',
    '--graph1': '#60a5fa',
    '--graph2': '#34d399',
    '--radius': '8px',
    '--font': "Inter, 'Segoe UI', sans-serif",
    '--title-font': "Inter, 'Segoe UI', sans-serif",
  },
};

const FONTS: Record<string, string> = {
  inter: "Inter, 'Segoe UI', sans-serif",
  rajdhani: "Rajdhani, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', Consolas, monospace",
};

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(13,15,20,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function themeVars(theme: string, custom: CustomTheme): Record<string, string> {
  if (theme !== 'custom') return THEME_VARS[theme] ?? THEME_VARS.gaming;
  return {
    ...THEME_VARS.gaming,
    '--bg': hexToRgba(custom.bg, 0.9),
    '--fg': custom.fg,
    '--accent': custom.accent,
    '--bar': custom.accent2,
    '--graph1': custom.accent2,
    '--graph2': custom.accent,
    '--radius': `${custom.radius}px`,
    '--font': FONTS[custom.font] ?? FONTS.inter,
    '--title-font': FONTS[custom.font] ?? FONTS.inter,
  };
}

export function applyTheme(theme: string, custom: CustomTheme, el: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(themeVars(theme, custom))) el.style.setProperty(k, v);
  el.dataset.theme = theme;
}
