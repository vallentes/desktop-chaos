import { useState } from 'react';
import { api } from '../../shared/api';
import { EFFECTS, EffectId } from '../../shared/effects';
import type { ChaosConfig } from '../../shared/types';
import { useAction, useStore } from '../store';
import { Card, prettyShortcut, Segmented, Slider, Toggle } from '../ui';

export function ChaosScreen() {
  const { boot, settings, chaos } = useStore();
  const run = useAction();
  const [cfg, setCfg] = useState<ChaosConfig>(settings.chaos);
  const set = (p: Partial<ChaosConfig>) => setCfg((c) => ({ ...c, ...p }));

  const pickPreset = (id: string) => {
    const p = boot.presets.find((x) => x.id === id);
    if (p) setCfg({ ...p.config, sound: cfg.sound, countdown: cfg.countdown });
  };
  const toggleEffect = (id: EffectId) => {
    const has = cfg.effects.includes(id);
    const effects = has ? cfg.effects.filter((e) => e !== id) : [...cfg.effects, id];
    if (effects.length) set({ effects, preset: 'custom' });
  };

  const progress = chaos.running && chaos.durationSecs ? 1 - chaos.remainingSecs / chaos.durationSecs : 0;

  return (
    <>
      <h1>Chaos Mode</h1>
      <p className="lead">
        Hands off: Desktop Chaos picks weapons, places and timing for you. Stop it any time with <kbd>{prettyShortcut(settings.stopShortcut, boot.platform)}</kbd>.
      </p>

      {chaos.running && (
        <Card className="running">
          <div className="row spread">
            <div>
              <b className="hot">{chaos.phase === 'countdown' ? 'GET READY…' : 'CHAOS IN PROGRESS'}</b>
              <div className="muted">
                {Math.ceil(chaos.remainingSecs)}s left · {chaos.eventsFired} effects so far
              </div>
            </div>
            <button className="btn danger big" onClick={() => run(() => api.stopChaos())}>
              STOP
            </button>
          </div>
          <div className="progress">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        </Card>
      )}

      <div className="presets">
        {boot.presets.map((p) => (
          <button key={p.id} className={`preset ${cfg.preset === p.id ? 'on' : ''}`} onClick={() => pickPreset(p.id)}>
            <b>{p.name}</b>
            <small>{p.blurb}</small>
          </button>
        ))}
      </div>

      <Card title={cfg.preset === 'custom' ? 'Custom mix' : 'Weapons in this run'}>
        <div className="chips">
          {EFFECTS.filter((e) => e.id !== 'bomb').map((e) => (
            <button key={e.id} className={`chip ${cfg.effects.includes(e.id) ? 'on' : ''}`} onClick={() => toggleEffect(e.id)} disabled={cfg.preset === 'random'}>
              {e.icon} {e.name}
            </button>
          ))}
        </div>
        {cfg.preset === 'random' && <p className="muted small">Random Madness picks its own weapons and pace every run.</p>}
      </Card>

      <Card>
        <div className="grid2">
          <Slider label="Duration" value={cfg.durationSecs} min={10} max={300} step={5} onChange={(v) => set({ durationSecs: v })} format={(v) => (v >= 60 ? `${Math.floor(v / 60)}m ${v % 60 ? `${v % 60}s` : ''}` : `${v}s`)} />
          <Slider label="Intensity" value={cfg.intensity} min={0.1} max={1} step={0.05} onChange={(v) => set({ intensity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Pace" value={cfg.rate} min={0.2} max={6} step={0.1} onChange={(v) => set({ rate: v })} format={(v) => `${v.toFixed(1)} per second`} />
          <div>
            <div className="field-label">When it ends</div>
            <Segmented
              value={cfg.cleanup}
              options={[
                { value: 'fade', label: 'Fade away' },
                { value: 'bomb', label: '💣 Reset bomb' },
                { value: 'keep', label: 'Leave the mess' },
              ]}
              onChange={(v) => set({ cleanup: v })}
            />
          </div>
          <Toggle checked={cfg.sound} onChange={(v) => set({ sound: v })} label="Sound" />
          <Toggle checked={cfg.countdown} onChange={(v) => set({ countdown: v })} label="3-2-1 countdown" />
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          {chaos.running ? (
            <button className="btn danger big" onClick={() => run(() => api.stopChaos())}>
              Stop chaos
            </button>
          ) : (
            <button className="btn big" onClick={() => run(() => api.startChaos(cfg))}>
              ☄️ Start chaos
            </button>
          )}
        </div>
      </Card>
    </>
  );
}
