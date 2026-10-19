import { useState } from 'react';
import { api } from '../../shared/api';
import { useAction, useStore } from '../store';
import { Card, Toggle } from '../ui';

function Copy({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small secondary"
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export function StreamerScreen() {
  const { boot, settings, server, patch } = useStore();
  const run = useAction();
  const [showToken, setShowToken] = useState(false);
  const [port, setPort] = useState(String(settings.serverPort));

  const example = `{"cmd":"trigger_effect","effect":"meteor","x":0.5,"y":0.6,"intensity":0.9}`;
  const curl = `curl -X POST http://127.0.0.1:${server.port}/api/command -H "Authorization: Bearer ${showToken ? server.token : '<token>'}" -d '{"cmd":"start_chaos","preset":"apocalypse"}'`;

  return (
    <>
      <h1>Streamer</h1>
      <p className="lead">Show the chaos on stream, and let bots, Stream Deck or chat commands set it off. Everything stays on this computer (127.0.0.1).</p>

      <Card title="OBS overlay">
        <Toggle
          checked={settings.obsEnabled}
          onChange={(v) => void patch({ obsEnabled: v })}
          label="Serve the OBS browser source"
          hint="Add a Browser Source in OBS with this URL, size 1920x1080. Effects from Chaos Mode and the API appear there."
        />
        {settings.obsEnabled && (
          <div className="stack">
            <div className="row">
              <code className="url">{server.obsUrl}</code>
              <Copy value={server.obsUrl} />
            </div>
            <Toggle checked={settings.obsMirrorManual} onChange={(v) => void patch({ obsMirrorManual: v })} label="Mirror what I smash by hand" hint="Your clicks on the chosen screen also show up in OBS." />
            <label className="field">
              <span>Screen to mirror</span>
              <select value={settings.obsMirrorMonitor} onChange={(e) => void patch({ obsMirrorMonitor: Number(e.target.value) })}>
                {boot.monitors.map((m) => (
                  <option key={m.index} value={m.index}>
                    {m.index + 1}: {m.name} {m.primary ? '(main)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <Toggle
              checked={settings.desktopEffects}
              onChange={(v) => void patch({ desktopEffects: v })}
              label="Also show effects on my own screen"
              hint="Turn off to keep the chaos on stream only."
            />
          </div>
        )}
      </Card>

      <Card title="Control API (WebSocket)">
        <Toggle
          checked={settings.apiEnabled}
          onChange={(v) => void patch({ apiEnabled: v })}
          label="Allow local apps to control Desktop Chaos"
          hint="Off by default. Only programs on this computer can connect, and they need the token below."
        />
        {settings.apiEnabled && (
          <div className="stack">
            <div className="row">
              <code className="url">{server.apiUrl}?token=…</code>
              <Copy value={`${server.apiUrl}?token=${server.token}`} label="Copy URL with token" />
            </div>
            <div className="row">
              <code className="url">{showToken ? server.token : '•'.repeat(24)}</code>
              <button className="btn small secondary" onClick={() => setShowToken((s) => !s)}>
                {showToken ? 'Hide' : 'Show'}
              </button>
              <Copy value={server.token} label="Copy token" />
              <button className="btn small secondary" onClick={() => run(() => api.regenerateToken())}>
                New token
              </button>
            </div>
            <details>
              <summary>Commands</summary>
              <table className="api-table">
                <tbody>
                  <tr>
                    <td><code>trigger_effect</code></td>
                    <td>effect, optional x and y (0 to 1), intensity (0 to 1), duration (seconds), monitor</td>
                  </tr>
                  <tr>
                    <td><code>clear_effects</code></td>
                    <td>optional fade (true/false)</td>
                  </tr>
                  <tr>
                    <td><code>start_chaos</code></td>
                    <td>optional preset (mild, gamer-rage, apocalypse, total, random), duration, intensity, effects</td>
                  </tr>
                  <tr>
                    <td><code>stop_chaos</code></td>
                    <td>no arguments</td>
                  </tr>
                  <tr>
                    <td><code>set_intensity</code></td>
                    <td>value (0 to 1)</td>
                  </tr>
                  <tr>
                    <td><code>get_status</code></td>
                    <td>returns chaos state, intensity, effects and presets</td>
                  </tr>
                </tbody>
              </table>
              <p className="muted small">Send JSON over the WebSocket, for example:</p>
              <pre>{example}</pre>
              <p className="muted small">Or over HTTP:</p>
              <pre>{curl}</pre>
              <p className="muted small">Add an "id" field to match replies. Up to 20 commands per second.</p>
            </details>
          </div>
        )}
      </Card>

      <Card title="Port">
        <div className="row">
          <input className="input" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))} />
          <button className="btn small secondary" disabled={Number(port) === settings.serverPort} onClick={() => void patch({ serverPort: Number(port) })}>
            Apply
          </button>
          <span className={server.running ? 'good' : 'muted'}>{server.running ? `Running on 127.0.0.1:${server.port}` : 'Not running'}</span>
        </div>
        {server.error && <p className="error-text">{server.error}</p>}
      </Card>

      <Card title="Streamer-safe widgets">
        <Toggle checked={settings.streamerSafe} onChange={(v) => void patch({ streamerSafe: v })} label="Hide IP addresses, computer name and process names" hint="Applies to every widget right away." />
      </Card>
    </>
  );
}
