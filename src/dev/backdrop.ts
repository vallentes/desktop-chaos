// A made-up desktop backdrop for README media (never a real screen).

/** A made-up desktop: wallpaper, one generic app window, a taskbar. */
export function backdrop(W = 960, H = 540, TASKBAR = 34): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, W, H);
  sky.addColorStop(0, '#1b2a6b');
  sky.addColorStop(0.55, '#3a1f6e');
  sky.addColorStop(1, '#0d1030');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  for (const [x, y, r, col] of [
    [760, 120, 260, '#5b7cff33'],
    [180, 430, 220, '#ff5ac833'],
    [520, 300, 180, '#3ad6ff22'],
  ] as const) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, '#00000000');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }
  // App window.
  const wx = 300;
  const wy = 70;
  const ww = 520;
  const wh = 330;
  g.fillStyle = '#00000055';
  g.fillRect(wx + 6, wy + 8, ww, wh);
  g.fillStyle = '#f5f6f8';
  g.fillRect(wx, wy, ww, wh);
  g.fillStyle = '#e3e6eb';
  g.fillRect(wx, wy, ww, 28);
  for (const [i, col] of ['#ff5f57', '#febc2e', '#28c840'].entries()) {
    g.fillStyle = col;
    g.beginPath();
    g.arc(wx + 16 + i * 18, wy + 14, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#eceff3';
  g.fillRect(wx, wy + 28, 120, wh - 28);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = '#c9ced6';
    g.fillRect(wx + 14, wy + 48 + i * 26, 80 - (i % 3) * 14, 8);
  }
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i === 0 ? '#2b3340' : '#b7bec9';
    g.fillRect(wx + 140, wy + 50 + i * 28, i === 0 ? 200 : 330 - (i % 4) * 45, i === 0 ? 14 : 8);
  }
  g.fillStyle = '#4f7cff';
  g.fillRect(wx + 140, wy + wh - 50, 110, 28);
  // Taskbar.
  g.fillStyle = '#10131bdd';
  g.fillRect(0, H - TASKBAR, W, TASKBAR);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = ['#4f7cff', '#ffb547', '#3ad68a', '#ff5a7a', '#a77bff', '#5ad1ff'][i];
    g.beginPath();
    g.roundRect(W / 2 - 110 + i * 38, H - TASKBAR + 7, 22, 20, 5);
    g.fill();
  }
  g.fillStyle = '#d6dbe4';
  g.font = '12px Segoe UI, sans-serif';
  g.fillText('12:00', W - 52, H - 12);
  return c;
}

