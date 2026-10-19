import { api } from '../../shared/api';
import { EFFECTS, EffectId, LASER_COLORS } from '../../shared/effects';
import { useAction, useStore } from '../store';
import { Card, prettyShortcut, Segmented, Slider } from '../ui';

function Options({ id }: { id: EffectId }) {
  const { tools, setTools } = useStore();
  switch (id) {
    case 'hammer':
      return <Slider label="Power" value={tools.hammerPower} min={0.5} max={2} step={0.1} onChange={(v) => setTools({ hammerPower: v })} format={(v) => `${v.toFixed(1)}x`} />;
    case 'machinegun':
      return <Slider label="Fire rate" value={tools.fireRate} min={60} max={1200} step={30} onChange={(v) => setTools({ fireRate: v })} format={(v) => `${v} rpm`} />;
    case 'laser':
      return (
        <>
          <Segmented value={tools.laserColor} options={LASER_COLORS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} onChange={(v) => setTools({ laserColor: v })} />
          <Slider label="Beam width" value={tools.laserWidth} min={0.5} max={3} step={0.1} onChange={(v) => setTools({ laserWidth: v })} format={(v) => `${v.toFixed(1)}x`} />
        </>
      );
    case 'snow':
      return (
        <>
          <Slider label="Density" value={tools.snowDensity} min={0.05} max={1} step={0.05} onChange={(v) => setTools({ snowDensity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Wind" value={tools.snowWind} min={-1} max={1} step={0.1} onChange={(v) => setTools({ snowWind: v })} format={(v) => (v === 0 ? 'calm' : v < 0 ? `${Math.round(-v * 100)}% left` : `${Math.round(v * 100)}% right`)} />
        </>
      );
    case 'paintball':
      return <Slider label="Splat size" value={tools.paintSize} min={0.5} max={2} step={0.1} onChange={(v) => setTools({ paintSize: v })} format={(v) => `${v.toFixed(1)}x`} />;
    case 'gravity':
      return (
        <Segmented
          value={tools.gravityKind}
          options={[
            { value: 'mixed', label: 'Mixed' },
            { value: 'crates', label: 'Crates' },
            { value: 'balls', label: 'Balls' },
            { value: 'bricks', label: 'Bricks' },
          ]}
          onChange={(v) => setTools({ gravityKind: v })}
        />
      );
    case 'monster':
      return <Slider label="Snacks (fake icons)" value={tools.monsterIcons} min={3} max={16} onChange={(v) => setTools({ monsterIcons: v })} />;
    default:
      return null;
  }
}

export function ArsenalScreen() {
  const { boot, settings, armed, patch } = useStore();
  const run = useAction();
  return (
    <>
      <h1>Arsenal</h1>
      <p className="lead">
        <b>Pick up</b> a weapon to use it with your mouse (the screen becomes clickable until you put it away with <kbd>Esc</kbd> or a right-click). <b>Fire</b>{' '}
        lets it go off on its own. Number keys switch weapons while one is in your hand.
      </p>
      <Card>
        <div className="row spread">
          <Slider label="Intensity" value={settings.intensity} min={0.05} max={1} step={0.05} onChange={(v) => void patch({ intensity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <div className="row">
            {armed && (
              <button className="btn secondary" onClick={() => run(() => api.disarm())}>
                Put it away
              </button>
            )}
            <button className="btn secondary" onClick={() => run(() => api.clear('fade'))}>
              Clear screen
            </button>
          </div>
        </div>
        <p className="muted small">
          Pick-up shortcut: <kbd>{prettyShortcut(settings.armShortcut, boot.platform)}</kbd> picks up the last weapon ({settings.lastTool}).
        </p>
      </Card>
      <div className="arsenal">
        {EFFECTS.map((e) => (
          <section key={e.id} className={`weapon ${armed === e.id ? 'armed' : ''}`}>
            <header>
              <span className="big-icon">{e.icon}</span>
              <div>
                <h3>{e.name}</h3>
                <small className="muted">
                  Key <kbd>{e.key.toUpperCase()}</kbd> · {e.hold ? 'hold to fire' : 'click'}
                </small>
              </div>
            </header>
            <p>{e.blurb}</p>
            <div className="weapon-options">
              <Options id={e.id} />
            </div>
            <div className="row">
              <button className="btn small" onClick={() => run(() => (armed === e.id ? api.disarm() : api.arm(e.id)))}>
                {armed === e.id ? 'Put away' : 'Pick up'}
              </button>
              <button className="btn small secondary" onClick={() => run(() => api.fire(e.id))}>
                Fire
              </button>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
