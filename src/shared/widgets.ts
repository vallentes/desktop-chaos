// Mirrors src-tauri/src/widgets.rs and sensors/mod.rs.

export type WidgetKind =
  | 'clock'
  | 'cpu'
  | 'gpu'
  | 'ram'
  | 'network'
  | 'disk'
  | 'battery'
  | 'board'
  | 'processes'
  | 'worldclock'
  | 'analog'
  | 'countdown'
  | 'stopwatch'
  | 'text';

export interface WidgetMeta {
  kind: WidgetKind;
  name: string;
  blurb: string;
  sensors: boolean;
}

export const WIDGET_KINDS: WidgetMeta[] = [
  { kind: 'clock', name: 'Clock', blurb: 'Time, day, date and system uptime.', sensors: true },
  { kind: 'cpu', name: 'CPU Load', blurb: 'Per-core load, clock, temperature and power.', sensors: true },
  { kind: 'gpu', name: 'GPU Load', blurb: 'Load, VRAM, temperature, fan and power.', sensors: true },
  { kind: 'ram', name: 'RAM Usage', blurb: 'Used, free, module type and speed.', sensors: true },
  { kind: 'network', name: 'Network', blurb: 'Upload and download speed, latency graph.', sensors: true },
  { kind: 'disk', name: 'Disk', blurb: 'Read/write speed, per-drive usage and temperature.', sensors: true },
  { kind: 'battery', name: 'Battery', blurb: 'Charge, status, time left and power draw.', sensors: true },
  { kind: 'board', name: 'Motherboard', blurb: 'Fans, temperatures and voltages.', sensors: true },
  { kind: 'processes', name: 'Processes', blurb: 'Top processes by CPU and memory.', sensors: true },
  { kind: 'worldclock', name: 'World Clocks', blurb: 'Time in the cities you pick.', sensors: false },
  { kind: 'analog', name: 'Analog Clock', blurb: 'A classic clock face.', sensors: false },
  { kind: 'countdown', name: 'Countdown', blurb: 'Counts down to a date and time.', sensors: false },
  { kind: 'stopwatch', name: 'Stopwatch', blurb: 'Start, pause, reset.', sensors: false },
  { kind: 'text', name: 'Custom Text', blurb: 'Any text you like.', sensors: false },
];

export interface Widget {
  id: number;
  profileId: number;
  kind: WidgetKind;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  level: 'top' | 'desktop' | 'normal';
  clickThrough: boolean;
  visible: boolean;
  config: Record<string, unknown>;
}

export interface Profile {
  id: number;
  name: string;
  widgets: number;
}

export interface WidgetsState {
  widgets: Widget[];
  profiles: Profile[];
  editMode: boolean;
}

export interface Reading {
  label: string;
  value: number;
}

export interface Snapshot {
  at: number;
  host: string | null;
  os: string;
  uptimeSecs: number;
  cpu: { name: string; vendor: string; usage: number; cores: number[]; physicalCores: number | null; freqMhz: number | null; tempC: number | null; powerW: number | null };
  memory: { total: number; used: number; available: number; swapTotal: number; swapUsed: number; modules: string | null; maker: string | null; tempC: number | null };
  gpus: {
    name: string;
    vendor: string;
    usage: number | null;
    usage3d: number | null;
    videoDecode: number | null;
    vramTotal: number | null;
    vramUsed: number | null;
    tempC: number | null;
    hotspotC: number | null;
    fanRpm: number | null;
    fanPct: number | null;
    powerW: number | null;
    clockMhz: number | null;
  }[];
  disks: { name: string; mount: string; kind: string; total: number; available: number; readBps: number; writeBps: number; tempC: number | null }[];
  net: { iface: string | null; kind: string | null; upBps: number; downBps: number; ips: string[]; lanMs: number | null; wanMs: number | null };
  battery: { percent: number; state: string; timeLeftSecs: number | null; powerW: number | null; healthPct: number | null } | null;
  board: { name: string | null; chip: string | null; fans: Reading[]; temps: Reading[]; voltages: Reading[] };
  processes: { name: string; pid: number; cpu: number; mem: number }[];
  sources: string[];
  notes: string[];
  streamerSafe: boolean;
}

export const THEMES = [
  { id: 'gaming', name: 'Gaming' },
  { id: 'dark', name: 'Minimal Dark' },
  { id: 'white', name: 'Minimal White' },
  { id: 'cyberpunk', name: 'Cyberpunk' },
  { id: 'rgb', name: 'Gaming RGB' },
  { id: 'professional', name: 'Professional' },
  { id: 'custom', name: 'Custom' },
] as const;
