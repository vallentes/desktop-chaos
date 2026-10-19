// The arsenal. Ids must match EFFECTS in src-tauri/src/fx.rs (a test checks this).

export const EFFECT_IDS = [
  'hammer',
  'machinegun',
  'flamethrower',
  'water',
  'lightning',
  'meteor',
  'blackhole',
  'monster',
  'gravity',
  'glass',
  'paintball',
  'snow',
  'earthquake',
  'laser',
  'bomb',
] as const;

export type EffectId = (typeof EFFECT_IDS)[number];

export interface EffectInfo {
  id: EffectId;
  name: string;
  icon: string;
  blurb: string;
  /** Hold the mouse button to keep firing. */
  hold: boolean;
  /** Keyboard key that selects it while armed. */
  key: string;
}

export const EFFECTS: EffectInfo[] = [
  { id: 'hammer', name: 'Hammer', icon: '🔨', blurb: 'Crack the glass. Keep hitting the same spot and the cracks grow.', hold: false, key: '1' },
  { id: 'machinegun', name: 'Machine Gun', icon: '🔫', blurb: 'Hold to spray bullet holes. Fire rate is up to you.', hold: true, key: '2' },
  { id: 'flamethrower', name: 'Flamethrower', icon: '🔥', blurb: 'Fire, smoke and sparks. Flames spread and leave burn marks.', hold: true, key: '3' },
  { id: 'water', name: 'Water Cannon', icon: '💧', blurb: 'Blast water. Puts out every fire it touches.', hold: true, key: '4' },
  { id: 'lightning', name: 'Lightning', icon: '⚡', blurb: 'Branching bolts with a flash. Respects reduced flashing.', hold: false, key: '5' },
  { id: 'meteor', name: 'Meteor', icon: '☄️', blurb: 'A burning rock with a trail, a shockwave and a crater.', hold: false, key: '6' },
  { id: 'blackhole', name: 'Black Hole', icon: '🕳️', blurb: 'Pulls in every particle, shard and object nearby.', hold: false, key: '7' },
  { id: 'monster', name: 'Monster', icon: '👾', blurb: 'A hungry critter that eats drawn fake icons. Your real ones are safe.', hold: false, key: '8' },
  { id: 'gravity', name: 'Gravity Objects', icon: '📦', blurb: 'Crates, balls and bricks that fall, bounce and pile up.', hold: false, key: '9' },
  { id: 'glass', name: 'Broken Glass', icon: '🪟', blurb: 'Shatter the screen into shards that fall with real physics.', hold: false, key: '0' },
  { id: 'paintball', name: 'Paintball', icon: '🎨', blurb: 'Neon splats that drip and stay until you clear them.', hold: false, key: 'q' },
  { id: 'snow', name: 'Snowstorm', icon: '❄️', blurb: 'Snow that piles up at the bottom of the screen.', hold: false, key: 'w' },
  { id: 'earthquake', name: 'Earthquake', icon: '🌋', blurb: 'Shakes the overlay, drops dust and opens cracks. Real windows stay put.', hold: false, key: 'e' },
  { id: 'laser', name: 'Laser', icon: '🔆', blurb: 'A beam that follows the mouse and burns a trail.', hold: true, key: 'r' },
  { id: 'bomb', name: 'Reset Bomb', icon: '💣', blurb: 'One last explosion, then everything is gone.', hold: false, key: 't' },
];

export const EFFECT_BY_ID: Record<EffectId, EffectInfo> = Object.fromEntries(EFFECTS.map((e) => [e.id, e])) as Record<EffectId, EffectInfo>;

export function isEffectId(v: unknown): v is EffectId {
  return typeof v === 'string' && (EFFECT_IDS as readonly string[]).includes(v);
}

export const LASER_COLORS = ['red', 'green', 'blue', 'purple', 'rainbow'] as const;
export type LaserColor = (typeof LASER_COLORS)[number];

/** Per-tool options set in the Arsenal. Rust stores this blob as-is. */
export interface ToolOptions {
  fireRate: number; // machine gun rounds per minute
  laserColor: LaserColor;
  laserWidth: number;
  snowDensity: number; // 0..1
  snowWind: number; // -1..1
  paintSize: number; // 0.5..2
  gravityKind: 'mixed' | 'crates' | 'balls' | 'bricks';
  monsterIcons: number;
  hammerPower: number; // 0.5..2
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  fireRate: 600,
  laserColor: 'red',
  laserWidth: 1,
  snowDensity: 0.5,
  snowWind: 0.2,
  paintSize: 1,
  gravityKind: 'mixed',
  monsterIcons: 8,
  hammerPower: 1,
};

export function normalizeToolOptions(v: Partial<ToolOptions> | null | undefined): ToolOptions {
  const o = { ...DEFAULT_TOOL_OPTIONS, ...(v ?? {}) };
  const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
  return {
    fireRate: clamp(o.fireRate, 60, 1200, DEFAULT_TOOL_OPTIONS.fireRate),
    laserColor: (LASER_COLORS as readonly string[]).includes(o.laserColor) ? o.laserColor : 'red',
    laserWidth: clamp(o.laserWidth, 0.5, 3, 1),
    snowDensity: clamp(o.snowDensity, 0.05, 1, 0.5),
    snowWind: clamp(o.snowWind, -1, 1, 0.2),
    paintSize: clamp(o.paintSize, 0.5, 2, 1),
    gravityKind: ['mixed', 'crates', 'balls', 'bricks'].includes(o.gravityKind) ? o.gravityKind : 'mixed',
    monsterIcons: Math.round(clamp(o.monsterIcons, 3, 16, 8)),
    hammerPower: clamp(o.hammerPower, 0.5, 2, 1),
  };
}
