// Recoil FPS — ABILITIES: buy and equip the ability you carry into a game. Full-screen 3-D
// showcase of the selected ability, its details on the left, the three abilities as cards
// along the bottom, and the buy/equip action bottom-right. The equipped ability is
// locked in when a game starts; this screen is the only place to change it.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ABILITY_DEFS, ABILITY_IDS, ABILITY_KEY, type AbilityId } from '../game/abilities';
import { buyAbility, equipAbility } from '../game/economy/ability-shop';
import type { PlayerProfile } from '../game/economy/profile';
import { audio } from '../game/audio';
import { AbilityIcon, LockIcon } from './Abilities';
import { AbilityViewer } from './AbilityViewer';

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

type Toast = { id: number; kind: 'bought' | 'equipped' | 'error'; text: string };

export default function AbilitiesMenu({ profile, onProfile, onBack }: {
  profile: PlayerProfile; onProfile: (p: PlayerProfile) => void; onBack: () => void;
}) {
  const [sel, setSel] = useState<AbilityId>(profile.equippedAbility ?? 'recon');
  const [toast, setToast] = useState<Toast | null>(null);
  const toastId = useRef(0);
  const def = ABILITY_DEFS[sel];
  const owned = profile.ownedAbilities.includes(sel);
  const equipped = profile.equippedAbility === sel;
  const short = Math.max(0, def.price - profile.cash);

  const flash = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToast({ id, kind, text });
    window.setTimeout(() => setToast(t => (t?.id === id ? null : t)), 2600);
  }, []);

  const act = useCallback(() => {
    if (!owned) {
      const r = buyAbility(profile, sel);
      if (!r.ok) {
        flash('error', r.error === 'INSUFFICIENT_FUNDS' ? `You need ${money(short)} more — earn it in games` : 'Purchase failed');
        return;
      }
      onProfile(r.value);
      audio.abilityPurchase();
      flash('bought', `${def.name} bought${r.value.equippedAbility === sel ? ' and equipped' : ''}`);
      return;
    }
    const r = equipAbility(profile, equipped ? null : sel);
    if (!r.ok) return;
    onProfile(r.value);
    audio.abilitySelect();
    flash('equipped', equipped ? `${def.name} unequipped — you'll play without an ability` : `${def.name} equipped`);
  }, [def.name, equipped, flash, onProfile, owned, profile, sel, short]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = ABILITY_IDS.indexOf(sel);
      if (e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); onBack(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); setSel(ABILITY_IDS[(i + 1) % ABILITY_IDS.length]); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); setSel(ABILITY_IDS[(i + ABILITY_IDS.length - 1) % ABILITY_IDS.length]); }
      else if (/^Digit[1-5]$/.test(e.code)) setSel(ABILITY_IDS[Number(e.code.slice(5)) - 1]);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); act(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, onBack, sel]);

  const cta = !owned
    ? short > 0 ? { label: `Need ${money(short)} more`, cls: 'locked' } : { label: `Buy · ${money(def.price)}`, cls: 'buy' }
    : equipped ? { label: 'Equipped', cls: 'equipped' } : { label: 'Equip', cls: 'equip' };

  return (
    <main className={`abilities-root ability-${sel}`} aria-labelledby="abilities-title">

      <header className="abilities-top">
        <button type="button" className="abilities-back" onClick={onBack}>
          <span aria-hidden="true">‹</span> Back <span className="keycap">Esc</span>
        </button>
        <h1 id="abilities-title" className="abilities-title">Abilities</h1>
        <span className="abilities-sub mono">One ability per game · use it with <span className="keycap">{ABILITY_KEY}</span></span>
        <div className="abilities-wallet" title="Wallet balance">
          <span className="mono">Wallet</span>
          <b className="tabular">{money(profile.cash)}</b>
        </div>
      </header>

      <div className="abilities-body">
      <section key={sel} className="abilities-info" aria-live="polite">
        <span className="abilities-status mono">
          {equipped ? <><i className="dot" />Equipped</> : owned ? 'Owned' : <><LockIcon size={11} /> {money(def.price)}</>}
        </span>
        <h2 className="abilities-name">{def.name}</h2>
        <p className="abilities-blurb">{def.blurb}</p>
        <div className="abilities-stats">
          {def.stats.map((s, i) => (
            <div key={s.label} className="abilities-stat" style={{ '--bar': s.bar, animationDelay: `${0.08 + i * 0.06}s` } as CSSProperties}>
              <span className="mono">{s.label}</span>
              <b className="tabular">{s.value}</b>
              <i aria-hidden="true"><em /></i>
            </div>
          ))}
        </div>
        <ol className="abilities-steps">
          {def.steps.map((s, i) => <li key={i} style={{ animationDelay: `${0.2 + i * 0.06}s` }}><span>{i + 1}</span>{s}</li>)}
        </ol>
        <p className="abilities-rule">{def.rule}</p>
      </section>

      <div className="abilities-stage-wrap">
        <AbilityViewer ability={sel} className="abilities-stage" />
        <span className="abilities-stage-idx mono" aria-hidden="true">
          <b>{String(ABILITY_IDS.indexOf(sel) + 1).padStart(2, '0')}</b> / {String(ABILITY_IDS.length).padStart(2, '0')} · {def.role}
        </span>
        <button type="button" className="abilities-arrow prev" aria-label="Previous ability"
          onClick={() => setSel(ABILITY_IDS[(ABILITY_IDS.indexOf(sel) + ABILITY_IDS.length - 1) % ABILITY_IDS.length])}>‹</button>
        <button type="button" className="abilities-arrow next" aria-label="Next ability"
          onClick={() => setSel(ABILITY_IDS[(ABILITY_IDS.indexOf(sel) + 1) % ABILITY_IDS.length])}>›</button>
      </div>
      </div>

      <footer className="abilities-bottom">
        <nav className="abilities-cards" aria-label="Abilities" role="tablist">
          {ABILITY_IDS.map((id, i) => {
            const d = ABILITY_DEFS[id];
            const own = profile.ownedAbilities.includes(id);
            const eq = profile.equippedAbility === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={id === sel}
                className={`abilities-card ability-${id} ${id === sel ? 'sel' : ''} ${own ? 'owned' : 'locked'}`}
                style={{ animationDelay: `${0.05 + i * 0.06}s` }}
                onClick={() => setSel(id)}>
                <span className="abilities-card-key mono">{i + 1}</span>
                <span className="abilities-card-icon"><AbilityIcon id={id} size={24} /></span>
                <span className="abilities-card-text">
                  <b>{d.name}</b>
                  <span className="abilities-card-tag mono">{eq ? <><i className="dot" />Equipped</> : own ? 'Owned' : <><LockIcon size={10} /> {money(d.price)}</>}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="abilities-action">
          <button type="button" className={`abilities-cta ${cta.cls}`} onClick={act} disabled={cta.cls === 'locked'}>
            <span>{cta.label}</span>
            {cta.cls !== 'locked' && <span className="keycap">Enter</span>}
          </button>
        </div>
      </footer>

      {toast && (
        <div key={toast.id} className={`abilities-toast ${toast.kind}`} role="status">
          {toast.kind !== 'error' && <AbilityIcon id={sel} size={18} />}
          <span>{toast.text}</span>
        </div>
      )}
    </main>
  );
}
