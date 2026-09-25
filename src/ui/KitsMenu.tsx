// Recoil FPS — KITS: buy and equip the kit you carry into a game. Full-screen 3-D
// showcase of the selected kit, its details on the left, the three kits as cards
// along the bottom, and the buy/equip action bottom-right. The equipped kit is
// locked in when a game starts; this screen is the only place to change it.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { KIT_DEFS, KIT_IDS, KIT_KEY, type KitId } from '../game/kits';
import { buyKit, equipKit } from '../game/economy/kit-shop';
import type { PlayerProfile } from '../game/economy/profile';
import { audio } from '../game/audio';
import { KitIcon, LockIcon } from './Kits';
import { KitViewer } from './KitViewer';

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

type Toast = { id: number; kind: 'bought' | 'equipped' | 'error'; text: string };

export default function KitsMenu({ profile, onProfile, onBack }: {
  profile: PlayerProfile; onProfile: (p: PlayerProfile) => void; onBack: () => void;
}) {
  const [sel, setSel] = useState<KitId>(profile.equippedKit ?? 'recon');
  const [toast, setToast] = useState<Toast | null>(null);
  const toastId = useRef(0);
  const def = KIT_DEFS[sel];
  const owned = profile.ownedKits.includes(sel);
  const equipped = profile.equippedKit === sel;
  const short = Math.max(0, def.price - profile.cash);

  const flash = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToast({ id, kind, text });
    window.setTimeout(() => setToast(t => (t?.id === id ? null : t)), 2600);
  }, []);

  const act = useCallback(() => {
    if (!owned) {
      const r = buyKit(profile, sel);
      if (!r.ok) {
        flash('error', r.error === 'INSUFFICIENT_FUNDS' ? `You need ${money(short)} more — earn it in games` : 'Purchase failed');
        return;
      }
      onProfile(r.value);
      audio.kitPurchase();
      flash('bought', `${def.name} bought${r.value.equippedKit === sel ? ' and equipped' : ''}`);
      return;
    }
    const r = equipKit(profile, equipped ? null : sel);
    if (!r.ok) return;
    onProfile(r.value);
    audio.kitSelect();
    flash('equipped', equipped ? `${def.name} unequipped — you'll play without a kit` : `${def.name} equipped`);
  }, [def.name, equipped, flash, onProfile, owned, profile, sel, short]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = KIT_IDS.indexOf(sel);
      if (e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); onBack(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); setSel(KIT_IDS[(i + 1) % KIT_IDS.length]); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); setSel(KIT_IDS[(i + KIT_IDS.length - 1) % KIT_IDS.length]); }
      else if (/^Digit[1-5]$/.test(e.code)) setSel(KIT_IDS[Number(e.code.slice(5)) - 1]);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); act(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, onBack, sel]);

  const cta = !owned
    ? short > 0 ? { label: `Need ${money(short)} more`, cls: 'locked' } : { label: `Buy · ${money(def.price)}`, cls: 'buy' }
    : equipped ? { label: 'Equipped', cls: 'equipped' } : { label: 'Equip', cls: 'equip' };

  return (
    <main className={`kits-root kit-${sel}`} aria-labelledby="kits-title">

      <header className="kits-top">
        <button type="button" className="kits-back" onClick={onBack}>
          <span aria-hidden="true">‹</span> Back <span className="keycap">Esc</span>
        </button>
        <h1 id="kits-title" className="kits-title">Kits</h1>
        <span className="kits-sub mono">One kit per game · use it with <span className="keycap">{KIT_KEY}</span></span>
        <div className="kits-wallet" title="Wallet balance">
          <span className="mono">Wallet</span>
          <b className="tabular">{money(profile.cash)}</b>
        </div>
      </header>

      <div className="kits-body">
      <section key={sel} className="kits-info" aria-live="polite">
        <span className="kits-status mono">
          {equipped ? <><i className="dot" />Equipped</> : owned ? 'Owned' : <><LockIcon size={11} /> {money(def.price)}</>}
        </span>
        <h2 className="kits-name">{def.name}</h2>
        <p className="kits-blurb">{def.blurb}</p>
        <div className="kits-stats">
          {def.stats.map((s, i) => (
            <div key={s.label} className="kits-stat" style={{ '--bar': s.bar, animationDelay: `${0.08 + i * 0.06}s` } as CSSProperties}>
              <span className="mono">{s.label}</span>
              <b className="tabular">{s.value}</b>
              <i aria-hidden="true"><em /></i>
            </div>
          ))}
        </div>
        <ol className="kits-steps">
          {def.steps.map((s, i) => <li key={i} style={{ animationDelay: `${0.2 + i * 0.06}s` }}><span>{i + 1}</span>{s}</li>)}
        </ol>
        <p className="kits-rule">{def.rule}</p>
      </section>

      <div className="kits-stage-wrap">
        <KitViewer kit={sel} className="kits-stage" />
        <span className="kits-stage-idx mono" aria-hidden="true">
          <b>{String(KIT_IDS.indexOf(sel) + 1).padStart(2, '0')}</b> / {String(KIT_IDS.length).padStart(2, '0')} · {def.role}
        </span>
        <button type="button" className="kits-arrow prev" aria-label="Previous kit"
          onClick={() => setSel(KIT_IDS[(KIT_IDS.indexOf(sel) + KIT_IDS.length - 1) % KIT_IDS.length])}>‹</button>
        <button type="button" className="kits-arrow next" aria-label="Next kit"
          onClick={() => setSel(KIT_IDS[(KIT_IDS.indexOf(sel) + 1) % KIT_IDS.length])}>›</button>
      </div>
      </div>

      <footer className="kits-bottom">
        <nav className="kits-cards" aria-label="Kits" role="tablist">
          {KIT_IDS.map((id, i) => {
            const d = KIT_DEFS[id];
            const own = profile.ownedKits.includes(id);
            const eq = profile.equippedKit === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={id === sel}
                className={`kits-card kit-${id} ${id === sel ? 'sel' : ''} ${own ? 'owned' : 'locked'}`}
                style={{ animationDelay: `${0.05 + i * 0.06}s` }}
                onClick={() => setSel(id)}>
                <span className="kits-card-key mono">{i + 1}</span>
                <span className="kits-card-icon"><KitIcon id={id} size={24} /></span>
                <span className="kits-card-text">
                  <b>{d.name}</b>
                  <span className="kits-card-tag mono">{eq ? <><i className="dot" />Equipped</> : own ? 'Owned' : <><LockIcon size={10} /> {money(d.price)}</>}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="kits-action">
          <button type="button" className={`kits-cta ${cta.cls}`} onClick={act} disabled={cta.cls === 'locked'}>
            <span>{cta.label}</span>
            {cta.cls !== 'locked' && <span className="keycap">Enter</span>}
          </button>
        </div>
      </footer>

      {toast && (
        <div key={toast.id} className={`kits-toast ${toast.kind}`} role="status">
          {toast.kind !== 'error' && <KitIcon id={sel} size={18} />}
          <span>{toast.text}</span>
        </div>
      )}
    </main>
  );
}
