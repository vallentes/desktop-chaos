import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { api } from '../shared/api';
import { ArsenalScreen } from './screens/Arsenal';
import { ChaosScreen } from './screens/Chaos';
import { DashboardScreen } from './screens/Dashboard';
import { SettingsScreen } from './screens/Settings';
import { StreamerScreen } from './screens/Streamer';
import { SupportScreen } from './screens/Support';
import { WidgetsScreen } from './screens/Widgets';
import { useStore } from './store';
import { prettyShortcut } from './ui';
import { UpdateBanner } from './Update';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◆' },
  { id: 'arsenal', label: 'Arsenal', icon: '🔨' },
  { id: 'chaos', label: 'Chaos Mode', icon: '☄️' },
  { id: 'widgets', label: 'Widgets', icon: '📊' },
  { id: 'streamer', label: 'Streamer', icon: '🎥' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'support', label: 'Support', icon: '☕' },
] as const;

type Section = (typeof SECTIONS)[number]['id'];

export function App() {
  const { boot, settings, error, setError, chaos, armed, patch } = useStore();
  const [section, setSection] = useState<Section>('dashboard');

  useEffect(() => {
    const un = listen<string>('ui://navigate', (e) => {
      if (SECTIONS.some((s) => s.id === e.payload)) setSection(e.payload as Section);
    });
    return () => void un.then((f) => f());
  }, []);

  // Live sensor data only flows while the Widgets screen is open (or widgets are on screen).
  useEffect(() => {
    void api.watchSensors(section === 'widgets');
  }, [section]);

  const busy = chaos.running || armed;

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="" />
          <div>
            <b>DESKTOP CHAOS</b>
            <small>Destroy your desktop. Not your computer.</small>
          </div>
        </div>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`nav ${section === s.id ? 'on' : ''}`} onClick={() => setSection(s.id)}>
            <span className="nav-icon">{s.icon}</span>
            {s.label}
          </button>
        ))}
        <div className="sidebar-foot">
          <button className={`stop ${busy ? 'live' : ''}`} onClick={() => void api.stopEverything()}>
            STOP EVERYTHING
          </button>
          <small>{prettyShortcut(settings.stopShortcut, boot.platform)}</small>
        </div>
      </nav>
      <main className="content">
        <UpdateBanner />
        {!settings.onboarded && (
          <div className="banner">
            <div>
              <b>Welcome!</b> Everything here is drawn on a see-through layer above your screen. Your files, icons and windows are never touched. If anything gets
              out of hand, press <kbd>{prettyShortcut(settings.stopShortcut, boot.platform)}</kbd> or use <b>Stop everything</b> in the tray.
            </div>
            <button className="btn" onClick={() => void patch({ onboarded: true })}>
              Got it
            </button>
          </div>
        )}
        {error && (
          <div className="error-bar" role="alert">
            {error}
            <button className="link" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {section === 'dashboard' && <DashboardScreen go={(s) => setSection(s as Section)} />}
        {section === 'arsenal' && <ArsenalScreen />}
        {section === 'chaos' && <ChaosScreen />}
        {section === 'widgets' && <WidgetsScreen />}
        {section === 'streamer' && <StreamerScreen />}
        {section === 'settings' && <SettingsScreen />}
        {section === 'support' && <SupportScreen />}
      </main>
    </div>
  );
}
