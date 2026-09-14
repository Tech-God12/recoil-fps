// Recoil FPS — rolling-odometer cash display with +/- flashes.
import { useEffect, useRef, useState } from 'react';

export default function CashCounter({ value, className = '' }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState<0 | 1 | -1>(0);
  const fromRef = useRef(value);
  const rafRef = useRef(0);
  const timeoutRef = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    window.clearTimeout(timeoutRef.current);
    if (value === fromRef.current) {
      setDisplay(value);
      return;
    }
    setFlash(value > fromRef.current ? 1 : -1);
    const from = fromRef.current;
    fromRef.current = value;
    const t0 = performance.now();
    const dur = 380;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setDisplay(Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        timeoutRef.current = window.setTimeout(() => setFlash(0), 500);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(timeoutRef.current);
    };
  }, [value]);

  const chars = `$${display.toLocaleString('en-US')}`.split('');
  return (
    <span
      className={`cash-counter mono ${flash === 1 ? 'cash-up' : flash === -1 ? 'cash-down' : ''} ${className}`}
      aria-label={`$${display.toLocaleString('en-US')}`}
    >
      {chars.map((c, i) =>
        /[0-9]/.test(c) ? (
          <span key={i} className="cash-digit" aria-hidden="true">
            <span className="cash-strip" style={{ transform: `translateY(-${Number(c)}em)` }}>
              {'0123456789'.split('').map(d => (
                <i key={d}>{d}</i>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} className="cash-sep">
            {c}
          </span>
        ),
      )}
    </span>
  );
}
