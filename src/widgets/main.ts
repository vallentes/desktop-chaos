// One floating widget window.

import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/jetbrains-mono/500.css';
import './widgets.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { CustomTheme } from '../shared/types';
import type { Snapshot, Widget } from '../shared/widgets';
import { createView, WidgetView } from './kinds';
import { applyTheme } from './theme';

interface Boot {
  widget: Widget;
  theme: string;
  customTheme: CustomTheme;
  locked: boolean;
  editMode: boolean;
  snapshot: Snapshot | null;
}

const win = getCurrentWebviewWindow();
const root = document.getElementById('root')!;
let view: WidgetView | null = null;
let widget: Widget;
let locked = false;
let editMode = false;
let last: Snapshot | null = null;

function mount(w: Widget) {
  widget = w;
  root.innerHTML = '';
  view = createView(w);
  root.append(view.el);
  const grip = document.createElement('div');
  grip.className = 'grip';
  grip.title = 'Drag to resize';
  grip.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    if (!locked || editMode) void win.startResizeDragging('SouthEast');
  });
  root.append(grip);
  root.style.opacity = String(w.opacity);
  fit();
  view.update(last);
  view.tick?.(new Date());
}

/** Scales the face to the window size (the window keeps the widget's aspect). */
function fit() {
  if (!view) return;
  const base = BASE[widget.kind] ?? [450, 200];
  const k = Math.min(window.innerWidth / base[0], window.innerHeight / base[1]);
  view.el.style.width = `${base[0]}px`;
  view.el.style.height = `${base[1]}px`;
  view.el.style.transform = `scale(${k})`;
}

const BASE: Record<string, [number, number]> = {
  clock: [450, 120],
  cpu: [450, 235],
  gpu: [450, 220],
  ram: [450, 210],
  network: [450, 215],
  disk: [450, 225],
  battery: [450, 210],
  board: [450, 215],
  processes: [450, 215],
  worldclock: [320, 200],
  analog: [220, 250],
  countdown: [320, 140],
  stopwatch: [320, 140],
  text: [360, 100],
};

function setModes(l: boolean, e: boolean) {
  locked = l;
  editMode = e;
  document.body.classList.toggle('editing', e);
  document.body.classList.toggle('locked', l && !e);
}

async function main() {
  const boot = await invoke<Boot>('widget_bootstrap');
  last = boot.snapshot;
  applyTheme(boot.theme, boot.customTheme);
  setModes(boot.locked, boot.editMode);
  mount(boot.widget);

  window.addEventListener('resize', fit);
  // Drag anywhere on the widget unless positions are locked.
  root.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    if (!locked || editMode) void win.startDragging();
  });

  await listen<Snapshot>('sensors://snapshot', (e) => {
    last = e.payload;
    view?.update(last);
  });
  await win.listen<Widget>('widget://updated', (e) => mount(e.payload));
  await listen<boolean>('widgets://edit-mode', (e) => setModes(locked, e.payload));
  await listen<{ widgetTheme: string; customTheme: CustomTheme; widgetsLocked: boolean }>('settings://changed', (e) => {
    applyTheme(e.payload.widgetTheme, e.payload.customTheme);
    setModes(e.payload.widgetsLocked, editMode);
  });

  // Clocks tick on the second; the stopwatch every frame while visible.
  const tick = () => view?.tick?.(new Date());
  window.setInterval(() => {
    if (!view?.fast) tick();
  }, 1000);
  const frame = () => {
    if (view?.fast) tick();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
