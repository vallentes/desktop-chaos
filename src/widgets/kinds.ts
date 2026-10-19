// Widget faces. Plain DOM + a tiny canvas graph, so each widget window stays light.
// A value the machine does not expose is shown as "unavailable", never guessed.

import type { Snapshot, Widget } from '../shared/widgets';
import * as f from './format';

export interface WidgetView {
  el: HTMLElement;
  update(s: Snapshot | null): void;
  /** Called every second (clocks) or every frame (stopwatch). */
  tick?(now: Date): void;
  fast?: boolean;
}

type Attrs = Record<string, string>;

function h(tag: string, cls = '', text = '', attrs: Attrs = {}): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function card(title: string, sub = ''): { root: HTMLElement; body: HTMLElement; sub: HTMLElement; head: HTMLElement } {
  const root = h('div', 'card');
  const head = h('div', 'head');
  const t = h('div', 'title', title);
  const s = h('div', 'sub', sub);
  const titles = h('div');
  titles.append(t, s);
  head.append(titles);
  const body = h('div', 'body');
  root.append(head, body, h('i', 'corner'));
  return { root, body, sub: s, head };
}

function set(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('na', text === f.NA);
}

/** Big number with a small unit. */
function bigValue(cls = '') {
  const el = h('div', `big ${cls}`);
  const v = h('span', 'v');
  const u = h('span', 'u');
  el.append(v, u);
  return { el, set: (val: string, unit: string) => (set(v, val), set(u, unit)) };
}

function stat(label: string) {
  const el = h('div', 'stat');
  const l = h('div', 'label', label);
  const v = h('div', 'value');
  el.append(l, v);
  return { el, set: (text: string, cls = '') => (set(v, text), (v.className = `value ${cls}`)) };
}

function bar(label: string, right = '') {
  const el = h('div', 'barrow');
  const l = h('span', 'label', label);
  const track = h('div', 'track');
  const fill = h('div', 'fill');
  track.append(fill);
  const r = h('span', 'right', right);
  el.append(l, track, r);
  return {
    el,
    set(pctv: number | null, text: string, label2?: string) {
      fill.style.width = `${Math.max(0, Math.min(100, pctv ?? 0))}%`;
      el.classList.toggle('na', pctv === null);
      set(r, text);
      if (label2 !== undefined) set(l, label2);
    },
  };
}

function ring() {
  const el = h('div', 'ring');
  el.innerHTML = '<svg viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18" pathLength="100"/></svg><span></span>';
  const fg = el.querySelector('.fg') as SVGCircleElement;
  const txt = el.querySelector('span') as HTMLElement;
  return {
    el,
    set(p: number | null) {
      fg.style.strokeDasharray = `${Math.max(0, Math.min(100, p ?? 0))} 100`;
      set(txt, p === null ? '--' : `${Math.round(p)}%`);
    },
  };
}

/** Rolling line graph. */
class Graph {
  el: HTMLCanvasElement;
  private series: number[][];
  constructor(
    private lines = 1,
    private len = 60,
    private fixedMax: number | null = null,
  ) {
    this.el = document.createElement('canvas');
    this.el.className = 'graph';
    this.series = Array.from({ length: lines }, () => []);
  }
  push(...vals: number[]) {
    vals.forEach((v, i) => {
      const s = this.series[i];
      s.push(Number.isFinite(v) ? v : 0);
      if (s.length > this.len) s.shift();
    });
    this.draw();
  }
  private draw() {
    const c = this.el;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 300;
    const hgt = c.clientHeight || 40;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(hgt * dpr)) c.height = Math.round(hgt * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const max = this.fixedMax ?? Math.max(1, ...this.series.flat()) * 1.15;
    const css = getComputedStyle(this.el);
    const colors = [css.getPropertyValue('--graph1').trim() || '#22d3ee', css.getPropertyValue('--graph2').trim() || '#4ade80'];
    for (let k = this.lines - 1; k >= 0; k--) {
      const s = this.series[k];
      if (s.length < 2) continue;
      const step = w / (this.len - 1);
      const x0 = w - (s.length - 1) * step;
      g.beginPath();
      s.forEach((v, i) => {
        const x = x0 + i * step;
        const y = hgt - 2 - (v / max) * (hgt - 4);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.strokeStyle = colors[k % 2];
      g.lineWidth = 1.5;
      g.stroke();
      g.lineTo(w, hgt);
      g.lineTo(x0, hgt);
      g.closePath();
      g.globalAlpha = 0.15;
      g.fillStyle = colors[k % 2];
      g.fill();
      g.globalAlpha = 1;
    }
  }
}

function tempClass(c: number | null | undefined, warm = 70, hot = 85) {
  if (c === null || c === undefined) return '';
  return c >= hot ? 'hot' : c >= warm ? 'warm' : 'good';
}

function unavailable(body: HTMLElement, text: string) {
  body.append(h('div', 'empty', text));
}

// ---------------------------------------------------------------------------------------------

function clock(w: Widget): WidgetView {
  const c = card('');
  c.root.classList.add('clock');
  c.head.remove();
  const time = h('div', 'clocktime');
  const day = h('div', 'day');
  const right = h('div', 'right');
  const date = h('div', 'date');
  const up = h('div', 'uptime');
  right.append(date, up);
  const left = h('div');
  left.append(time, day);
  c.body.append(left, right);
  const h12 = w.config.format === '12h';
  return {
    el: c.root,
    tick(now) {
      set(time, now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: h12 }));
      set(day, now.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase());
      set(date, now.toISOString().slice(0, 10));
    },
    update(s) {
      set(up, s ? `UP ${f.uptime(s.uptimeSecs)}` : '');
    },
  };
}

function cpu(): WidgetView {
  const c = card('CPU LOAD');
  const top = h('div', 'row');
  const r = ring();
  const tempS = stat('TEMP');
  const freq = stat('FREQ');
  const power = stat('POWER');
  const stats = h('div', 'stats');
  stats.append(tempS.el, freq.el, power.el);
  top.append(r.el, stats);
  const cores = h('div', 'cores');
  const graph = new Graph(1, 60, 100);
  c.body.append(top, cores, graph.el);
  const bars: ReturnType<typeof bar>[] = [];
  return {
    el: c.root,
    update(s) {
      if (!s) return;
      set(c.sub, s.cpu.name);
      r.set(s.cpu.usage);
      tempS.set(f.temp(s.cpu.tempC), tempClass(s.cpu.tempC));
      freq.set(f.ghz(s.cpu.freqMhz));
      power.set(f.watts(s.cpu.powerW));
      while (bars.length < s.cpu.cores.length) {
        const b = bar(`C${bars.length}`);
        bars.push(b);
        cores.append(b.el);
      }
      s.cpu.cores.forEach((v, i) => bars[i].set(v, `${Math.round(v)}%`));
      graph.push(s.cpu.usage);
    },
  };
}

function gpu(w: Widget): WidgetView {
  const c = card('GPU LOAD');
  const top = h('div', 'row');
  const r = ring();
  const t = stat('TEMP');
  const hot = stat('HOT');
  const fan = stat('FAN');
  const power = stat('POWER');
  const stats = h('div', 'stats');
  stats.append(t.el, hot.el, fan.el, power.el);
  top.append(r.el, stats);
  const vram = bar('VRAM');
  const d3 = bar('3D');
  const vdec = bar('VDEC');
  const graph = new Graph(1, 60, 100);
  c.body.append(top, vram.el, d3.el, vdec.el, graph.el);
  const index = Number(w.config.gpu ?? 0);
  let empty = false;
  return {
    el: c.root,
    update(s) {
      if (!s) return;
      const g = s.gpus[index] ?? s.gpus[0];
      if (!g) {
        if (!empty) {
          empty = true;
          c.body.innerHTML = '';
          unavailable(c.body, 'No GPU reported by the system.');
        }
        return;
      }
      set(c.sub, g.name);
      r.set(g.usage);
      t.set(f.temp(g.tempC), tempClass(g.tempC, 75, 88));
      hot.set(f.temp(g.hotspotC), tempClass(g.hotspotC, 85, 100));
      fan.set(g.fanRpm !== null ? `${Math.round(g.fanRpm)} rpm` : g.fanPct !== null ? f.pct(g.fanPct) : f.NA);
      power.set(f.watts(g.powerW));
      const vp = g.vramUsed !== null && g.vramTotal ? (g.vramUsed / g.vramTotal) * 100 : null;
      vram.set(vp, g.vramUsed !== null ? `${f.bytes(g.vramUsed)}${g.vramTotal ? ` / ${f.bytes(g.vramTotal, 0)}` : ''}` : f.NA);
      d3.set(g.usage3d, f.pct(g.usage3d));
      vdec.set(g.videoDecode, f.pct(g.videoDecode));
      graph.push(g.usage ?? 0);
    },
  };
}

function ram(): WidgetView {
  const c = card('RAM USAGE');
  const row = h('div', 'row');
  const used = bigValue('accent');
  const total = h('div', 'small');
  const left = h('div');
  left.append(used.el, total);
  const free = stat('FREE');
  const t = stat('TEMP');
  const swap = stat('SWAP');
  const stats = h('div', 'stats');
  stats.append(free.el, t.el, swap.el);
  row.append(left, stats);
  const mem = bar('MEM');
  c.body.append(row, mem.el);
  return {
    el: c.root,
    update(s) {
      if (!s) return;
      const m = s.memory;
      set(c.sub, [m.modules, m.maker].filter(Boolean).join(' | ') || 'Memory');
      used.set((m.used / 1024 ** 3).toFixed(1), '');
      set(total, `/ ${Math.round(m.total / 1024 ** 3)} GB`);
      free.set(f.bytes(m.available));
      t.set(f.temp(m.tempC), tempClass(m.tempC, 55, 70));
      swap.set(m.swapTotal ? f.bytes(m.swapUsed) : 'none');
      const p = (m.used / Math.max(1, m.total)) * 100;
      mem.set(p, `${Math.round(p)}%`);
    },
  };
}

function network(): WidgetView {
  const c = card('NETWORK');
  const row = h('div', 'row spread');
  const up = h('div', 'updown');
  const upL = h('div', 'arrow up', '▲ UP');
  const upV = bigValue();
  up.append(upL, upV.el);
  const down = h('div', 'updown');
  const downL = h('div', 'arrow down', '▼ DOWN');
  const downV = bigValue();
  down.append(downL, downV.el);
  row.append(up, down);
  const lat = h('div', 'latency');
  const lan = h('span');
  const wan = h('span');
  const ip = h('span', 'ip');
  lat.append(lan, wan, ip);
  const graph = new Graph(2, 60);
  c.body.append(row, lat, graph.el);
  return {
    el: c.root,
    update(s) {
      if (!s) return;
      set(c.sub, s.net.iface ?? 'Network');
      upV.set(...f.bits(s.net.upBps));
      downV.set(...f.bits(s.net.downBps));
      set(lan, `LAN ${s.net.lanMs !== null ? f.ms(s.net.lanMs) : 'off'}`);
      set(wan, `WAN ${s.net.wanMs !== null ? f.ms(s.net.wanMs) : 'off'}`);
      set(ip, s.streamerSafe ? 'IP hidden' : (s.net.ips[0] ?? ''));
      graph.push(s.net.downBps, s.net.upBps);
    },
  };
}

function disk(): WidgetView {
  const c = card('DISK');
  const row = h('div', 'row spread');
  const r = h('div', 'updown');
  r.append(h('div', 'arrow read', '▲ READ'));
  const rv = bigValue();
  r.append(rv.el);
  const wd = h('div', 'updown');
  wd.append(h('div', 'arrow write', '▼ WRITE'));
  const wv = bigValue();
  wd.append(wv.el);
  row.append(r, wd);
  const drives = h('div', 'drives');
  c.body.append(row, drives);
  const rows = new Map<string, { el: HTMLElement; b: ReturnType<typeof bar>; sub: HTMLElement }>();
  return {
    el: c.root,
    update(s) {
      if (!s) return;
      const rd = s.disks.reduce((a, d) => a + d.readBps, 0);
      const wr = s.disks.reduce((a, d) => a + d.writeBps, 0);
      rv.set(...f.rate(rd));
      wv.set(...f.rate(wr));
      for (const d of s.disks.slice(0, 4)) {
        let e = rows.get(d.mount);
        if (!e) {
          const el = h('div', 'drive');
          const b = bar(d.mount.replace(/\\$/, ''));
          const sub = h('div', 'drivesub');
          el.append(b.el, sub);
          drives.append(el);
          e = { el, b, sub };
          rows.set(d.mount, e);
        }
        const used = d.total - d.available;
        e.b.set((used / Math.max(1, d.total)) * 100, `${f.bytes(used, 1)}`);
        set(e.sub, `${d.kind === 'SSD' ? 'SSD' : d.kind === 'HDD' ? 'HDD' : 'Drive'} · ${d.name || 'Local disk'} · ${f.bytes(d.total, 0)} · ${d.tempC !== null ? f.temp(d.tempC) : 'temp unavailable'}`);
      }
    },
  };
}

function battery(): WidgetView {
  const c = card('BATTERY');
  const big = bigValue('good');
  const stats = h('div', 'stats');
  const st = stat('STATUS');
  const tl = stat('TIME LEFT');
  const pw = stat('POWER');
  stats.append(st.el, tl.el, pw.el);
  const pwr = bar('PWR');
  c.body.append(big.el, stats, pwr.el);
  let empty = false;
  return {
    el: c.root,
    update(s) {
      if (!s) return;
      if (!s.battery) {
        if (!empty) {
          empty = true;
          c.body.innerHTML = '';
          unavailable(c.body, 'No battery found. This looks like a desktop PC.');
        }
        return;
      }
      const b = s.battery;
      big.set(String(Math.round(b.percent)), '%');
      st.set(b.state.toUpperCase(), b.state === 'charging' ? 'good' : b.state === 'discharging' ? 'warm' : '');
      tl.set(b.timeLeftSecs !== null ? f.hoursMinutes(b.timeLeftSecs) : b.state === 'full' ? 'full' : f.NA);
      pw.set(f.watts(b.powerW));
      pwr.set(b.percent, `${Math.round(b.percent)}%`);
    },
  };
}

function board(): WidgetView {
  const c = card('MOTHERBOARD');
  const grid = h('div', 'boardgrid');
  const cols = [h('div', 'col'), h('div', 'col'), h('div', 'col')];
  grid.append(...cols);
  const note = h('div', 'note');
  c.body.append(grid, note);
  const fill = (col: HTMLElement, title: string, unit: string, list: { label: string; value: number }[], fmt: (v: number) => string) => {
    col.innerHTML = '';
    const head = h('div', 'colhead');
    head.append(h('span', '', title), h('span', '', unit));
    col.append(head);
    if (!list.length) col.append(h('div', 'na small', f.NA));
    for (const r of list.slice(0, 7)) {
      const row = h('div', 'kv');
      row.append(h('span', 'k', r.label), h('span', 'v', fmt(r.value)));
      col.append(row);
    }
  };
  let last = '';
  return {
    el: c.root,
    update(s) {
      if (!s) return;
      set(c.sub, [s.board.name, s.board.chip].filter(Boolean).join(' · ') || 'Motherboard');
      const key = JSON.stringify(s.board);
      if (key === last) return;
      last = key;
      fill(cols[0], 'FAN', 'RPM', s.board.fans, (v) => String(Math.round(v)));
      fill(cols[1], 'SENSOR', '°C', s.board.temps, (v) => String(Math.round(v)));
      fill(cols[2], 'RAIL', 'V', s.board.voltages, (v) => v.toFixed(2));
      set(note, s.board.fans.length || s.board.voltages.length ? '' : s.notes[0] ?? '');
    },
  };
}

function processes(): WidgetView {
  const c = card('PROCESSES');
  const table = h('div', 'ptable');
  c.body.append(table);
  return {
    el: c.root,
    update(s) {
      if (!s) return;
      set(c.sub, s.streamerSafe ? 'Names hidden (streamer-safe)' : '');
      table.innerHTML = '';
      const head = h('div', 'prow head');
      head.append(h('span', '', 'NAME'), h('span', '', 'CPU'), h('span', '', 'RAM'));
      table.append(head);
      for (const p of s.processes.slice(0, 8)) {
        const r = h('div', 'prow');
        r.append(h('span', 'pname', p.name), h('span', 'pcpu', `${p.cpu.toFixed(1)}%`), h('span', 'pmem', f.bytes(p.mem, 0).replace(' ', '')));
        table.append(r);
      }
    },
  };
}

const DEFAULT_ZONES = ['America/New_York', 'Europe/London', 'Europe/Bucharest', 'Asia/Tokyo'];

function worldclock(w: Widget): WidgetView {
  const c = card('WORLD CLOCKS');
  const list = h('div', 'zones');
  c.body.append(list);
  const zones = (Array.isArray(w.config.zones) ? (w.config.zones as string[]) : DEFAULT_ZONES).filter(f.validZone).slice(0, 8);
  const rows = zones.map((z) => {
    const r = h('div', 'kv zone');
    const name = h('span', 'k', z.split('/').pop()!.replace(/_/g, ' '));
    const v = h('span', 'v');
    r.append(name, v);
    list.append(r);
    return { z, v };
  });
  const h12 = w.config.format === '12h';
  return {
    el: c.root,
    update() {},
    tick(now) {
      for (const r of rows) set(r.v, f.timeIn(r.z, now, h12));
    },
  };
}

function analog(w: Widget): WidgetView {
  const root = h('div', 'card analog');
  root.innerHTML = `<svg viewBox="0 0 200 200">
    <circle class="face" cx="100" cy="100" r="92"/>
    ${Array.from({ length: 12 }, (_, i) => `<line class="tick" x1="100" y1="14" x2="100" y2="${i % 3 ? 22 : 28}" transform="rotate(${i * 30} 100 100)"/>`).join('')}
    <line class="hand hour" x1="100" y1="100" x2="100" y2="52"/>
    <line class="hand min" x1="100" y1="100" x2="100" y2="30"/>
    <line class="hand sec" x1="100" y1="112" x2="100" y2="22"/>
    <circle class="hub" cx="100" cy="100" r="5"/></svg><div class="label"></div>`;
  const [hr, mn, sc] = ['.hour', '.min', '.sec'].map((s) => root.querySelector(s) as SVGLineElement);
  const label = root.querySelector('.label') as HTMLElement;
  const zone = typeof w.config.zone === 'string' && f.validZone(w.config.zone) ? w.config.zone : null;
  label.textContent = zone ? zone.split('/').pop()!.replace(/_/g, ' ') : '';
  return {
    el: root,
    update() {},
    tick(now) {
      const t = zone ? new Date(now.toLocaleString('en-US', { timeZone: zone })) : now;
      const s = t.getSeconds();
      const m = t.getMinutes() + s / 60;
      const hh = (t.getHours() % 12) + m / 60;
      hr.setAttribute('transform', `rotate(${hh * 30} 100 100)`);
      mn.setAttribute('transform', `rotate(${m * 6} 100 100)`);
      sc.setAttribute('transform', `rotate(${s * 6} 100 100)`);
    },
  };
}

function countdownView(w: Widget): WidgetView {
  const label = typeof w.config.label === 'string' && w.config.label ? w.config.label : 'COUNTDOWN';
  const c = card(label.toUpperCase());
  const big = h('div', 'clocktime');
  c.body.append(big);
  const target = Date.parse(String(w.config.target ?? ''));
  return {
    el: c.root,
    update() {},
    tick(now) {
      if (!Number.isFinite(target)) {
        set(big, '--:--:--');
        set(c.sub, 'Set a date in Desktop Chaos > Widgets');
        return;
      }
      const p = f.countdown(target, now.getTime());
      set(c.sub, new Date(target).toLocaleString());
      set(big, p.done ? 'NOW!' : `${p.d ? `${p.d}d ` : ''}${String(p.h).padStart(2, '0')}:${String(p.m).padStart(2, '0')}:${String(p.s).padStart(2, '0')}`);
    },
  };
}

function stopwatchView(): WidgetView {
  const c = card('STOPWATCH');
  const big = h('div', 'clocktime');
  const btns = h('div', 'btns');
  const start = h('button', 'btn', 'Start');
  const reset = h('button', 'btn ghost', 'Reset');
  btns.append(start, reset);
  c.body.append(big, btns);
  let running = false;
  let acc = 0;
  let since = 0;
  start.addEventListener('click', () => {
    if (running) {
      acc += performance.now() - since;
      running = false;
    } else {
      since = performance.now();
      running = true;
    }
    start.textContent = running ? 'Pause' : 'Start';
  });
  reset.addEventListener('click', () => {
    acc = 0;
    since = performance.now();
  });
  return {
    el: c.root,
    fast: true,
    update() {},
    tick() {
      set(big, f.stopwatch(acc + (running ? performance.now() - since : 0)));
    },
  };
}

function text(w: Widget): WidgetView {
  const root = h('div', 'card text');
  const t = h('div', 'customtext', typeof w.config.text === 'string' ? w.config.text : 'Your text here');
  t.style.fontSize = `${Math.min(96, Math.max(10, Number(w.config.size ?? 28)))}px`;
  t.style.textAlign = ['left', 'center', 'right'].includes(String(w.config.align)) ? String(w.config.align) : 'center';
  root.append(t);
  return { el: root, update() {} };
}

export function createView(w: Widget): WidgetView {
  switch (w.kind) {
    case 'clock':
      return clock(w);
    case 'cpu':
      return cpu();
    case 'gpu':
      return gpu(w);
    case 'ram':
      return ram();
    case 'network':
      return network();
    case 'disk':
      return disk();
    case 'battery':
      return battery();
    case 'board':
      return board();
    case 'processes':
      return processes();
    case 'worldclock':
      return worldclock(w);
    case 'analog':
      return analog(w);
    case 'countdown':
      return countdownView(w);
    case 'stopwatch':
      return stopwatchView();
    case 'text':
      return text(w);
  }
}
