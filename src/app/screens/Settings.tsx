import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useAction, useStore } from '../store';
import { UpdateCheck } from '../Update';
import { Card, prettyShortcut, Segmented, Slider, Toggle } from '../ui';

/** Records a key combination by pressing it. */
function ShortcutInput({ value, platform, onChange }: { value: string; platform: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false);
  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return setRec(false);
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const code = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code;
      parts.push(code);
      onChange(parts.join('+'));
      setRec(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rec, onChange]);
  return (
    <div className="row">
      <kbd className="shortcut">{rec ? 'Press keys…' : prettyShortcut(value, platform)}</kbd>
      <button className="btn small secondary" onClick={() => setRec(true)}>
        {rec ? 'Listening' : 'Change'}
      </button>
    </div>
  );
}

export function SettingsScreen() {
  const { boot, settings, patch } = useStore();
  const run = useAction();
  const [errors, setErrors] = useState<string[]>(boot.shortcutErrors);
  const setShortcut = async (key: 'stopShortcut' | 'armShortcut', v: string) => {
    await patch({ [key]: v });
    const b = await api.bootstrap();
    setErrors(b.shortcutErrors);
  };

  return (
    <>
      <h1>Settings</h1>

      <Card title="Safety">
        <div className="field-label">Emergency stop (stops chaos, puts the weapon away, wipes the screen)</div>
        <ShortcutInput value={settings.stopShortcut} platform={boot.platform} onChange={(v) => void setShortcut('stopShortcut', v)} />
        <div className="field-label" style={{ marginTop: 12 }}>
          Pick up / put away the last weapon
        </div>
        <ShortcutInput value={settings.armShortcut} platform={boot.platform} onChange={(v) => void setShortcut('armShortcut', v)} />
        {errors.map((e) => (
          <p key={e} className="error-text">
            {e}
          </p>
        ))}
        <p className="muted small">Ctrl+Shift+Esc and Ctrl+Alt+Del belong to the system and cannot be used.</p>
        <Toggle
          checked={settings.reducedFlashing}
          onChange={(v) => void patch({ reducedFlashing: v })}
          label="Reduced flashing"
          hint="Lightning, explosions and the reset bomb glow softly instead of flashing the screen."
        />
      </Card>

      <Card title="Sound">
        <Toggle checked={settings.sound} onChange={(v) => void patch({ sound: v })} label="Sound effects" />
        <Slider label="Volume" value={settings.volume} min={0} max={1} step={0.05} onChange={(v) => void patch({ volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Card>

      <Card title="Screens">
        <Toggle checked={settings.desktopEffects} onChange={(v) => void patch({ desktopEffects: v })} label="Show effects on my desktop" hint="Turn off if you only want them in the OBS overlay." />
        {boot.monitors.map((m) => {
          const on = !settings.disabledMonitors.includes(m.index);
          return (
            <Toggle
              key={m.index}
              checked={on}
              onChange={(v) => void patch({ disabledMonitors: v ? settings.disabledMonitors.filter((i) => i !== m.index) : [...settings.disabledMonitors, m.index] })}
              label={`Screen ${m.index + 1}: ${m.name}${m.primary ? ' (main)' : ''}`}
              hint={`${m.width} x ${m.height}, scale ${Math.round(m.scale * 100)}%`}
            />
          );
        })}
      </Card>

      <Card title="Performance">
        <div className="field-label">Quality</div>
        <Segmented
          value={settings.quality}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
          onChange={(v) => void patch({ quality: v })}
        />
        <p className="muted small">Auto lowers the particle count when frames get slow and raises it again when there is room. When nothing moves, nothing is drawn.</p>
        <Slider label="Particle budget per screen" value={settings.particleBudget} min={300} max={6000} step={100} onChange={(v) => void patch({ particleBudget: v })} />
      </Card>

      <Card title="App">
        <Toggle checked={settings.launchAtStartup} onChange={(v) => void patch({ launchAtStartup: v })} label="Start with my computer" hint="Starts quietly in the tray." />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn small secondary" onClick={() => run(() => api.openDataFolder())}>
            Open data folder
          </button>
          <button className="btn small secondary" onClick={() => run(() => api.quit())}>
            Quit Desktop Chaos
          </button>
        </div>
      </Card>

      <Card title="About">
        <p>
          Desktop Chaos {boot.version} · {boot.platform === 'macos' ? 'macOS' : boot.platform === 'windows' ? 'Windows' : boot.platform}
        </p>
        <p className="muted small">
          Free to use. Everything is drawn on a transparent layer: no files, icons, windows, wallpaper or settings of your computer are ever changed, and the screen is never
          recorded.
        </p>
        <UpdateCheck />
      </Card>
    </>
  );
}
