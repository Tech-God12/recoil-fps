// Recoil FPS — Bomb Defusal buy menu (B during the buy window, inside your buy zone).
// CS-style number flow (1–6 picks a category, 1–9 buys inside it), real 3D gun
// thumbnails, kill-reward chips, and your armory build fielded when you own the gun.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DefusalHud } from '../game/defusal/mode';
import {
  SHOP, SHOP_CATEGORIES, buy as simulateBuy, canBuy, inventoryValue, itemPrice, shopItem,
  type Inventory, type ShopCategory, type ShopItem,
} from '../game/defusal/shop';
import { KILL_REWARD, type Side } from '../game/defusal/rules';
import type { WeaponId } from '../game/economy/catalog';
import { gunThumbnail } from './armory/GunViewer';
import { weaponTexturesReady } from '../game/weapons/finish';

const GEAR_ICON: Record<string, string> = {
  kevlar: 'M12 2.5l8 3v6c0 5-3.5 8.6-8 10-4.5-1.4-8-5-8-10v-6z',
  helmet: 'M4 15c0-5 3.6-9 8-9s8 4 8 9v1H4zM3 16.5h18',
  kit: 'M4 7h16v12H4zM9 7V5h6v2M8 13h8M12 9v8',
  frag: 'M9 2.5h6v3.4H9zM7 9.5h10V15a5 5 0 0 1-10 0z',
  flash: 'M8 3h8v4H8zM7 8h10v12H7zM10 11h4',
  smoke: 'M8 3h8v3H8zM7 7h10v13H7zM4 12c-2 0-2 3 0 3M20 12c2 0 2 3 0 3',
};

/** Best package for the bank: rifle, armor, kit, utility — the CS "rebuy" in one key. */
export function autoBuyPlan(inv: Inventory, side: Side): string[] {
  let cur = inv;
  const out: string[] = [];
  const tryBuy = (id: string) => { const r = simulateBuy(cur, id, side); if (r.ok) { cur = r.inv; out.push(id); return true; } return false; };
  if (!cur.primary) {
    const rifle = side === 'attack' ? 'ak47' : 'm4a1';
    const rp = shopItem(rifle)!.price;
    if (cur.money >= rp + 650) tryBuy(rifle);
    else if (cur.money >= 1250 + 650) tryBuy('vector');
    else if (cur.money >= 1050) tryBuy('mp7');
  }
  if (!tryBuy('helmet')) tryBuy('kevlar');
  if (side === 'defend') tryBuy('kit');
  for (const n of ['smoke', 'flash', 'frag', 'flash']) tryBuy(n);
  return out;
}

export default function BuyMenu({ df, owned, onBuy, onClose }: {
  df: DefusalHud;
  /** Guns you own in the Armory — they arrive with your attachments and finish. */
  owned: WeaponId[];
  onBuy: (id: string) => { ok: boolean; reason?: string };
  onClose: (relock: boolean) => void;
}) {
  const side = df.side;
  const inv = df.inv;
  const [cat, setCat] = useState<ShopCategory>(() => (inv.primary ? 'grenades' : inv.money >= 3350 ? 'rifles' : inv.money >= 1250 ? 'smgs' : 'pistols'));
  const [step, setStep] = useState<'cat' | 'item'>('cat');
  const [toast, setToast] = useState<{ text: string; bad: boolean; key: number } | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<WeaponId, string>>>({});

  // Progressive thumbnails: one render per frame so opening the menu never hitches.
  useEffect(() => {
    let active = true;
    void weaponTexturesReady.then(async () => {
      for (const item of SHOP) {
        if (!item.weapon) continue;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!active) return;
        const url = gunThumbnail(item.weapon);
        if (url) setThumbs(prev => (prev[item.weapon!] ? prev : { ...prev, [item.weapon!]: url }));
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.key === toast.key ? null : cur)), 1500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const items = useMemo(() => SHOP.filter(i => i.category === cat), [cat]);
  const doBuy = useCallback((item: ShopItem) => {
    const r = onBuy(item.id);
    setToast({ text: r.ok ? `${item.name} purchased` : r.reason ?? 'Cannot buy', bad: !r.ok, key: Date.now() + Math.random() });
  }, [onBuy]);
  const autoBuy = useCallback(() => {
    const plan = autoBuyPlan(inv, side);
    if (!plan.length) { setToast({ text: 'Nothing affordable to add', bad: true, key: Date.now() }); return; }
    let n = 0;
    for (const id of plan) if (onBuy(id).ok) n++;
    setToast({ text: `Auto-buy: ${n} item${n === 1 ? '' : 's'}`, bad: n === 0, key: Date.now() });
  }, [inv, side, onBuy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onClose(false); return; }
      if (e.code === 'KeyB') { e.preventDefault(); onClose(true); return; }
      if (!df.buyOpen) return;
      if (e.code === 'KeyA') { e.preventDefault(); autoBuy(); return; }
      if (e.code === 'Backspace') { e.preventDefault(); setStep('cat'); return; }
      const m = e.code.match(/^(?:Digit|Numpad)([1-9])$/);
      if (!m) return;
      e.preventDefault();
      const n = Number(m[1]);
      if (step === 'cat') {
        const c = SHOP_CATEGORIES[n - 1];
        if (c) { setCat(c.id); setStep('item'); }
      } else {
        const item = items[n - 1];
        if (item) doBuy(item);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [df.buyOpen, step, items, doBuy, autoBuy, onClose]);

  const nades = [inv.frags && `FRAG ×${inv.frags}`, inv.flashes && `FLASH ×${inv.flashes}`, inv.smokes && `SMOKE ×${inv.smokes}`].filter(Boolean).join(' · ') || '—';
  return (
    <div className="buy-root" role="dialog" aria-modal="true" aria-label="Buy menu" onContextMenu={e => e.preventDefault()}>
      <div className="buy-panel anim-rise">
        <header className="buy-head">
          <span className="buy-title">BUY MENU</span>
          <span className={`buy-side ${side}`}>{side === 'attack' ? 'ATTACK' : 'DEFEND'} · ROUND {df.round}</span>
          <span className="buy-money mono tabular">${df.money.toLocaleString('en-US')}</span>
          <span className="buy-time mono tabular" title="Buy time left">◷ {Math.ceil(df.buyTimeLeft)}s</span>
          <button type="button" className="buy-close" onClick={() => onClose(true)} aria-label="Close buy menu">✕</button>
        </header>
        <div className="buy-body">
          <nav className="buy-cats" aria-label="Categories">
            {SHOP_CATEGORIES.map((c, i) => (
              <button key={c.id} type="button" className={`buy-cat ${cat === c.id ? 'on' : ''}`} onClick={() => { setCat(c.id); setStep('item'); }}>
                <b className="mono">{i + 1}</b>{c.label}
              </button>
            ))}
          </nav>
          <div className="buy-grid" aria-label={`${cat} items`}>
            {items.map((item, i) => {
              const check = canBuy(inv, item.id, side);
              const equipped = !check.ok && check.reason === 'Equipped';
              const price = itemPrice(item, inv);
              const reward = item.killClass ? KILL_REWARD[item.killClass] : 0;
              const yours = !!item.weapon && owned.includes(item.weapon);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`buy-card ${check.ok ? '' : 'no'} ${equipped ? 'eq' : ''}`}
                  onClick={() => doBuy(item)}
                  disabled={!df.buyOpen}
                  title={check.ok ? `Buy ${item.name} — $${price}` : check.reason}
                >
                  <span className="buy-key mono">{step === 'item' ? i + 1 : ''}</span>
                  <span className="buy-art">
                    {item.weapon
                      ? (thumbs[item.weapon] ? <img src={thumbs[item.weapon]} alt="" draggable={false} /> : <i className="buy-art-wait" />)
                      : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={GEAR_ICON[item.id] ?? GEAR_ICON.kevlar} /></svg>}
                  </span>
                  <span className="buy-name">{item.name}{yours && <em className="buy-yours">YOUR BUILD</em>}</span>
                  <span className="buy-tag">{item.tag}</span>
                  <span className="buy-foot">
                    <b className="mono tabular">${price.toLocaleString('en-US')}</b>
                    {reward > 0 && <i className="mono">${reward} / KILL</i>}
                    {!check.ok && <u>{check.reason}</u>}
                  </span>
                </button>
              );
            })}
          </div>
          <aside className="buy-loadout">
            <span className="buy-k">YOUR ROUND LOADOUT</span>
            <div><span>PRIMARY</span><b>{inv.primary ? shopItem(inv.primary)?.name : '—'}</b></div>
            <div><span>SIDEARM</span><b>{shopItem(inv.secondary)?.name ?? inv.secondary}</b></div>
            <div><span>ARMOR</span><b>{inv.armor === 2 ? 'Kevlar + helmet' : inv.armor ? 'Kevlar' : 'None'}</b></div>
            {side === 'defend' && <div><span>DEFUSE KIT</span><b>{inv.kit ? 'Yes · 5s defuse' : 'No · 10s defuse'}</b></div>}
            <div><span>UTILITY</span><b>{nades}</b></div>
            <div className="buy-value"><span>EQUIPMENT VALUE</span><b className="mono tabular">${inventoryValue(inv).toLocaleString('en-US')}</b></div>
            <button type="button" className="buy-auto" onClick={autoBuy} disabled={!df.buyOpen}><b className="mono">A</b> AUTO-BUY <em>rifle · armor · {side === 'defend' ? 'kit · ' : ''}utility</em></button>
            <p className="buy-note">Survive the round and you keep everything. Die and you respawn with a 1911.</p>
          </aside>
        </div>
        <footer className="buy-foot-keys mono">
          <span><b className="keycap">B</b> CLOSE</span>
          <span><b className="keycap">1-6</b> CATEGORY</span>
          <span><b className="keycap">1-9</b> BUY</span>
          <span><b className="keycap">⌫</b> BACK</span>
          <span><b className="keycap">A</b> AUTO-BUY</span>
          <span><b className="keycap">ESC</b> PAUSE</span>
        </footer>
        {toast && <div key={toast.key} className={`buy-toast ${toast.bad ? 'bad' : ''}`}>{toast.text}</div>}
        {!df.buyOpen && (
          <div className="buy-over">
            <b>BUY TIME IS OVER</b>
            <button type="button" className="deploy-btn" onClick={() => onClose(true)}><span>Back to the fight</span></button>
          </div>
        )}
      </div>
    </div>
  );
}
