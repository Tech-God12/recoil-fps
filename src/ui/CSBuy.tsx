// Recoil FPS — DUSTYARD TACTICAL buy menu.
//
// One component, two contexts:
//   · cs-setup screen — pre-match cart with a fresh $800 wallet and a Deploy button.
//   · in-game overlay — cloned straight from the TdmSetup look, opened by B or
//     automatically at round start. Committing re-arms the operator instantly.
//
// The cart is a full CSLoadout diffed against the gear you are already carrying
// (economy.loadoutCost), so prices are always the DELTA — re-buying a kept gun
// costs nothing, exactly like CS2's persistent-weapons rule.
import { useEffect, useMemo, useState } from 'react';
import { weaponById } from '../game/economy/catalog';
import {
  CS_GUNS, CS_GRENADES, CS_GEAR, ecoFor, grenadePrice, loadoutCost,
  type CSLoadout, type CSWeaponId,
} from '../game/cs/economy';

const TEAM: 'alpha' | 'bravo' = 'alpha'; // the human is ALPHA (CT) for the whole match

interface CardStat { label: string; value: string }

function gunStats(id: CSWeaponId): CardStat[] {
  const entry = weaponById(id);
  const base = entry?.base;
  if (!base) return [];
  const vsHeavy = Math.max(1, Math.round(210 / Math.max(1, base.damage * 0.48)));
  return [
    { label: 'DMG', value: String(Math.round(base.damage)) },
    { label: 'RPM', value: String(Math.round(base.rpm)) },
    { label: 'MAG', value: String(base.magSize) },
    { label: 'AP', value: `${vsHeavy} sk` },   // body shots to drop heavy armor
  ];
}

const CATS: { title: string; ids: CSWeaponId[] }[] = [
  { title: 'Pistols', ids: ['m1911', 'deagle'] },
  { title: 'SMG', ids: ['mp7', 'vector'] },
  { title: 'Rifles', ids: ['ak47', 'm4a1', 'scar_h'] },
  { title: 'Sniper', ids: ['awm'] },
  { title: 'Heavy', ids: ['spas12', 'm249'] },
];

export default function CSBuy({ overlay, money, gear, onBuy, onDeploy, onBack, onClose }: {
  overlay?: boolean;
  money: number;
  gear: CSLoadout;
  onBuy: (cart: CSLoadout) => boolean;
  onDeploy?: () => void;
  onBack?: () => void;
  onClose?: () => void;
}) {
  const [cart, setCart] = useState<CSLoadout>({ ...gear });
  const [deny, setDeny] = useState(0);
  useEffect(() => { setCart({ ...gear }); }, [gear]);
  // The overlay releases the pointer lock, so the engine never sees keypresses —
  // B and Escape close it from here.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.code === 'KeyB' || e.code === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cost = useMemo(() => loadoutCost(cart, TEAM, gear), [cart, gear]);
  const affordable = cost <= money;
  const eco = ecoFor(money);

  const denyFlash = () => setDeny(d => d + 1);

  const pickPrimary = (id: CSWeaponId | null) => setCart(c => ({ ...c, primary: c.primary === id ? null : id }));
  const pickSecondary = (id: CSWeaponId | null) => setCart(c => ({ ...c, secondary: c.secondary === id ? null : id }));
  const pickArmor = (level: 0 | 1 | 2) => setCart(c => ({ ...c, armor: c.armor === level ? 0 : level }));
  const toggleKit = () => setCart(c => ({ ...c, kit: !c.kit }));
  const bumpNade = (id: 'frag' | 'flash' | 'smoke' | 'molotov', delta: number) => setCart(c => {
    const entry = CS_GRENADES.find(g => g.id === id && (!g.team || g.team === TEAM));
    const max = entry?.max ?? 0;
    const next = Math.max(0, Math.min(max, c[id] + delta));
    return { ...c, [id]: next };
  });

  const commit = () => {
    if (!affordable) { denyFlash(); return; }
    if (!onBuy(cart)) denyFlash();
  };

  const primaryName = cart.primary ? weaponById(cart.primary)?.short ?? '—' : '—';
  const secondaryName = cart.secondary ? weaponById(cart.secondary)?.short ?? '—' : '—';

  return (
    <div className={`cs-buy-root ${overlay ? 'cs-buy-overlay' : ''}`} role="dialog" aria-label="Buy equipment" key={`deny-${deny}`}>
      <div className="cs-buy-panel">
        <header className="cs-buy-head">
          <div>
            <span className="cs-buy-eyebrow">DUSTYARD · BUY ZONE</span>
            <h2 className="cs-buy-title">Buy equipment</h2>
          </div>
          <div className="cs-buy-wallet">
            <span className="cs-eco-chip" data-eco={eco}>{eco}</span>
            <span className="cs-buy-money tabular">${money.toLocaleString('en-US')}</span>
          </div>
        </header>

        <div className="cs-buy-body">
          <div className="cs-buy-catalog">
            {CATS.map(cat => (
              <section key={cat.title} className="cs-buy-cat">
                <h3 className="cs-buy-cat-title">{cat.title}</h3>
                <div className="cs-buy-grid">
                  {cat.ids.map(id => {
                    const entry = CS_GUNS.find(g => g.id === id);
                    if (!entry) return null;
                    // Team-locked guns are simply not offered (AK for T, M4 for CT).
                    if (entry.team && entry.team !== TEAM) return null;
                    const owned = cart.primary === id || cart.secondary === id;
                    const mine = gear.primary === id || gear.secondary === id;
                    const price = mine ? 0 : entry.price;
                    const can = price <= money - cost + (owned ? 0 : 0) || mine;
                    const stats = gunStats(id);
                    return (
                      <button
                        key={id}
                        className={`cs-card ${owned ? 'owned' : ''} ${price > money && !mine ? 'poor' : ''}`}
                        onClick={() => entry.slot === 'secondary' ? pickSecondary(owned ? null : id) : pickPrimary(owned ? null : id)}
                      >
                        <span className="cs-card-top">
                          <b className="cs-card-name">{entry.name}</b>
                          <span className="cs-card-price tabular">{mine ? 'kept' : `$${entry.price}`}</span>
                        </span>
                        <span className="cs-card-stats mono">
                          {stats.map(s => <i key={s.label}><b>{s.label}</b> {s.value}</i>)}
                        </span>
                        <span className="cs-card-blurb">{entry.team ? `${entry.team === 'alpha' ? 'CT' : 'T'} issue · ` : ''}{can ? '' : 'need funds'}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}

            <section className="cs-buy-cat">
              <h3 className="cs-buy-cat-title">Equipment</h3>
              <div className="cs-buy-grid">
                {CS_GEAR.filter(g => g.id !== 'kit').map(g => {
                  const level = g.id === 'kevlar' ? 1 : 2;
                  const owned = cart.armor === level;
                  const price = owned ? 0 : level === 2 ? g.price : g.price;
                  return (
                    <button key={g.id} className={`cs-card ${owned ? 'owned' : ''} ${price > money ? 'poor' : ''}`} onClick={() => pickArmor(level)}>
                      <span className="cs-card-top">
                        <b className="cs-card-name">{g.name}</b>
                        <span className="cs-card-price tabular">{cart.armor >= level ? 'kept' : `$${g.price}`}</span>
                      </span>
                      <span className="cs-card-stats mono"><i><b>POOL</b> {level === 2 ? 210 : 180}</i><i><b>HEAD</b> ×{level === 2 ? 0.75 : 0.85}</i></span>
                      <span className="cs-card-blurb">{g.blurb}</span>
                    </button>
                  );
                })}
                {CS_GEAR.filter(g => g.id === 'kit').map(g => (
                  <button key={g.id} className={`cs-card ${cart.kit ? 'owned' : ''} ${g.price > money ? 'poor' : ''}`} onClick={toggleKit}>
                    <span className="cs-card-top">
                      <b className="cs-card-name">{g.name}</b>
                      <span className="cs-card-price tabular">{gear.kit ? 'kept' : `$${g.price}`}</span>
                    </span>
                    <span className="cs-card-stats mono"><i><b>DEFUSE</b> 10s → 5s</i></span>
                    <span className="cs-card-blurb">{g.blurb}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="cs-buy-cat">
              <h3 className="cs-buy-cat-title">Grenades</h3>
              <div className="cs-buy-grid">
                {(['frag', 'flash', 'smoke', 'molotov'] as const).map(id => {
                  const entry = CS_GRENADES.find(g => g.id === id && (!g.team || g.team === TEAM));
                  if (!entry) return null;                      // molotov is T-only; CT gets the incendiary name
                  const price = grenadePrice(id, TEAM);
                  const count = cart[id];
                  const label = id === 'molotov' ? 'Incendiary' : entry.name;
                  return (
                    <div key={id} className={`cs-card cs-card-nade ${count > 0 ? 'owned' : ''} ${price > money ? 'poor' : ''}`}>
                      <span className="cs-card-top">
                        <b className="cs-card-name">{label}</b>
                        <span className="cs-card-price tabular">${price}</span>
                      </span>
                      <span className="cs-card-stats mono"><i><b>MAX</b> {entry.max}</i></span>
                      <span className="cs-nade-ctl">
                        <button onClick={() => bumpNade(id, -1)} aria-label={`Remove ${label}`}>−</button>
                        <b className="tabular">{count}</b>
                        <button onClick={() => bumpNade(id, +1)} aria-label={`Add ${label}`}>+</button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="cs-buy-side">
            <h3 className="cs-buy-cat-title">Loadout</h3>
            <div className="cs-load-rows">
              <div className="cs-load-row"><span>Primary</span><b>{primaryName}</b></div>
              <div className="cs-load-row"><span>Secondary</span><b>{secondaryName}</b></div>
              <div className="cs-load-row"><span>Knife</span><b>FREE</b></div>
              <div className="cs-load-row"><span>Armor</span><b>{cart.armor === 2 ? '⬢ Heavy' : cart.armor === 1 ? '◍ Kevlar' : '○ Bare'}</b></div>
              <div className="cs-load-row"><span>Defuse kit</span><b>{cart.kit ? 'YES · 5s' : 'no'}</b></div>
              <div className="cs-load-row"><span>Grenades</span><b>{cart.frag}F · {cart.flash}Fl · {cart.smoke}S{TEAM === 'bravo' || cart.molotov ? ` · ${cart.molotov}M` : ''}</b></div>
            </div>
            <div className="cs-buy-total">
              <div className="cs-total-row"><span>Total</span><b className="tabular">${cost.toLocaleString('en-US')}</b></div>
              <div className="cs-total-row dim"><span>After purchase</span><b className="tabular">${(money - cost).toLocaleString('en-US')}</b></div>
            </div>
            <button className={`btn btn-primary cs-buy-commit ${affordable ? '' : 'cs-deny'}`} onClick={commit}>
              <span>{cost === 0 ? 'Loadout kept' : affordable ? `Buy — $${cost.toLocaleString('en-US')}` : 'Not enough money'}</span>
            </button>
            <button className="btn btn-ghost" onClick={() => setCart({ ...gear })}>Reset cart</button>
            {deny > 0 && <p className="cs-deny-note" role="alert">Purchase denied — not enough money.</p>}
            {onDeploy && (
              <button className="btn btn-primary cs-deploy" onClick={onDeploy}>
                <span>Deploy to Dustyard</span>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="square" /></svg>
              </button>
            )}
            {(onClose || onBack) && (
              <button className="btn btn-ghost" onClick={() => (onClose ?? onBack)?.()}>
                {overlay ? 'Close [B]' : 'Back'}
              </button>
            )}
            <p className="cs-buy-hint mono">
              Buy zone · freeze time only · money persists across rounds — dying costs your guns, never your wallet.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
