// Number formatting for the widgets. Pure, tested.

export const NA = 'unavailable';

export function bytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return NA;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

/** Splits a value into number and unit, so the number can be big and the unit small. */
export function bytesParts(n: number): [string, string] {
  const [v, u] = bytes(n).split(' ');
  return [v, u];
}

export function bits(bps: number): [string, string] {
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  let v = Math.max(0, bps);
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return [v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1), units[i]];
}

export function rate(bps: number): [string, string] {
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = Math.max(0, bps);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return [v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1), units[i]];
}

export function temp(c: number | null | undefined): string {
  return c === null || c === undefined || !Number.isFinite(c) ? NA : `${Math.round(c)}°C`;
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? NA : `${Math.round(v)}%`;
}

export function ghz(mhz: number | null | undefined): string {
  return mhz ? `${(mhz / 1000).toFixed(2)} GHz` : NA;
}

export function watts(w: number | null | undefined): string {
  return w === null || w === undefined || !Number.isFinite(w) ? NA : `${w < 10 ? w.toFixed(1) : Math.round(w)} W`;
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return v < 10 ? `${v.toFixed(2)} ms` : `${Math.round(v)} ms`;
}

export function duration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}

/** Uptime like the reference widget: total hours, minutes, seconds ("164:59:06"). */
export function uptime(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function hoursMinutes(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs)) return NA;
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Time in an IANA zone; falls back to local time for unknown zones. */
export function timeIn(zone: string, d: Date, hour12: boolean, seconds = false): string {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12 };
  if (seconds) opts.second = '2-digit';
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: zone }).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  }
}

export function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Countdown parts until `target` (ms epoch). */
export function countdown(target: number, now: number): { done: boolean; d: number; h: number; m: number; s: number } {
  const left = Math.max(0, Math.floor((target - now) / 1000));
  return { done: left === 0, d: Math.floor(left / 86400), h: Math.floor((left % 86400) / 3600), m: Math.floor((left % 3600) / 60), s: left % 60 };
}

export function stopwatch(msTotal: number): string {
  const cs = Math.floor(msTotal / 10) % 100;
  const s = Math.floor(msTotal / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
