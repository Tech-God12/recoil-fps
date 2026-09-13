// Recoil FPS — shared VOLT PROTOCOL UI primitives
import { useEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- Chamfered glass panel with glowing corner brackets ---------- */
export function Panel({ children, className = '', bracket = true, pad = 'p-5' }: { children: ReactNode; className?: string; bracket?: boolean; pad?: string }) {
  return (
    <div className={`relative cut panel-bg ${pad} ${className}`}>
      {bracket && (
        <>
          <span className="brk brk-tl" /><span className="brk brk-tr" />
          <span className="brk brk-bl" /><span className="brk brk-br" />
        </>
      )}
      {children}
    </div>
  );
}

/* ---------- Section heading ---------- */
export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <span className="h-3.5 w-1 bg-[var(--acc)] shadow-[0_0_8px_var(--acc)]" />
        <h3 className="text-[11px] tracking-[0.3em] text-white/90 font-bold">{children}</h3>
        <span className="flex-1 h-px bg-gradient-to-r from-[var(--acc)]/40 via-white/10 to-transparent" />
      </div>
      {sub && <p className="mt-1 ml-4 mono text-[9px] text-white/35">{sub}</p>}
    </div>
  );
}

/* ---------- Chamfered button ---------- */
export function CBtn({ children, onClick, variant = 'ghost', className = '', full, disabled }:
{ children: ReactNode; onClick?: () => void; variant?: 'ghost' | 'primary' | 'danger'; className?: string; full?: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`btn btn-${variant} cut-sm ${full ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

/* ---------- Slider with tick marks + live value badge ---------- */
export function Slider({ label, value, min, max, step = 1, unit = '', onChange, hint }:
{ label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; hint?: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  const ticks = [0.25, 0.5, 0.75].map(f => min + (max - min) * f);
  return (
    <div className="setting-row group">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[10px] tracking-[0.2em] text-white/70 group-hover:text-white transition">{label}</span>
          <span className="val-badge">{typeof value === 'number' && step < 1 ? value.toFixed(2) : Math.round(value)}{unit}</span>
        </div>
        <div className="relative h-5 flex items-center">
          <div className="absolute inset-x-0 h-[3px] bg-white/12" />
          <div className="absolute h-[3px] hazard-fill" style={{ width: `${pct}%`, boxShadow: '0 0 10px rgba(255,92,26,.5)' }} />
          {ticks.map(t => (
            <span key={t} className="absolute w-px h-2 bg-white/25" style={{ left: `${((t - min) / (max - min)) * 100}%` }} />
          ))}
          <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(parseFloat(e.target.value))}
            className="tac-range absolute inset-0 w-full"
            aria-label={label}
          />
        </div>
        {hint && <p className="mt-1 text-[9px] text-white/30 tracking-wide">{hint}</p>}
      </div>
    </div>
  );
}

/* ---------- Toggle switch ---------- */
export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="setting-row group cursor-pointer" onClick={() => onChange(!value)} role="switch" aria-checked={value}>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[10px] tracking-[0.2em] text-white/70 group-hover:text-white transition">{label}</span>
          <span className={`tac-toggle ${value ? 'on' : ''}`}><span className="knob" /></span>
        </div>
        {hint && <p className="mt-1 text-[9px] text-white/30 tracking-wide">{hint}</p>}
      </div>
    </div>
  );
}

/* ---------- Segmented option picker ---------- */
export function Segmented<T extends string>({ label, value, options, onChange, hint }:
{ label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <div className="setting-row">
      <div className="flex-1">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <span className="text-[10px] tracking-[0.2em] text-white/70">{label}</span>
          <div className="flex gap-1">
            {options.map(o => (
              <button key={o.v} onClick={() => onChange(o.v)} aria-pressed={value === o.v}
                className={`seg ${value === o.v ? 'seg-on' : ''}`}>{o.l}</button>
            ))}
          </div>
        </div>
        {hint && <p className="mt-1 text-[9px] text-white/30 tracking-wide">{hint}</p>}
      </div>
    </div>
  );
}

/* ---------- Color swatch picker ---------- */
export function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const cols = ['#F06A2E', '#3FD68E', '#E5484D', '#58BFE4', '#FFFFFF', '#E8B93C'];
  return (
    <div className="setting-row">
      <div className="flex-1 flex items-center justify-between gap-4">
        <span className="text-[10px] tracking-[0.2em] text-white/70">{label}</span>
        <div className="flex gap-1.5">
          {cols.map(c => (
            <button key={c} onClick={() => onChange(c)} aria-label={`Crosshair colour ${c}`} aria-pressed={value === c}
              className={`swatch ${value === c ? 'swatch-on' : ''}`}
              style={{ background: c, color: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Animated stat bar ---------- */
export function StatBar({ label, value, max = 100, delay = 0 }: { label: string; value: number; max?: number; delay?: number }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW((value / max) * 100), delay); return () => clearTimeout(t); }, [value, max, delay]);
  return (
    <div className="mb-1.5">
      <div className="flex justify-between mono text-[9px] text-white/45 mb-1"><span>{label}</span><span className="text-white/70">{value}</span></div>
      <div className="h-[4px] bg-white/10 overflow-hidden">
        <div className="h-full hazard-fill transition-all duration-700 ease-out shadow-[0_0_8px_rgba(255,92,26,.6)]" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

/* ---------- Count-up number ---------- */
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

/* ---------- Keycap glyph ---------- */
export function Key({ children }: { children: ReactNode }) {
  return <span className="keycap">{children}</span>;
}

/* ---------- Seamless ticker tape ---------- */
export function Ticker({ children, speed = 26, ...rest }: { children: ReactNode; speed?: number; [key: string]: unknown }) {
  return (
    <div className="ticker" {...rest}>
      <div className="ticker-track" style={{ animationDuration: `${speed}s` }}>
        <div className="flex">{children}</div>
        <div className="flex">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Hexagon chip ---------- */
export function Hex({ children, className = '', accent = false }: { children: ReactNode; className?: string; accent?: boolean }) {
  return (
    <span className={`hex-chip ${accent ? 'hex-on' : ''} ${className}`}>{children}</span>
  );
}
