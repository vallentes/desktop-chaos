import { api } from '../../shared/api';
import { EFFECTS } from '../../shared/effects';
import { useAction, useStore } from '../store';
import { Card, prettyShortcut } from '../ui';

const FAVORITES = ['hammer', 'machinegun', 'meteor', 'blackhole', 'paintball', 'lightning'] as const;

export function DashboardScreen({ go }: { go: (s: string) => void }) {
  const { boot, settings, chaos, armed, server } = useStore();
  const run = useAction();
  const enabled = boot.monitors.filter((m) => !settings.disabledMonitors.includes(m.index));
  return (
    <>
      <h1>Dashboard</h1>
      <p className="lead">Pick a weapon and wreck the screen. It is all drawn on a see-through layer; nothing on your computer is touched.</p>

      <div className="grid3">
        <Card className="stat-card">
          <small>Status</small>
          <b className={chaos.running ? 'hot' : armed ? 'warm' : 'good'}>{chaos.running ? 'CHAOS RUNNING' : armed ? `ARMED: ${armed.toUpperCase()}` : 'READY'}</b>
          <span className="muted">{settings.desktopEffects ? `${enabled.length} of ${boot.monitors.length} screens` : 'Desktop effects off'}</span>
        </Card>
        <Card className="stat-card">
          <small>Emergency stop</small>
          <b>{prettyShortcut(settings.stopShortcut, boot.platform)}</b>
          <span className="muted">Also in the tray menu, any time</span>
        </Card>
        <Card className="stat-card">
          <small>Streamer</small>
          <b className={server.running ? 'good' : ''}>{server.running ? 'ON' : 'OFF'}</b>
          <span className="muted">{settings.obsEnabled ? 'OBS overlay on' : 'OBS overlay off'} · {settings.apiEnabled ? 'API on' : 'API off'}</span>
        </Card>
      </div>

      <Card title="Quick smash" actions={<button className="btn secondary small" onClick={() => go('arsenal')}>All 15 weapons</button>}>
        <div className="quick">
          {FAVORITES.map((id) => {
            const e = EFFECTS.find((x) => x.id === id)!;
            return (
              <div key={id} className="quick-item">
                <span className="big-icon">{e.icon}</span>
                <b>{e.name}</b>
                <div className="row">
                  <button className="btn small" onClick={() => run(() => api.arm(id))}>
                    Pick up
                  </button>
                  <button className="btn small secondary" onClick={() => run(() => api.fire(id))}>
                    Fire
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid2">
        <Card title="Chaos Mode">
          <p className="muted">Let it run on its own: pick a preset, sit back, watch the screen fall apart.</p>
          <div className="row">
            {chaos.running ? (
              <button className="btn danger" onClick={() => run(() => api.stopChaos())}>
                Stop chaos ({Math.ceil(chaos.remainingSecs)}s left)
              </button>
            ) : (
              <button className="btn" onClick={() => go('chaos')}>
                Set up Chaos Mode
              </button>
            )}
          </div>
        </Card>
        <Card title="Clean up">
          <p className="muted">Wipe every crack, splat and scorch mark. The reset bomb does it with style.</p>
          <div className="row">
            <button className="btn secondary" onClick={() => run(() => api.clear('fade'))}>
              Clear
            </button>
            <button className="btn secondary" onClick={() => run(() => api.fire('bomb'))}>
              💣 Reset bomb
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
