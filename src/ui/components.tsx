// Recoil FPS — shared print-room primitives
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Panel({ children, className = '', bracket = true, pad = 'p-5' }: { children: ReactNode; className?: string; bracket?: boolean; pad?: string }) {
  void bracket;
  return (
    <div className={`relative panel-solid ${pad} ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <span className="h-3 w-1 bg-[var(--brass)]" />
        <h3 className="text-[11px] tracking-[0.18em] text-[var(--bone)] font-bold uppercase" style={{ fontFamily: 'var(--display)' }}>{children}</h3>
        <span className="flex-1 h-px bg-[var(--line)]" />
      </div>
      {sub && <p className="mt-1.5 ml-4 text-[12px] leading-relaxed text-[var(--bone-dim)]">{sub}</p>}
    </div>
  );
}

export function CBtn({ children, onClick, variant = 'ghost', className = '', full, disabled }:
{ children: ReactNode; onClick?: () => void; variant?: 'ghost' | 'primary' | 'danger'; className?: string; full?: boolean; disabled?: boolean }) {
  const base = variant === 'primary' ? 'btn btn-primary' : variant === 'danger' ? 'btn btn-ghost !text-[var(--blood)] !border-[rgba(200,50,30,0.25)] hover:!bg-[rgba(200,50,30,0.08)]' : 'btn btn-ghost';
  return (
    <button disabled={disabled} onClick={onClick} className={`${base} ${full ? 'w-full' : ''} ${className}`}>
      {children}
    </button>
  );
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange, hint }:
{ label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; hint?: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="setting-row group">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[12px] font-medium text-[var(--bone)]">{label}</span>
          <span className="val-badge tabular">{step < 1 ? value.toFixed(2) : Math.round(value)}{unit}</span>
        </div>
        <div className="relative h-5 flex items-center">
          <div className="absolute inset-x-0 h-[2px] bg-[rgba(237,228,211,0.14)] rounded-full" />
          <div className="absolute h-[2px] bg-[var(--brass)] rounded-full" style={{ width: `${pct}%` }} />
          <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="tac-range absolute inset-0 w-full" aria-label={label} />
        </div>
        {hint && <p className="mt-1.5 text-[12px] leading-snug text-[var(--bone-dim)]">{hint}</p>}
      </div>
    </div>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="setting-row group cursor-pointer" onClick={() => onChange(!value)} role="switch" aria-checked={value}>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[12px] font-medium text-[var(--bone)]">{label}</span>
          <span className={`tac-toggle ${value ? 'on' : ''}`}><span className="knob" /></span>
        </div>
        {hint && <p className="mt-1.5 text-[12px] leading-snug text-[var(--bone-dim)]">{hint}</p>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange, hint }:
{ label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <div className="setting-row">
      <div className="flex-1">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <span className="text-[12px] font-medium text-[var(--bone)]">{label}</span>
          <div className="flex">
            {options.map(o => (
              <button key={o.v} onClick={() => onChange(o.v)} aria-pressed={value === o.v} className={`seg ${value === o.v ? 'seg-on' : ''}`}>{o.l}</button>
            ))}
          </div>
        </div>
        {hint && <p className="mt-1.5 text-[12px] leading-snug text-[var(--bone-dim)]">{hint}</p>}
      </div>
    </div>
  );
}

export function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const cols = ['#EDE4D3', '#C89B5A', '#FF4D00', '#7A7A52', '#C8321E', '#8B93A0'];
  return (
    <div className="setting-row">
      <div className="flex-1 flex items-center justify-between gap-4">
        <span className="text-[12px] font-medium text-[var(--bone)]">{label}</span>
        <div className="flex gap-1.5">
          {cols.map(c => (
            <button key={c} onClick={() => onChange(c)} aria-label={`Crosshair colour ${c}`} aria-pressed={value === c} className={`swatch ${value === c ? 'swatch-on' : ''}`} style={{ background: c, color: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatBar({ label, value, max = 100, delay = 0 }: { label: string; value: number; max?: number; delay?: number }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW((value / max) * 100), delay); return () => clearTimeout(t); }, [value, max, delay]);
  return (
    <div className="mb-2">
      <div className="flex justify-between text-[11px] mb-1"><span className="tracking-[0.06em] text-[var(--bone-mute)] uppercase" style={{ fontFamily: 'var(--mono)' }}>{label}</span><span className="tabular text-[var(--bone)]">{value}</span></div>
      <div className="h-[3px] bg-[rgba(237,228,211,0.08)] overflow-hidden rounded-full">
        <div className="h-full bg-[var(--brass)] transition-all duration-700 ease-out" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

export function CountUp({ to, dur = 900, suffix = '', delay = 0, format }: { to: number; dur?: number; suffix?: string; delay?: number; format?: (n: number) => string }) {
  const [n, setN] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    let start = 0;
    const timer = setTimeout(() => {
      const tick = (t: number) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / dur);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf.current); };
  }, [to, dur, delay]);
  return <>{format ? format(n) : n}{suffix}</>;
}

export function Key({ children }: { children: ReactNode }) {
  return <span className="keycap">{children}</span>;
}

export function Ticker({ children, speed: _speed = 26, ...rest }: { children: ReactNode; speed?: number; [key: string]: unknown }) {
  return (
    <div className="hidden" {...rest}>
      <div className="flex gap-6 opacity-0">{children}</div>
    </div>
  );
}

export function Hex({ children, className = '', accent = false }: { children: ReactNode; className?: string; accent?: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-1 text-[10px] tracking-[0.08em] uppercase border rounded-full ${accent ? 'bg-[var(--brass)] text-[var(--ink)] border-[var(--brass)]' : 'bg-[var(--ink)] text-[var(--bone-mute)] border-[var(--line)]'} ${className}`}>{children}</span>
  );
}
