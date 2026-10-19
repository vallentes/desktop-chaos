import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../shared/api';
import type { UpdateInfo } from '../shared/types';
import { useStore } from './store';

type Phase = { kind: 'idle' } | { kind: 'checking' } | { kind: 'latest' } | { kind: 'installing'; pct: number | null } | { kind: 'error'; message: string };

function useUpdate() {
  const { boot } = useStore();
  const [update, setUpdate] = useState<UpdateInfo | null>(boot.update);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  useEffect(() => {
    const un = [
      listen<UpdateInfo>('update://available', (e) => setUpdate(e.payload)),
      listen<{ downloaded: number; total: number | null }>('update://progress', (e) =>
        setPhase({ kind: 'installing', pct: e.payload.total ? Math.round((e.payload.downloaded / e.payload.total) * 100) : null }),
      ),
    ];
    return () => un.forEach((p) => void p.then((f) => f()));
  }, []);

  const check = async () => {
    setPhase({ kind: 'checking' });
    try {
      const u = await api.checkForUpdate();
      setUpdate(u);
      setPhase(u ? { kind: 'idle' } : { kind: 'latest' });
    } catch (e) {
      setPhase({ kind: 'error', message: errorMessage(e) });
    }
  };
  const install = async () => {
    setPhase({ kind: 'installing', pct: null });
    try {
      await api.installUpdate();
    } catch (e) {
      setPhase({ kind: 'error', message: errorMessage(e) });
    }
  };
  return { update, phase, check, install };
}

export function UpdateBanner() {
  const { update, phase, install } = useUpdate();
  if (!update) return null;
  return (
    <div className="banner good">
      <div>
        <b>Desktop Chaos {update.version} is out.</b> You have {update.current}. Your settings and layouts are kept.
      </div>
      {phase.kind === 'installing' ? <span>Updating{phase.pct !== null ? ` ${phase.pct}%` : '…'}</span> : <button className="btn" onClick={install}>Update now</button>}
    </div>
  );
}

export function UpdateCheck() {
  const { update, phase, check, install } = useUpdate();
  useEffect(() => {
    const un = listen('update://check-requested', () => void check());
    return () => void un.then((f) => f());
  }, []);
  return (
    <div className="row">
      {update ? (
        <button className="btn" disabled={phase.kind === 'installing'} onClick={install}>
          Update to {update.version}
        </button>
      ) : (
        <button className="btn secondary" disabled={phase.kind === 'checking'} onClick={check}>
          {phase.kind === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
      )}
      {phase.kind === 'latest' && <span className="muted">You have the latest version.</span>}
      {phase.kind === 'installing' && <span className="muted">Installing{phase.pct !== null ? ` ${phase.pct}%` : '…'}</span>}
      {phase.kind === 'error' && <span className="error-text">{phase.message}</span>}
    </div>
  );
}
