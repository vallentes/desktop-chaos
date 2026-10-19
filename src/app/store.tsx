import { listen } from '@tauri-apps/api/event';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, errorMessage } from '../shared/api';
import { DEFAULT_TOOL_OPTIONS, EffectId, normalizeToolOptions, ToolOptions } from '../shared/effects';
import type { Bootstrap, ChaosStatus, ServerStatus, Settings } from '../shared/types';

interface Store {
  boot: Bootstrap;
  settings: Settings;
  tools: ToolOptions;
  chaos: ChaosStatus;
  armed: EffectId | null;
  server: ServerStatus;
  error: string | null;
  setError(e: string | null): void;
  patch(p: Partial<Settings> | Record<string, unknown>): Promise<void>;
  setTools(p: Partial<ToolOptions>): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [chaos, setChaos] = useState<ChaosStatus | null>(null);
  const [armed, setArmed] = useState<EffectId | null>(null);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const b = await api.bootstrap();
    setBoot(b);
    setSettings(b.settings);
    setChaos(b.chaos);
    setArmed(b.armed);
    setServer(b.server);
  }, []);

  useEffect(() => {
    void refresh();
    const un = [
      listen<Settings>('settings://changed', (e) => setSettings(e.payload)),
      listen<ChaosStatus>('chaos://status', (e) => setChaos(e.payload)),
      listen<EffectId | null>('armed://changed', (e) => setArmed(e.payload)),
      listen<ServerStatus>('server://status', (e) => setServer(e.payload)),
      listen('monitors://changed', () => void refresh()),
    ];
    return () => un.forEach((p) => void p.then((f) => f()));
  }, [refresh]);

  const patch = useCallback(async (p: Partial<Settings> | Record<string, unknown>) => {
    try {
      setSettings(await api.updateSettings(p));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  if (!boot || !settings || !chaos || !server) return <div className="loading">Loading…</div>;
  const tools = normalizeToolOptions(settings.toolOptions as Partial<ToolOptions>);
  const value: Store = {
    boot,
    settings,
    tools,
    chaos,
    armed,
    server,
    error,
    setError,
    patch,
    setTools: (p) => patch({ toolOptions: { ...DEFAULT_TOOL_OPTIONS, ...tools, ...p } }),
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('store missing');
  return s;
}

/** Runs an async action and shows its error, if any, in the app's error bar. */
export function useAction() {
  const { setError } = useStore();
  return useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [setError],
  );
}
