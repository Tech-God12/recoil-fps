// Recoil FPS — CS-style buy menu for Bomb Defusal.
// Two-level keyboard flow (category digit → item digit, Backspace = back),
// full mouse support, auto-buy, live money/buy-time from the engine.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Engine } from '../../game/engine';
import { BUY_CATEGORIES, BUY_ITEMS, canBuy, effectivePrice, type BuyCategory, type BuyItem, type Kit } from '../../game/defuse/rules';
import { weaponById, type WeaponId } from '../../game/economy/catalog';
import { gunThumbnail } from '../armory/GunViewer';

type Info = NonNullable<ReturnType<Engine['defuseInfo']>>;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;

/** 0..1 bars from base catalog stats (relative to the buyable pool). */
function gunBars(id: WeaponId) {
  const w = weaponById(id);
  if (!w) return null;
  const b = w.base;
  const dmg = b.damage * (w.pellets ?? 1);
  return {
    damage: Math.min(1, dmg / 110),
    rate: Math.min(1, b.rpm / 1100),
    control: Math.max(0.08, Math.min(1, 1.35 - b.recoilMul * 0.6)),
    mobility: Math.max(0.08, Math.min(1, (b.moveSpeedMul - 0.7) / 0.32)),
  };
}

function owned(item: BuyItem, kit: Kit): boolean {
  if (item.slot === 'primary') return kit.primary === item.id;
  if (item.slot === 'secondary') return kit.secondary === item.id;
  if (item.id === 'kevlar') return kit.armor >= 1;
  if (item.id === 'helmet') return kit.armor >= 2;
  if (item.id === 'kit') return kit.kit;
  return false;
}

/** Priority list the AUTO-BUY button walks (full buy → force → eco). */
function autoBuyPlan(kit: Kit, side: Info['side']): string[] {
  const rifle = side === 'attack' ? 'ak47' : 'm4a1';
  const plan: string[] = [];
  let m = kit.money;
  const take = (id: string) => {
    const it = BUY_ITEMS.find(i => i.id === id);
    if (!it) return;
    const p = effectivePrice(it, kit);
    if (canBuy(id, { ...kit, money: m }, side).ok && m >= p) { plan.push(id); m -= p; }
  };
  if (!kit.primary) {
    if (m >= 2700 + 1000) take(rifle);
    else if (m >= 1500 + 650) take('vector');
  }
  take(kit.armor >= 1 ? 'helmet' : m >= 1000 ? 'helmet' : 'kevlar');
  if (side === 'defend') take('kit');
  take('flash');
  take('frag');
  take('flash');
  if (!kit.primary && !plan.some(p => p === rifle || p === 'vector') && kit.secondary === 'm1911') take('deagle');
  return plan;
}

export default function BuyMenu({ engine, onClose }: { engine: Engine; onClose: () => void }) {
  const [info, setInfo] = useState<Info | null>(() => engine.defuseInfo());
  const [cat, setCat] = useState<BuyCategory>(() => (engine.defuseInfo()?.pistol ? 'pistol' : 'rifle'));
  const [keyCat, setKeyCat] = useState(false); // true after a category digit: next digit buys
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    const id = window.setInterval(() => setInfo(engine.defuseInfo()), 100);
    return () => window.clearInterval(id);
  }, [engine]);

  // Thumbnails render lazily (one cached WebGL render per gun).
  useEffect(() => {
    let alive = true;
    const guns = BUY_ITEMS.filter(i => i.slot && i.category === cat && !thumbs[i.id]);
    if (!guns.length) return;
    const h = window.setTimeout(() => {
      const next: Record<string, string> = {};
      for (const g of guns) next[g.id] = gunThumbnail(g.id as WeaponId);
      if (alive) setThumbs(t => ({ ...t, ...next }));
    }, 30);
    return () => { alive = false; window.clearTimeout(h); };
  }, [cat, thumbs]);

  const items = useMemo(() => BUY_ITEMS.filter(i => i.category === cat), [cat]);

  const buy = useCallback((id: string) => {
    const r = engine.defuseBuy(id);
    const it = BUY_ITEMS.find(i => i.id === id);
    setMsg(r.ok ? { text: `PURCHASED ${it?.name.toUpperCase() ?? id}`, ok: true } : { text: (r.reason ?? 'Cannot buy').toUpperCase(), ok: false });
    setInfo(engine.defuseInfo());
  }, [engine]);

  const autoBuy = useCallback(() => {
    const i = engine.defuseInfo();
    if (!i) return;
    const plan = autoBuyPlan(i.kit, i.side);
    if (!plan.length) { setMsg({ text: 'NOTHING AFFORDABLE TO ADD', ok: false }); return; }
    for (const id of plan) engine.defuseBuy(id);
    setMsg({ text: `AUTO-BUY: ${plan.map(id => BUY_ITEMS.find(b => b.id === id)?.name ?? id).join(' · ').toUpperCase()}`, ok: true });
    setInfo(engine.defuseInfo());
  }, [engine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyB' || e.code === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.code === 'KeyA' && !e.repeat) { e.preventDefault(); autoBuy(); return; }
      if (e.code === 'Backspace') { e.preventDefault(); setKeyCat(false); return; }
      const m = /^Digit([1-9])$/.exec(e.code);
      if (!m) return;
      e.preventDefault();
      const n = Number(m[1]);
      if (!keyCat) {
        const c = BUY_CATEGORIES[n - 1];
        if (c) { setCat(c.id); setKeyCat(true); }
      } else {
        const it = items[n - 1];
        if (it) buy(it.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyCat, items, buy, autoBuy, onClose]);

  if (!info) return null;
  const { kit, side } = info;
  const expired = !info.buyOpen;
  const pri = kit.primary ? weaponById(kit.primary) : null;
  const sec = weaponById(kit.secondary);

  return (
    <div className="buy-root" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="buy-panel" role="dialog" aria-label="Buy menu">
        <header className="buy-head">
          <h2>BUY</h2>
          <span className={`side ${side}`}>{side === 'attack' ? 'ATTACKERS' : 'DEFENDERS'} · ROUND {info.round}{info.pistol ? ' · PISTOL' : ''}</span>
          <span className="cash tabular">{money(kit.money)}</span>
          <span className={`timer ${info.buyTime < 5 ? 'low' : ''}`}>{expired ? 'BUY TIME OVER' : `BUY TIME ${Math.ceil(info.buyTime)}s`}</span>
        </header>

        {expired ? (
          <div className="buy-expired">BUY TIME IS OVER — CLICK OR PRESS B TO RETURN</div>
        ) : (
          <>
            <nav className="buy-cats" aria-label="Categories">
              {BUY_CATEGORIES.map(c => (
                <button key={c.id} type="button" className={`buy-cat ${cat === c.id ? 'sel' : ''}`} onClick={() => { setCat(c.id); setKeyCat(true); }}>
                  <span className="k">{c.key}</span>{c.label}
                </button>
              ))}
            </nav>

            <section className="buy-items" aria-label="Items">
              {items.map((it, i) => {
                const price = effectivePrice(it, kit);
                const check = canBuy(it.id, kit, side);
                const has = owned(it, kit);
                const lockedSide = !!it.side && it.side !== side;
                const poor = kit.money < price;
                const bars = it.slot ? gunBars(it.id as WeaponId) : null;
                const w = it.slot ? weaponById(it.id as WeaponId) : null;
                return (
                  <button key={it.id} type="button" className={`buy-item ${has ? 'owned' : ''} ${poor ? 'poor' : ''}`}
                    disabled={!check.ok && !has} onClick={() => buy(it.id)} title={check.ok ? `Buy ${it.name}` : check.reason}>
                    <span className="row">
                      <span className="k">{keyCat ? i + 1 : '·'}</span>
                      <span className="nm">{it.name}</span>
                      <span className="pr tabular">{has ? '' : money(price)}</span>
                    </span>
                    {has && <span className="flag">EQUIPPED</span>}
                    {thumbs[it.id] ? <img src={thumbs[it.id]} alt="" draggable={false} style={{ height: 64, objectFit: 'contain', alignSelf: 'center' }} /> : null}
                    <span className="bl">{lockedSide ? 'Defenders only.' : it.blurb}</span>
                    {bars && (
                      <span style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 8px', alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--bone-mute)', letterSpacing: '0.1em' }}>
                        {(['damage', 'rate', 'control', 'mobility'] as const).map(k => (
                          <span key={k} style={{ display: 'contents' }}>
                            <span>{k.toUpperCase()}</span>
                            <span className="stat"><span style={{ width: `${Math.round(bars[k] * 100)}%` }} /></span>
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="meta">
                      {it.killReward > 0 && <span>KILL <b>+{money(it.killReward)}</b></span>}
                      {w && <span>{w.base.magSize} RD · {w.base.rpm} RPM</span>}
                    </span>
                  </button>
                );
              })}
            </section>
          </>
        )}

        <aside className="buy-side" aria-label="Current kit">
          <h3>YOUR KIT</h3>
          <div className={`buy-slot ${pri ? '' : 'empty'}`}>{pri ? pri.short : 'NO PRIMARY'}<em>PRIMARY</em></div>
          <div className="buy-slot">{sec?.short ?? kit.secondary}<em>SIDEARM</em></div>
          <div className={`buy-slot ${kit.armor ? '' : 'empty'}`}>{kit.armor === 2 ? 'VEST + HELMET' : kit.armor === 1 ? 'VEST' : 'NO ARMOR'}<em>ARMOR</em></div>
          {side === 'defend' && <div className={`buy-slot ${kit.kit ? '' : 'empty'}`}>{kit.kit ? 'DEFUSE KIT' : 'NO KIT'}<em>5s DEFUSE</em></div>}
          <div className={`buy-slot ${kit.frags + kit.flashes ? '' : 'empty'}`}>{kit.frags}× FRAG · {kit.flashes}× FLASH<em>UTILITY</em></div>
          <div className="buy-tip">
            {info.pistol
              ? <><b>Pistol round.</b> $800 each — kevlar or a Deagle, not both. The winner snowballs.</>
              : kit.money < 2000
                ? <><b>Eco?</b> Saving now banks a full rifle + armor next round. Loss bonus climbs each loss.</>
                : <><b>Full buy.</b> Rifle + helmet first, then utility.{side === 'defend' ? ' Grab a kit — it halves the defuse.' : ' Flash before you swing onto site.'}</>}
          </div>
        </aside>

        <footer className="buy-foot">
          <span className={`msg ${msg?.ok ? 'ok' : ''}`}>{msg?.text ?? (keyCat ? 'PRESS 1–9 TO BUY · BACKSPACE FOR CATEGORIES' : 'PRESS 1–6 FOR A CATEGORY')}</span>
          <span className="sp" />
          {!expired && <button type="button" className="buy-btn" onClick={autoBuy}>Auto-buy<span className="k">A</span></button>}
          <button type="button" className="buy-btn primary" onClick={onClose}>Back to fight<span className="k">B</span></button>
        </footer>
      </div>
    </div>
  );
}
