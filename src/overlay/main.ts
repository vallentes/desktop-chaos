// Overlay page. Runs in two places:
//  - a transparent, click-through Tauri window per monitor (events come from Rust), and
//  - an OBS browser source served from 127.0.0.1 (events come over Server-Sent Events).

// Pixi compiles shader glue with new Function by default; the app's CSP forbids eval.
import 'pixi.js/unsafe-eval';
import '@fontsource/rajdhani/700.css';
import './overlay.css';
import { EFFECTS, EffectId } from '../shared/effects';
import type { FxEvent, FxTrigger, OverlayConfig } from '../shared/types';
import { Hud, toolCursor } from './hud';
import { IMPLS, runTrigger } from './registry';
import { Stage } from './stage';

const params = new URLSearchParams(location.search);
const isTauri = '__TAURI_INTERNALS__' in window;
const monitor = Number(params.get('m') ?? 0);
const floorFromBottom = Number(params.get('floor') ?? 0);

/** Writes to the app's log file (Tauri only), so overlay problems can be diagnosed. */
function log(level: 'info' | 'warn' | 'error', message: string) {
  if (!isTauri) return;
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('frontend_log', { level, message }).catch(() => {}));
}
window.addEventListener('error', (e) => log('error', `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => log('error', `unhandled: ${String((e.reason as Error)?.stack ?? e.reason)}`));

const stage = new Stage();
let lastSeq = 0;
let armed: EffectId | null = null;
let stopShortcut = 'Ctrl+Alt+Backspace';
let pointer = { x: -1000, y: -1000, down: false };

interface Transport {
  ready(): Promise<{ config: OverlayConfig; armed: EffectId | null; mirror: number }>;
  idle(empty: boolean): void;
  select(tool: EffectId): void;
  disarm(): void;
  clear(): void;
  report(t: FxTrigger): void;
  subscribe(fn: (ev: FxEvent) => void): void;
}

async function tauriTransport(): Promise<Transport> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = getCurrentWebviewWindow();
  return {
    async ready() {
      return invoke('overlay_ready', { monitor });
    },
    idle(empty) {
      void invoke('overlay_idle', { monitor, empty, seq: lastSeq });
    },
    select(tool) {
      void invoke('arm_tool', { tool });
    },
    disarm() {
      void invoke('disarm_tool');
    },
    clear() {
      void invoke('clear_effects', { mode: 'instant' });
    },
    report(t) {
      void invoke('overlay_report', { trigger: t });
    },
    subscribe(fn) {
      void win.listen<FxEvent>('fx://event', (e) => fn(e.payload));
    },
  };
}

function obsTransport(): Transport {
  const api = params.get('api') ?? '';
  return {
    async ready() {
      const r = await fetch(`${api}/api/obs-config`);
      return r.json();
    },
    idle() {},
    select() {},
    disarm() {},
    clear() {},
    report() {},
    subscribe(fn) {
      const connect = () => {
        const es = new EventSource(`${api}/api/events`);
        es.addEventListener('fx', (e) => fn(JSON.parse((e as MessageEvent).data)));
        es.onerror = () => {
          es.close();
          window.setTimeout(connect, 2000);
        };
      };
      connect();
    },
  };
}

async function main() {
  document.body.classList.toggle('obs', !isTauri);
  await stage.init(document.getElementById('stage')!, floorFromBottom);
  const transport = isTauri ? await tauriTransport() : obsTransport();
  let mirror = 0;

  const hud = new Hud(document.body, {
    select: (t) => transport.select(t),
    clear: () => transport.clear(),
    disarm: () => transport.disarm(),
  });

  const applyArm = (tool: EffectId | null) => {
    if (armed && armed !== tool) IMPLS[armed].disarm?.(stage);
    armed = isTauri ? tool : null;
    pointer.down = false;
    stage.interactive = armed !== null && !!IMPLS[armed].hover;
    if (armed) {
      document.body.style.cursor = toolCursor(armed);
      hud.show(armed, stopShortcut);
      stage.wake();
      window.focus();
    } else {
      document.body.style.cursor = 'default';
      hud.hide();
      // One frame so the overlay reports idle and Rust can hide an empty window.
      stage.wake();
    }
  };

  const handle = (ev: FxEvent) => {
    lastSeq = Math.max(lastSeq, ev.seq);
    switch (ev.type) {
      case 'trigger':
        if (ev.trigger.source !== 'user') log('info', `trigger ${ev.trigger.effect} on ${stage.w}x${stage.h}`);
        // On stream: chaos and API effects always show; hand-made hits only from the mirrored screen.
        if (!isTauri && ev.trigger.source === 'user' && ev.trigger.monitor !== mirror) return;
        runTrigger(stage, ev.trigger);
        break;
      case 'clear':
        stage.clear(ev.mode);
        break;
      case 'arm':
        applyArm(ev.tool);
        break;
      case 'disarm':
        applyArm(null);
        break;
      case 'countdown':
        hud.countdown(ev.value, ev.label);
        if (ev.value > 0) stage.audio.play('beep', 0.7);
        break;
      case 'config':
        stage.configure(ev.config);
        stopShortcut = ev.config.stopShortcut;
        if (armed) hud.show(armed, stopShortcut);
        break;
    }
  };

  stage.onIdle = (empty) => transport.idle(empty);
  stage.onError = (e) => log('error', `effect failed: ${String((e as Error)?.stack ?? e).slice(0, 800)}`);
  stage.onFrame = (dt) => {
    if (!armed) return;
    const impl = IMPLS[armed];
    impl.hover?.(stage, pointer.x, pointer.y, dt);
    if (pointer.down) impl.hold?.(stage, pointer.x, pointer.y, dt);
  };

  transport.subscribe(handle);
  const boot = await transport.ready();
  log('info', `overlay ready: ${stage.w}x${stage.h} at ${window.devicePixelRatio}x, renderer ${stage.app.renderer.name}`);
  mirror = boot.mirror;
  handle({ type: 'config', seq: 0, config: boot.config });
  if (boot.armed) applyArm(boot.armed);

  // Armed input. The window only receives the mouse while a tool is armed.
  const canvas = stage.app.canvas;
  let reportedAt = 0;
  const report = (tool: EffectId, x: number, y: number, duration: number | null) => {
    const now = performance.now();
    if (now - reportedAt < 100) return;
    reportedAt = now;
    transport.report({ effect: tool, monitor, x: x / stage.w, y: y / stage.h, intensity: stage.intensity, duration, seed: (Math.random() * 1e9) >>> 0, source: 'user' });
  };
  let holdReport = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (!armed) return;
    if (e.button === 2) return transport.disarm();
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointer = { x: e.clientX, y: e.clientY, down: true };
    IMPLS[armed].down?.(stage, e.clientX, e.clientY);
    if (!EFFECTS.find((f) => f.id === armed)?.hold) report(armed, e.clientX, e.clientY, null);
    holdReport = 0;
    stage.interactive = true;
    stage.wake();
  });
  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (armed && IMPLS[armed].hover) stage.wake();
  });
  const release = (e: PointerEvent) => {
    if (!armed || !pointer.down) return;
    pointer.down = false;
    IMPLS[armed].up?.(stage, e.clientX, e.clientY);
    stage.interactive = !!IMPLS[armed].hover;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (armed) transport.disarm();
  });
  canvas.addEventListener('wheel', (e) => {
    if (!armed) return;
    const i = EFFECTS.findIndex((f) => f.id === armed);
    const next = EFFECTS[(i + (e.deltaY > 0 ? 1 : -1) + EFFECTS.length) % EFFECTS.length];
    transport.select(next.id);
  });
  window.addEventListener('keydown', (e) => {
    if (!armed) return;
    if (e.key === 'Escape') return transport.disarm();
    if (e.key.toLowerCase() === 'c') return transport.clear();
    const hit = EFFECTS.find((f) => f.key === e.key.toLowerCase());
    if (hit) transport.select(hit.id);
  });
  // Mirror held tools to OBS about once a second.
  const prevFrame = stage.onFrame;
  stage.onFrame = (dt) => {
    prevFrame?.(dt);
    if (armed && pointer.down && EFFECTS.find((f) => f.id === armed)?.hold) {
      holdReport -= dt;
      if (holdReport <= 0) {
        holdReport = 1;
        report(armed, pointer.x, pointer.y, 1);
      }
    }
  };
  window.addEventListener('blur', () => {
    if (pointer.down && armed) IMPLS[armed].up?.(stage, pointer.x, pointer.y);
    pointer.down = false;
  });
}

void main();
