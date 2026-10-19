import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { Snapshot, THEMES, Widget, WIDGET_KINDS, WidgetKind, WidgetsState } from '../../shared/widgets';
import { createView } from '../../widgets/kinds';
import { applyTheme } from '../../widgets/theme';
import widgetCss from '../../widgets/widgets.css?inline';
import { useAction, useStore } from '../store';
import { Card, Segmented, Slider, Toggle } from '../ui';
import * as f from '../../widgets/format';

/** A live widget face inside the main window. */
function Preview({ widget, snap, theme }: { widget: Widget; snap: Snapshot | null; theme: string }) {
  const { settings } = useStore();
  const host = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const view = useRef<ReturnType<typeof createView> | null>(null);
  useEffect(() => {
    if (!host.current) return;
    // Shadow DOM keeps the widget styles from leaking into the app (both use .card).
    if (!inner.current) {
      const shadow = host.current.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = widgetCss;
      inner.current = document.createElement('div');
      shadow.append(style, inner.current);
    }
    inner.current.innerHTML = '';
    view.current = createView(widget);
    inner.current.append(view.current.el);
    applyTheme(theme, settings.customTheme, inner.current);
    view.current.tick?.(new Date());
    const t = window.setInterval(() => view.current?.tick?.(new Date()), view.current.fast ? 50 : 1000);
    return () => window.clearInterval(t);
  }, [widget.kind, JSON.stringify(widget.config)]);
  useEffect(() => {
    if (inner.current) applyTheme(theme, settings.customTheme, inner.current);
  }, [theme, settings.customTheme]);
  useEffect(() => view.current?.update(snap), [snap]);
  return <div className="preview" ref={host} />;
}

function demoWidget(kind: WidgetKind): Widget {
  return { id: 0, profileId: 0, kind, x: 0, y: 0, w: 0, h: 0, opacity: 1, level: 'top', clickThrough: false, visible: true, config: {} };
}

function ConfigFields({ w, save }: { w: Widget; save: (c: Record<string, unknown>) => void }) {
  const c = w.config;
  switch (w.kind) {
    case 'clock':
    case 'worldclock':
      return (
        <>
          <Segmented value={c.format === '12h' ? '12h' : '24h'} options={[{ value: '24h', label: '24-hour' }, { value: '12h', label: '12-hour' }]} onChange={(v) => save({ ...c, format: v })} />
          {w.kind === 'worldclock' && (
            <label className="field">
              <span>Time zones (one per line, like Europe/Paris)</span>
              <textarea
                rows={4}
                defaultValue={(Array.isArray(c.zones) ? (c.zones as string[]) : ['America/New_York', 'Europe/London', 'Europe/Bucharest', 'Asia/Tokyo']).join('\n')}
                onBlur={(e) => save({ ...c, zones: e.target.value.split('\n').map((z) => z.trim()).filter((z) => z && f.validZone(z)).slice(0, 8) })}
              />
            </label>
          )}
        </>
      );
    case 'analog':
      return (
        <label className="field">
          <span>Time zone (empty = this computer)</span>
          <input className="input" defaultValue={String(c.zone ?? '')} onBlur={(e) => save({ ...c, zone: f.validZone(e.target.value.trim()) ? e.target.value.trim() : '' })} />
        </label>
      );
    case 'countdown':
      return (
        <>
          <label className="field">
            <span>Label</span>
            <input className="input" maxLength={40} defaultValue={String(c.label ?? '')} onBlur={(e) => save({ ...c, label: e.target.value })} />
          </label>
          <label className="field">
            <span>Counts down to</span>
            <input className="input" type="datetime-local" defaultValue={String(c.target ?? '').slice(0, 16)} onChange={(e) => save({ ...c, target: e.target.value })} />
          </label>
        </>
      );
    case 'text':
      return (
        <>
          <label className="field">
            <span>Text</span>
            <textarea rows={3} maxLength={500} defaultValue={String(c.text ?? '')} onBlur={(e) => save({ ...c, text: e.target.value })} />
          </label>
          <Slider label="Font size" value={Number(c.size ?? 28)} min={10} max={96} onChange={(v) => save({ ...c, size: v })} />
          <Segmented value={String(c.align ?? 'center')} options={['left', 'center', 'right'].map((a) => ({ value: a, label: a }))} onChange={(v) => save({ ...c, align: v })} />
        </>
      );
    default:
      return null;
  }
}

function Placed({ w, snap, theme, onChange, onRemove }: { w: Widget; snap: Snapshot | null; theme: string; onChange: (w: Widget) => void; onRemove: () => void }) {
  const meta = WIDGET_KINDS.find((k) => k.kind === w.kind)!;
  const [open, setOpen] = useState(false);
  return (
    <div className="placed">
      <div className="row spread">
        <div>
          <b>{meta.name}</b>
          <div className="muted small">
            {Math.round(w.x)}, {Math.round(w.y)} · {Math.round(w.w)} x {Math.round(w.h)} · {w.level === 'top' ? 'always on top' : w.level === 'desktop' ? 'on the desktop' : 'normal window'}
            {w.clickThrough ? ' · click-through' : ''}
          </div>
        </div>
        <div className="row">
          <Toggle checked={w.visible} onChange={(v) => onChange({ ...w, visible: v })} label="" />
          <button className="btn small secondary" onClick={() => setOpen((o) => !o)}>
            {open ? 'Done' : 'Edit'}
          </button>
          <button className="btn small secondary" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
      {open && (
        <div className="placed-edit">
          <Preview widget={w} snap={snap} theme={theme} />
          <div className="stack">
            <Slider label="Opacity" value={w.opacity} min={0.15} max={1} step={0.05} onChange={(v) => onChange({ ...w, opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider
              label="Size"
              value={Math.round((w.w / (WIDTHS[w.kind] ?? 450)) * 100)}
              min={40}
              max={300}
              step={5}
              onChange={(v) => {
                const k = v / 100 / (w.w / (WIDTHS[w.kind] ?? 450));
                onChange({ ...w, w: w.w * k, h: w.h * k });
              }}
              format={(v) => `${v}%`}
            />
            <Segmented
              value={w.level}
              options={[
                { value: 'top', label: 'Always on top' },
                { value: 'desktop', label: 'On desktop' },
                { value: 'normal', label: 'Normal' },
              ]}
              onChange={(v) => onChange({ ...w, level: v })}
            />
            <Toggle checked={w.clickThrough} onChange={(v) => onChange({ ...w, clickThrough: v })} label="Click-through" hint="Clicks pass to whatever is underneath. Use Edit layout to move it again." />
            <ConfigFields w={w} save={(config) => onChange({ ...w, config })} />
          </div>
        </div>
      )}
    </div>
  );
}

const WIDTHS: Record<string, number> = { worldclock: 320, analog: 220, countdown: 320, stopwatch: 320, text: 360 };

function Availability({ snap, platform }: { snap: Snapshot | null; platform: string }) {
  if (!snap) return <p className="muted">Reading sensors…</p>;
  const g = snap.gpus[0];
  const rows: [string, boolean][] = [
    ['CPU load per core', snap.cpu.cores.length > 0],
    ['CPU clock', snap.cpu.freqMhz !== null],
    ['CPU temperature', snap.cpu.tempC !== null],
    ['CPU power', snap.cpu.powerW !== null],
    ['RAM usage', snap.memory.total > 0],
    ['RAM type and speed', !!snap.memory.modules],
    ['GPU load', g?.usage !== null && g?.usage !== undefined],
    ['GPU memory', g?.vramUsed !== null && g?.vramUsed !== undefined],
    ['GPU temperature', g?.tempC !== null && g?.tempC !== undefined],
    ['GPU fan', (g?.fanRpm ?? g?.fanPct ?? null) !== null],
    ['Disk activity', snap.disks.length > 0],
    ['Disk temperature', snap.disks.some((d) => d.tempC !== null)],
    ['Network speed', true],
    ['Battery', snap.battery !== null],
    ['Fans and voltages', snap.board.fans.length + snap.board.voltages.length > 0],
  ];
  return (
    <>
      <div className="avail">
        {rows.map(([label, ok]) => (
          <div key={label} className={ok ? 'ok' : 'no'}>
            <span>{ok ? '●' : '○'}</span> {label}
          </div>
        ))}
      </div>
      <p className="muted small">Sources: {snap.sources.join(', ')}.</p>
      {snap.notes.map((n) => (
        <p key={n} className="muted small">
          {n}
        </p>
      ))}
      {platform === 'windows' && !snap.sources.some((s) => s.includes('HardwareMonitor')) && (
        <p className="muted small">
          LibreHardwareMonitor is free and open source. Start it (it needs to run as administrator to read the sensors) and leave it running in the background;
          Desktop Chaos picks it up within 20 seconds. Desktop Chaos itself never needs administrator rights.
        </p>
      )}
    </>
  );
}

export function WidgetsScreen() {
  const { boot, settings, patch } = useStore();
  const run = useAction();
  const [ws, setWs] = useState<WidgetsState | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [newName, setNewName] = useState('');

  const reload = async () => setWs(await api.widgetsState());
  useEffect(() => {
    void reload();
    void api.latestSnapshot().then((s) => s && setSnap(s));
    const un = [listen<Snapshot>('sensors://snapshot', (e) => setSnap(e.payload)), listen('widgets://changed', () => void reload()), listen('widgets://geometry', () => void reload())];
    return () => {
      un.forEach((p) => void p.then((fn) => fn()));
      void api.setEditMode(false);
    };
  }, []);

  if (!ws) return <p className="muted">Loading…</p>;
  const profile = ws.profiles.find((p) => p.id === settings.activeProfile);

  return (
    <>
      <h1>Widgets</h1>
      <p className="lead">Floating system monitors and clocks. Real readings from your hardware; anything your system does not share is marked as unavailable.</p>

      <Card>
        <div className="row spread">
          <div className="row">
            <Toggle checked={!settings.widgetsHidden} onChange={(v) => void patch({ widgetsHidden: !v })} label="Show widgets" />
            <Toggle checked={settings.widgetsLocked} onChange={(v) => void patch({ widgetsLocked: v })} label="Lock positions" />
          </div>
          <button className={`btn ${ws.editMode ? '' : 'secondary'}`} onClick={() => run(async () => (await api.setEditMode(!ws.editMode), reload()))}>
            {ws.editMode ? 'Finish editing' : 'Edit layout'}
          </button>
        </div>
        {ws.editMode && <p className="muted small">Drag widgets anywhere, on any screen. Pull the corner to resize. Click-through widgets can be moved while editing.</p>}
      </Card>

      <Card title="Theme">
        <Segmented value={settings.widgetTheme} options={THEMES.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => void patch({ widgetTheme: v })} />
        {settings.widgetTheme === 'custom' && (
          <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            {(['bg', 'fg', 'accent', 'accent2'] as const).map((k) => (
              <label key={k} className="color">
                <input type="color" value={settings.customTheme[k]} onChange={(e) => void patch({ customTheme: { ...settings.customTheme, [k]: e.target.value } })} />
                {{ bg: 'Background', fg: 'Text', accent: 'Accent', accent2: 'Bars and graphs' }[k]}
              </label>
            ))}
            <Segmented
              value={settings.customTheme.font}
              options={[
                { value: 'inter', label: 'Clean' },
                { value: 'rajdhani', label: 'Gaming' },
                { value: 'mono', label: 'Mono' },
              ]}
              onChange={(v) => void patch({ customTheme: { ...settings.customTheme, font: v } })}
            />
            <Slider label="Corners" value={settings.customTheme.radius} min={0} max={24} onChange={(v) => void patch({ customTheme: { ...settings.customTheme, radius: v } })} format={(v) => `${v}px`} />
          </div>
        )}
      </Card>

      <Card title="Add a widget">
        <div className="gallery">
          {WIDGET_KINDS.map((k) => (
            <button key={k.kind} className="gallery-item" onClick={() => run(async () => (await api.addWidget(k.kind), reload()))}>
              <Preview widget={demoWidget(k.kind)} snap={snap} theme={settings.widgetTheme} />
              <b>{k.name}</b>
              <small className="muted">{k.blurb}</small>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={`On screen: ${profile?.name ?? 'Layout'}`}
        actions={
          <>
            <select value={settings.activeProfile} onChange={(e) => void patch({ activeProfile: Number(e.target.value) })}>
              {ws.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.widgets})
                </option>
              ))}
            </select>
            <button className="btn small secondary" onClick={() => run(() => api.exportProfile(settings.activeProfile))}>
              Export
            </button>
            <button className="btn small secondary" onClick={() => run(async () => (await api.importProfile(), reload()))}>
              Import
            </button>
          </>
        }
      >
        {ws.widgets.length === 0 && <p className="muted">No widgets in this layout yet. Add one above.</p>}
        {ws.widgets.map((w) => (
          <Placed key={w.id} w={w} snap={snap} theme={settings.widgetTheme} onChange={(nw) => run(async () => (await api.updateWidget(nw), reload()))} onRemove={() => run(async () => (await api.removeWidget(w.id), reload()))} />
        ))}
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <input className="input" placeholder="New layout name" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn small secondary" disabled={!newName.trim()} onClick={() => run(async () => (await api.createProfile(newName, true), setNewName(''), reload()))}>
            Save as new layout
          </button>
          <button className="btn small secondary" disabled={!newName.trim()} onClick={() => run(async () => (await api.renameProfile(settings.activeProfile, newName), setNewName(''), reload()))}>
            Rename this one
          </button>
          <button className="btn small secondary" disabled={ws.profiles.length <= 1} onClick={() => run(async () => (await api.deleteProfile(settings.activeProfile), reload()))}>
            Delete layout
          </button>
        </div>
      </Card>

      <Card title="Readings">
        <Slider label="Refresh every" value={settings.widgetRefreshMs} min={250} max={5000} step={250} onChange={(v) => void patch({ widgetRefreshMs: v })} format={(v) => `${(v / 1000).toFixed(2)} s`} />
        <Toggle checked={settings.latencyLan} onChange={(v) => void patch({ latencyLan: v })} label="Measure LAN latency" hint="Pings your router every 5 seconds while widgets are on." />
        <Toggle checked={settings.latencyWan} onChange={(v) => void patch({ latencyWan: v })} label="Measure internet latency" hint={`Pings ${settings.latencyWanHost} every 5 seconds. Off by default.`} />
        {settings.latencyWan && (
          <label className="field">
            <span>Internet host to ping</span>
            <input className="input" defaultValue={settings.latencyWanHost} onBlur={(e) => void patch({ latencyWanHost: e.target.value.trim() })} />
          </label>
        )}
        <Toggle checked={settings.streamerSafe} onChange={(v) => void patch({ streamerSafe: v })} label="Streamer-safe" hint="Hides IP addresses, computer name and process names." />
      </Card>

      <Card title="What this computer shares">
        <Availability snap={snap} platform={boot.platform} />
      </Card>
    </>
  );
}
