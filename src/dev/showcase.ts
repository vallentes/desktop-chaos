// Dev-only: widget faces fed with real readings recorded on a real PC (src/dev/sample-series.json,
// names and addresses redacted), for README screenshots. /showcase.html?view=layout|themes&theme=gaming
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '../widgets/widgets.css';
import type { Snapshot, Widget, WidgetKind } from '../shared/widgets';
import { createView } from '../widgets/kinds';
import { applyTheme } from '../widgets/theme';
import { backdrop } from './backdrop';
import series from './sample-series.json';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'layout';
const theme = params.get('theme') ?? 'gaming';
const custom = { bg: '#0d0f14', fg: '#e8ecf2', accent: '#ff6a20', accent2: '#22d3ee', radius: 4, font: 'inter' as const };

document.body.style.background = `url(${backdrop().toDataURL()}) center / cover`;
document.body.style.margin = '0';

const widget = (kind: WidgetKind, config: Record<string, unknown> = {}): Widget => ({ id: 0, profileId: 0, kind, x: 0, y: 0, w: 0, h: 0, opacity: 1, level: 'top', clickThrough: false, visible: true, config });

function place(kind: WidgetKind, x: number, y: number, themeName: string, scale = 1, config: Record<string, unknown> = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform:scale(${scale});transform-origin:0 0`;
  applyTheme(themeName, custom, holder);
  const v = createView(widget(kind, config));
  holder.append(v.el);
  document.body.append(holder);
  return v;
}

const views: ReturnType<typeof createView>[] = [];
if (view === 'layout') {
  // Like a real desktop setup: two columns of cards around the open window.
  views.push(
    place('clock', 30, 24, theme),
    place('ram', 30, 164, theme),
    place('gpu', 30, 394, theme),
    place('processes', 30, 634, theme),
    place('network', 1120, 24, theme),
    place('cpu', 1120, 259, theme),
    place('disk', 1120, 514, theme),
    place('analog', 860, 640, theme, 0.95),
    place('worldclock', 500, 690, theme, 0.95, { zones: ['America/New_York', 'Europe/London', 'Europe/Bucharest', 'Asia/Tokyo'] }),
  );
} else {
  const themes = ['gaming', 'dark', 'white', 'cyberpunk', 'rgb', 'professional'];
  themes.forEach((t, i) => {
    const x = 50 + (i % 3) * 520;
    const y = 70 + Math.floor(i / 3) * 400;
    views.push(place('cpu', x, y, t, 1.0));
    const label = document.createElement('div');
    label.textContent = { gaming: 'Gaming', dark: 'Minimal Dark', white: 'Minimal White', cyberpunk: 'Cyberpunk', rgb: 'Gaming RGB', professional: 'Professional' }[t]!;
    label.style.cssText = `position:absolute;left:${x}px;top:${y - 40}px;font:700 24px Rajdhani,sans-serif;color:#fff;letter-spacing:.04em;text-shadow:0 2px 6px #000`;
    document.body.append(label);
  });
}

// Replay the recorded readings so graphs have history, then hold the last frame.
const snaps = series as unknown as Snapshot[];
let i = 0;
const fixed = new Date('2026-10-20T14:47:16');
const step = () => {
  for (const v of views) {
    v.update(snaps[i]);
    v.tick?.(fixed);
  }
  i++;
  if (i < snaps.length) setTimeout(step, 30);
  else Object.assign(window, { done: true });
};
step();
