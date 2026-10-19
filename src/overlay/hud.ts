// The strip of tools shown at the bottom of the screen while a tool is armed, plus the chaos
// countdown. Plain DOM over the canvas.

import { EFFECTS, EffectId } from '../shared/effects';

export interface HudHandlers {
  select(tool: EffectId): void;
  clear(): void;
  disarm(): void;
}

const cursorCache = new Map<string, string>();

/** A cursor made from the tool's icon, with the hotspot in the middle. */
export function toolCursor(tool: EffectId): string {
  const hit = cursorCache.get(tool);
  if (hit) return hit;
  const info = EFFECTS.find((e) => e.id === tool)!;
  const c = document.createElement('canvas');
  c.width = c.height = 40;
  const g = c.getContext('2d')!;
  g.font = '26px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(info.icon, 20, 21);
  g.strokeStyle = 'rgba(255,90,30,0.9)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(20, 20, 3, 0, Math.PI * 2);
  g.stroke();
  const css = `url(${c.toDataURL()}) 20 20, crosshair`;
  cursorCache.set(tool, css);
  return css;
}

export class Hud {
  private bar: HTMLDivElement;
  private buttons = new Map<EffectId, HTMLButtonElement>();
  private hint: HTMLDivElement;
  private count: HTMLDivElement;
  private countTimer = 0;

  constructor(root: HTMLElement, h: HudHandlers) {
    this.bar = document.createElement('div');
    this.bar.className = 'hud';
    this.bar.hidden = true;
    for (const e of EFFECTS) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.title = `${e.name} (${e.key.toUpperCase()})`;
      b.innerHTML = `<span>${e.icon}</span><kbd>${e.key.toUpperCase()}</kbd>`;
      b.addEventListener('click', () => h.select(e.id));
      this.buttons.set(e.id, b);
      this.bar.appendChild(b);
    }
    const sep = document.createElement('i');
    sep.className = 'sep';
    this.bar.appendChild(sep);
    const clear = document.createElement('button');
    clear.className = 'action';
    clear.textContent = 'Clear';
    clear.title = 'Clear everything (C)';
    clear.addEventListener('click', () => h.clear());
    const done = document.createElement('button');
    done.className = 'action done';
    done.textContent = 'Done';
    done.title = 'Put the tool away (Esc or right-click)';
    done.addEventListener('click', () => h.disarm());
    this.bar.append(clear, done);
    for (const ev of ['pointerdown', 'pointerup', 'wheel', 'contextmenu'] as const) this.bar.addEventListener(ev, (e) => e.stopPropagation());

    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.hint.hidden = true;

    this.count = document.createElement('div');
    this.count.className = 'countdown';
    this.count.hidden = true;
    root.append(this.bar, this.hint, this.count);
  }

  show(tool: EffectId, stopShortcut: string) {
    this.bar.hidden = false;
    this.hint.hidden = false;
    for (const [id, b] of this.buttons) b.classList.toggle('on', id === tool);
    const info = EFFECTS.find((e) => e.id === tool)!;
    this.hint.textContent = `${info.icon} ${info.name}: ${info.hold ? 'hold the mouse button' : 'click'} · Esc or right-click to put it away · ${prettyShortcut(stopShortcut)} stops everything`;
  }

  hide() {
    this.bar.hidden = true;
    this.hint.hidden = true;
  }

  countdown(value: number, label: string) {
    window.clearTimeout(this.countTimer);
    this.count.hidden = false;
    this.count.textContent = value > 0 ? String(value) : label;
    this.count.classList.remove('pop');
    void this.count.offsetWidth;
    this.count.classList.add('pop');
    this.countTimer = window.setTimeout(() => (this.count.hidden = true), value > 0 ? 1100 : 900);
  }
}

export function prettyShortcut(s: string): string {
  return s
    .split('+')
    .map((p) => (p === 'CommandOrControl' ? (navigator.platform.startsWith('Mac') ? 'Cmd' : 'Ctrl') : p))
    .join('+');
}
