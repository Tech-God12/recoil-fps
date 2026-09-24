// Recoil FPS — KITS: the field-kit shop and equip screen, reached from the home menu
// (and from the deploy screens' "Field kit" button). Three kits, bought once with
// match cash, one equipped at a time. The equipped kit is locked in when a game
// starts; this screen is the only place to change it.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { KIT_DEFS, KIT_IDS, KIT_KEY, KIT_TUNING, type KitId } from '../game/kits';
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
        flash('error', r.error === 'INSUFFICIENT_FUNDS' ? `NEED ${money(short)} MORE — EARN IT IN MATCHES` : 'PURCHASE FAILED');
        return;
      }
      onProfile(r.value);
      audio.kitPurchase();
      flash('bought', `${def.name} PURCHASED${r.value.equippedKit === sel ? ' · EQUIPPED' : ''}`);
      return;
    }
    const r = equipKit(profile, equipped ? null : sel);
    if (!r.ok) return;
    onProfile(r.value);
    audio.kitSelect();
    flash('equipped', equipped ? `${def.name} UNEQUIPPED — DEPLOYING WITHOUT A KIT` : `${def.name} EQUIPPED`);
  }, [def.name, equipped, flash, onProfile, owned, profile, sel, short]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = KIT_IDS.indexOf(sel);
      if (e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); onBack(); }
      else if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'KeyD' || e.code === 'KeyS') { e.preventDefault(); setSel(KIT_IDS[(i + 1) % KIT_IDS.length]); }
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA' || e.code === 'KeyW') { e.preventDefault(); setSel(KIT_IDS[(i + KIT_IDS.length - 1) % KIT_IDS.length]); }
      else if (/^Digit[1-3]$/.test(e.code)) setSel(KIT_IDS[Number(e.code.slice(5)) - 1]);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); act(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, onBack, sel]);

  const cta = !owned
    ? { label: short > 0 ? `NEED ${money(short)} MORE` : `BUY · ${money(def.price)}`, cls: short > 0 ? 'locked' : 'buy' }
    : equipped ? { label: 'EQUIPPED · UNEQUIP', cls: 'equipped' } : { label: 'EQUIP', cls: 'equip' };

  return (
    <main className={`kits-root kit-${sel}`} aria-labelledby="kits-title">
      <div className="kits-bg" aria-hidden="true"><i className="kits-grid" /><i className="kits-glow" /></div>

      <header className="kits-top">
        <button type="button" className="kits-back" onClick={onBack}><span aria-hidden="true">‹</span> BACK <span className="keycap">Esc</span></button>
        <div className="kits-titleblock">
          <span className="kits-eyebrow mono">FIELD ABILITIES · ACTIVATE WITH <span className="keycap">{KIT_KEY}</span></span>
          <h1 id="kits-title" className="kits-title">Kits</h1>
        </div>
        <div className="kits-wallet" title="Wallet balance">
          <span className="mono">WALLET</span>
          <b className="tabular">{money(profile.cash)}</b>
        </div>
      </header>

      <div className="kits-body">
        <nav className="kits-list" aria-label="Field kits" role="tablist">
          {KIT_IDS.map((id, i) => {
            const d = KIT_DEFS[id];
            const own = profile.ownedKits.includes(id);
            const eq = profile.equippedKit === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={id === sel}
                className={`kits-card kit-${id} ${id === sel ? 'sel' : ''} ${own ? 'owned' : 'locked'} ${eq ? 'eq' : ''}`}
                style={{ animationDelay: `${0.06 + i * 0.06}s` }}
                onClick={() => setSel(id)} onMouseEnter={() => setSel(id)}>
                <span className="kits-card-idx mono">0{i + 1}</span>
                <span className="kits-card-icon"><KitIcon id={id} size={26} /></span>
                <span className="kits-card-body">
                  <b>{d.name}</b>
                  <em>{d.ability} · {d.role}</em>
                </span>
                <span className="kits-card-tag mono">
                  {eq ? 'EQUIPPED' : own ? 'OWNED' : <><LockIcon size={11} /> {money(d.price)}</>}
                </span>
              </button>
            );
          })}
          <p className="kits-rules">
            Buy a kit once, keep it forever. One kit is carried per game and it is <b>locked in when you deploy</b> —
            end the game to change it. Kits start each game at {Math.round(KIT_TUNING.deployCharge * 100)}% charge.
          </p>
        </nav>

        <section className="kits-stage" aria-label={`${def.name} preview`}>
          <KitViewer kit={sel} />
          <div className="kits-stage-hud mono" aria-hidden="true">
            <span>{def.role.toUpperCase()}</span>
            <span>COOLDOWN {def.cooldown}s</span>
          </div>
          <div key={sel} className="kits-stage-name" aria-hidden="true">{def.ability}</div>
        </section>

        <aside key={sel} className="kits-detail" aria-live="polite">
          <span className="kits-role mono">{def.role} kit</span>
          <h2 className="kits-name">{def.name}</h2>
          <span className="kits-ability"><KitIcon id={sel} size={16} /> {def.ability}</span>
          <p className="kits-blurb">{def.blurb}</p>

          <div className="kits-stats">
            {def.stats.map((s, i) => (
              <div key={s.label} className="kits-stat" style={{ '--bar': s.bar, animationDelay: `${0.1 + i * 0.07}s` } as CSSProperties}>
                <span className="mono">{s.label}</span>
                <b className="tabular">{s.value}</b>
                <i aria-hidden="true"><em /></i>
              </div>
            ))}
          </div>

          <ol className="kits-steps">
            {def.steps.map((s, i) => <li key={i}><span className="mono">{String(i + 1).padStart(2, '0')}</span>{s}</li>)}
          </ol>
          <p className="kits-rule">{def.rule}</p>
          <p className="kits-refund mono">
            KILLS CUT {Math.round(KIT_TUNING.killRefund * 100)}% OFF THE COOLDOWN · MAX {Math.round(KIT_TUNING.refundCap * 100)}% PER CHARGE
          </p>

          <button type="button" className={`kits-cta ${cta.cls}`} onClick={act} disabled={cta.cls === 'locked'}>
            <span>{cta.label}</span>
            <span className="keycap">Enter</span>
          </button>
          {!owned && <span className="kits-price mono">PRICE {money(def.price)} · ONE-TIME</span>}
        </aside>
      </div>

      {toast && (
        <div key={toast.id} className={`kits-toast ${toast.kind}`} role="status">
          {toast.kind !== 'error' && <KitIcon id={sel} size={18} />}
          <span>{toast.text}</span>
        </div>
      )}
    </main>
  );
}
