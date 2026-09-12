// Recoil FPS — shared tactical UI primitives
import { useEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- Chamfered panel with corner brackets ---------- */
export function Panel({ children, className = '', bracket = true, pad = 'p-5' }: { children: ReactNode; className?: string; bracket?: boolean; pad?: string }) {
  return (
    <div className={`relative chamfer panel-bg ${pad} ${className}`}>
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
        <span className="h-3 w-1 bg-[var(--acc)]" />
        <h3 className="text-[11px] tracking-[0.32em] text-white/90 font-bold">{children}</h3>
        <span className="flex-1 h-px bg-gradient-to-r from-white/20 to-transparent" />
      </div>
      {sub && <p className="mt-1 ml-4 text-[9px] tracking-[0.18em] text-white/35">{sub}</p>}
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
      className={`cbtn cbtn-${variant} chamfer-sm ${full ? 'w-full' : ''} ${className}`}
    >
      <span className="cbtn-bar" />
      <span className="relative z-10">{children}</span>
    </button>
  );
}

/* ---------- Slider with live value badge ---------- */
export function Slider({ label, value, min, max, step = 1, unit = '', onChange, hint }:
{ label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; hint?: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="setting-row group">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[10px] tracking-[0.2em] text-white/70 group-hover:text-white transition">{label}</span>
          <span className="val-badge">{typeof value === 'number' && step < 1 ? value.toFixed(2) : Math.round(value)}{unit}</span>
        </div>
        <div className="relative h-5 flex items-center">
          <div className="absolute inset-x-0 h-[3px] bg-white/12 rounded-full" />
          <div className="absolute h-[3px] rounded-full bg-[var(--acc)] shadow-[0_0_10px_var(--acc)]" style={{ width: `${pct}%` }} />
          <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(parseFloat(e.target.value))}
            className="tac-range absolute inset-0 w-full"
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
    <div className="setting-row group cursor-pointer" onClick={() => onChange(!value)}>
      <div className="flex-1">
        <div className="flex items-center justify-between">
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
        <div className="flex items-center justify-between gap-4">
          <span className="text-[10px] tracking-[0.2em] text-white/70">{label}</span>
          <div className="flex gap-1">
            {options.map(o => (
              <button key={o.v} onClick={() => onChange(o.v)} className={`seg chamfer-xs ${value === o.v ? 'seg-on' : ''}`}>{o.l}</button>
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
  const cols = ['#F2A93B', '#00FF88', '#FF3B30', '#FFFFFF', '#37B6FF', '#FF4FD8'];
  return (
    <div className="setting-row">
      <div className="flex-1 flex items-center justify-between">
        <span className="text-[10px] tracking-[0.2em] text-white/70">{label}</span>
        <div className="flex gap-1.5">
          {cols.map(c => (
            <button key={c} onClick={() => onChange(c)}
              className={`w-6 h-6 chamfer-xs border transition ${value === c ? 'border-white scale-110' : 'border-white/20 hover:border-white/60'}`}
              style={{ background: c, boxShadow: value === c ? `0 0 12px ${c}` : 'none' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Stat bar (weapon cards) ---------- */
export function StatBar({ label, value, max = 100, delay = 0 }: { label: string; value: number; max?: number; delay?: number }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW((value / max) * 100), delay); return () => clearTimeout(t); }, [value, max, delay]);
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-[9px] tracking-[0.16em] text-white/45 mb-1"><span>{label}</span><span className="text-white/70">{value}</span></div>
      <div className="h-[3px] bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-[var(--acc)] rounded-full transition-all duration-700 ease-out shadow-[0_0_8px_var(--acc)]" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

/* ---------- Count-up number ---------- */
export function CountUp({ to, dur = 900, suffix = '', delay = 0 }: { to: number; dur?: number; suffix?: string; delay?: number }) {
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
  return <>{n}{suffix}</>;
}

/* ---------- Keycap glyph ---------- */
export function Key({ children }: { children: ReactNode }) {
  return <span className="keycap">{children}</span>;
}
