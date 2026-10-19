// Snow that settles: a column height map along the floor.

export class SnowPile {
  readonly cols: Float32Array;
  readonly colWidth: number;
  maxHeight: number;
  dirty = false;

  constructor(
    readonly width: number,
    colWidth = 8,
    maxHeight = 90,
  ) {
    this.colWidth = colWidth;
    this.maxHeight = maxHeight;
    this.cols = new Float32Array(Math.ceil(width / colWidth) + 1);
  }

  heightAt(x: number): number {
    const i = Math.floor(x / this.colWidth);
    return i < 0 || i >= this.cols.length ? 0 : this.cols[i];
  }

  /** Adds a flake at x. Spreads to a neighbour when the column is taller than it (snow slides). */
  add(x: number, amount = 0.6) {
    let i = Math.floor(x / this.colWidth);
    if (i < 0 || i >= this.cols.length) return;
    for (let guard = 0; guard < 4; guard++) {
      const l = i > 0 ? this.cols[i - 1] : Infinity;
      const r = i < this.cols.length - 1 ? this.cols[i + 1] : Infinity;
      const here = this.cols[i];
      if (here - Math.min(l, r) > 3) i = l < r ? i - 1 : i + 1;
      else break;
    }
    this.cols[i] = Math.min(this.maxHeight, this.cols[i] + amount);
    this.dirty = true;
  }

  /** Shaking flattens the pile a bit. */
  settle(k: number) {
    const c = this.cols;
    for (let i = 1; i < c.length - 1; i++) c[i] = c[i] * (1 - k) + ((c[i - 1] + c[i + 1]) / 2) * k;
    this.dirty = true;
  }

  melt(amount: number) {
    let any = false;
    for (let i = 0; i < this.cols.length; i++) {
      this.cols[i] = Math.max(0, this.cols[i] - amount);
      if (this.cols[i] > 0) any = true;
    }
    this.dirty = true;
    return any;
  }

  get total(): number {
    let t = 0;
    for (const v of this.cols) t += v;
    return t;
  }

  clear() {
    this.cols.fill(0);
    this.dirty = true;
  }
}
