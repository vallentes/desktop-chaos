import type { EffectId, ToolOptions } from './effects';

/** Something to blow up. Sent by Rust to overlays, or by the overlay to itself when armed. */
export interface FxTrigger {
  effect: EffectId;
  /** Monitor index, or null for "pick one" (chaos picks per event). */
  monitor: number | null;
  /** Normalized 0..1 position on that monitor; null = effect chooses. */
  x: number | null;
  y: number | null;
  intensity: number;
  /** Seconds, for effects that keep going (snow, earthquake, laser, flamethrower...). */
  duration: number | null;
  seed: number;
  source: 'user' | 'chaos' | 'api';
}

export type FxEvent =
  | { type: 'trigger'; seq: number; trigger: FxTrigger }
  | { type: 'clear'; seq: number; mode: 'instant' | 'fade' }
  | { type: 'arm'; seq: number; tool: EffectId }
  | { type: 'disarm'; seq: number }
  | { type: 'countdown'; seq: number; value: number; label: string }
  | { type: 'config'; seq: number; config: OverlayConfig };

export interface OverlayConfig {
  sound: boolean;
  volume: number;
  reducedFlashing: boolean;
  quality: 'auto' | 'low' | 'medium' | 'high';
  particleBudget: number;
  intensity: number;
  toolOptions: ToolOptions;
  stopShortcut: string;
}

export interface MonitorInfo {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

export interface ChaosConfig {
  preset: string;
  effects: EffectId[];
  durationSecs: number;
  intensity: number;
  rate: number;
  sound: boolean;
  countdown: boolean;
  cleanup: 'fade' | 'bomb' | 'keep';
}

export interface ChaosPreset {
  id: string;
  name: string;
  blurb: string;
  config: ChaosConfig;
}

export interface ChaosStatus {
  running: boolean;
  preset: string | null;
  phase: 'idle' | 'countdown' | 'running';
  remainingSecs: number;
  durationSecs: number;
  eventsFired: number;
}

export interface Settings {
  onboarded: boolean;
  launchAtStartup: boolean;
  sound: boolean;
  volume: number;
  reducedFlashing: boolean;
  quality: 'auto' | 'low' | 'medium' | 'high';
  particleBudget: number;
  intensity: number;
  desktopEffects: boolean;
  disabledMonitors: number[];
  stopShortcut: string;
  armShortcut: string;
  lastTool: EffectId;
  toolOptions: ToolOptions;
  chaos: ChaosConfig;
  obsEnabled: boolean;
  apiEnabled: boolean;
  serverPort: number;
  obsMirrorMonitor: number;
  obsMirrorManual: boolean;
  widgetsLocked: boolean;
  widgetsHidden: boolean;
  widgetRefreshMs: number;
  widgetTheme: string;
  customTheme: CustomTheme;
  streamerSafe: boolean;
  latencyLan: boolean;
  latencyWan: boolean;
  latencyWanHost: string;
  activeProfile: number;
}

export interface CustomTheme {
  bg: string;
  fg: string;
  accent: string;
  accent2: string;
  radius: number;
  font: 'inter' | 'rajdhani' | 'mono';
}

export interface ServerStatus {
  running: boolean;
  port: number;
  obsUrl: string;
  apiUrl: string;
  token: string;
  error: string | null;
}

export interface UpdateInfo {
  version: string;
  current: string;
  notes: string | null;
}

export interface Bootstrap {
  settings: Settings;
  version: string;
  platform: 'windows' | 'macos' | 'linux';
  monitors: MonitorInfo[];
  presets: ChaosPreset[];
  chaos: ChaosStatus;
  armed: EffectId | null;
  server: ServerStatus;
  shortcutErrors: string[];
  update: UpdateInfo | null;
}
