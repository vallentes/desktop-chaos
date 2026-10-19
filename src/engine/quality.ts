// Auto quality: watches frame time and trades particle count for smoothness.

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';

export const LEVELS = [
  { name: 'low', budgetScale: 0.3, spawnScale: 0.45 },
  { name: 'medium', budgetScale: 0.65, spawnScale: 0.75 },
  { name: 'high', budgetScale: 1, spawnScale: 1 },
] as const;

export class QualityController {
  level: number;
  private ema = 16.7;
  private slowFor = 0;
  private fastFor = 0;

  constructor(private setting: QualitySetting = 'auto') {
    this.level = this.fixedLevel() ?? 2;
  }

  configure(setting: QualitySetting) {
    this.setting = setting;
    const f = this.fixedLevel();
    if (f !== null) this.level = f;
  }

  private fixedLevel(): number | null {
    return this.setting === 'low' ? 0 : this.setting === 'medium' ? 1 : this.setting === 'high' ? 2 : null;
  }

  /** Feed one frame's duration in ms. Returns true when the level changed. */
  sample(frameMs: number): boolean {
    if (frameMs > 250) return false; // a stall or a hidden window, not a slow frame
    this.ema = this.ema * 0.92 + frameMs * 0.08;
    if (this.setting !== 'auto') return false;
    if (this.ema > 22) {
      this.slowFor += frameMs;
      this.fastFor = 0;
    } else if (this.ema < 14) {
      this.fastFor += frameMs;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    if (this.slowFor > 1000 && this.level > 0) {
      this.level--;
      this.slowFor = 0;
      return true;
    }
    if (this.fastFor > 5000 && this.level < 2) {
      this.level++;
      this.fastFor = 0;
      return true;
    }
    return false;
  }

  get frameMs() {
    return this.ema;
  }

  budget(base: number) {
    return Math.round(base * LEVELS[this.level].budgetScale);
  }

  get spawnScale() {
    return LEVELS[this.level].spawnScale;
  }
}
