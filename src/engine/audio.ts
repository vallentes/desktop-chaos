// Every sound is synthesized here with Web Audio. No sample files, nothing borrowed.

export type Sfx =
  | 'hammer'
  | 'glass'
  | 'gun'
  | 'whoosh'
  | 'splash'
  | 'thunder'
  | 'meteor'
  | 'boom'
  | 'blackhole'
  | 'chomp'
  | 'thud'
  | 'splat'
  | 'rumble'
  | 'zap'
  | 'fuse'
  | 'beep'
  | 'pop';

export type Loop = 'fire' | 'water' | 'wind' | 'laser' | 'hiss';

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private loops = new Map<Loop, { stop: () => void; gain: GainNode }>();
  private voices = 0;
  enabled = true;
  volume = 0.6;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // A compressor keeps a meteor shower from clipping.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.stopAll();
  }

  stopAll() {
    for (const l of this.loops.values()) l.stop();
    this.loops.clear();
  }

  private noiseSrc(ctx: AudioContext) {
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    return s;
  }

  private env(ctx: AudioContext, peak: number, attack: number, decay: number, t0 = ctx.currentTime) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    return g;
  }

  /** Noise through a filter with an envelope. */
  private burst(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, freqEnd?: number) {
    const t = ctx.currentTime;
    const src = this.noiseSrc(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    f.Q.value = q;
    const g = this.env(ctx, peak, attack, decay);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + attack + decay + 0.05);
  }

  private tone(ctx: AudioContext, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay);
    const g = this.env(ctx, peak, attack, decay, t);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  play(sfx: Sfx, intensity = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    // Cap overlapping one-shots so machine gun spam stays a sound, not a wall.
    if (this.voices > 24) return;
    this.voices++;
    window.setTimeout(() => this.voices--, 250);
    const k = Math.min(1, Math.max(0.2, intensity));
    switch (sfx) {
      case 'hammer':
        this.tone(ctx, 'sine', 140, 50, 0.9 * k, 0.003, 0.18);
        this.burst(ctx, 'bandpass', 2500, 1.2, 0.5 * k, 0.002, 0.08);
        this.glassTinkle(ctx, k * 0.6);
        break;
      case 'glass':
        this.burst(ctx, 'highpass', 3000, 0.7, 0.7 * k, 0.002, 0.35);
        this.glassTinkle(ctx, k);
        break;
      case 'gun':
        this.burst(ctx, 'lowpass', 3500, 0.8, 0.8 * k, 0.001, 0.09, 600);
        this.tone(ctx, 'square', 160, 45, 0.25 * k, 0.001, 0.06);
        break;
      case 'whoosh':
        this.burst(ctx, 'bandpass', 400, 0.8, 0.4 * k, 0.08, 0.5, 1800);
        break;
      case 'splash':
        this.burst(ctx, 'bandpass', 1400, 1.5, 0.4 * k, 0.01, 0.3, 500);
        break;
      case 'thunder':
        this.burst(ctx, 'highpass', 2000, 0.5, 0.6 * k, 0.001, 0.12);
        this.burst(ctx, 'lowpass', 300, 0.7, 1.0 * k, 0.05, 2.4, 60);
        break;
      case 'meteor':
        this.burst(ctx, 'bandpass', 2000, 1, 0.35 * k, 0.3, 0.6, 300);
        break;
      case 'boom':
        this.tone(ctx, 'sine', 90, 28, 1.0 * k, 0.005, 1.2);
        this.burst(ctx, 'lowpass', 1200, 0.6, 1.0 * k, 0.003, 1.6, 80);
        break;
      case 'blackhole':
        this.tone(ctx, 'sawtooth', 70, 25, 0.25 * k, 0.6, 2.5);
        this.tone(ctx, 'sine', 300, 40, 0.3 * k, 0.4, 2.5);
        break;
      case 'chomp':
        this.tone(ctx, 'square', 220, 90, 0.25 * k, 0.005, 0.08);
        this.burst(ctx, 'bandpass', 900, 2, 0.4 * k, 0.003, 0.07);
        this.tone(ctx, 'square', 180, 80, 0.2 * k, 0.005, 0.08, 0.12);
        break;
      case 'thud':
        this.tone(ctx, 'sine', 110, 45, 0.6 * k, 0.003, 0.15);
        break;
      case 'splat':
        this.burst(ctx, 'lowpass', 900, 1, 0.6 * k, 0.003, 0.12, 200);
        this.tone(ctx, 'sine', 300, 90, 0.2 * k, 0.002, 0.06);
        break;
      case 'rumble':
        this.burst(ctx, 'lowpass', 140, 0.8, 1.0 * k, 0.4, 2.5, 50);
        break;
      case 'zap':
        this.tone(ctx, 'sawtooth', 1800, 200, 0.2 * k, 0.002, 0.12);
        break;
      case 'fuse':
        this.burst(ctx, 'highpass', 5000, 0.5, 0.15 * k, 0.05, 0.3);
        break;
      case 'beep':
        this.tone(ctx, 'square', 880, 880, 0.15 * k, 0.005, 0.12);
        break;
      case 'pop':
        this.tone(ctx, 'sine', 600, 200, 0.25 * k, 0.002, 0.07);
        break;
    }
  }

  private glassTinkle(ctx: AudioContext, k: number) {
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const f = 2800 + Math.random() * 4200;
      this.tone(ctx, 'sine', f, f * 0.97, 0.08 * k, 0.001, 0.15 + Math.random() * 0.3, i * 0.03 + Math.random() * 0.05);
    }
  }

  /** Starts or updates a continuous sound. Level 0 stops it. */
  loop(kind: Loop, level: number) {
    const existing = this.loops.get(kind);
    if (level <= 0) {
      existing?.stop();
      this.loops.delete(kind);
      return;
    }
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const target = Math.min(1, level) * (kind === 'laser' ? 0.12 : 0.35);
    if (existing) {
      existing.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
    gain.connect(this.master);
    const nodes: AudioScheduledSourceNode[] = [];
    if (kind === 'laser') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 110;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 880;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      o.connect(f).connect(gain);
      o2.connect(gain);
      nodes.push(o, o2);
    } else {
      const src = this.noiseSrc(ctx);
      const f = ctx.createBiquadFilter();
      const spec: Record<Exclude<Loop, 'laser'>, [BiquadFilterType, number, number]> = {
        fire: ['lowpass', 700, 0.7],
        water: ['bandpass', 1600, 0.6],
        wind: ['bandpass', 500, 0.4],
        hiss: ['highpass', 4000, 0.4],
      };
      const [t, fr, q] = spec[kind];
      f.type = t;
      f.frequency.value = fr;
      f.Q.value = q;
      src.connect(f).connect(gain);
      nodes.push(src);
    }
    nodes.forEach((n) => n.start());
    const stop = () => {
      gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
      window.setTimeout(() => {
        nodes.forEach((n) => {
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        });
        gain.disconnect();
      }, 400);
    };
    this.loops.set(kind, { stop, gain });
  }
}
