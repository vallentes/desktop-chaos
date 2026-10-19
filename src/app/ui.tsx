import { ReactNode } from 'react';

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, format }: { label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <b>{format ? format(value) : value}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function prettyShortcut(s: string, platform: string): string {
  if (!s) return 'not set';
  return s
    .split('+')
    .map((p) => (p === 'CommandOrControl' ? (platform === 'macos' ? 'Cmd' : 'Ctrl') : p === 'Alt' && platform === 'macos' ? 'Option' : p))
    .join(' + ');
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
