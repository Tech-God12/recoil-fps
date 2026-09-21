// Recoil FPS — shared tactical UI kit for Loadout / Armory / Theater screens.
// Same visual language as the main menu: ink, bone, brass, signal orange.
import type { ReactNode } from 'react';
import {
  attachmentById,
  type AttachSlot, type AttachmentCatalogEntry, type AttachmentId,
  type WeaponCatalogEntry, type WeaponClass, type WeaponId,
} from '../game/economy/catalog';
import type { ResolvedWeaponStats } from '../game/economy/stats';
import type { WeaponBuild } from '../game/economy/loadout';
import { SLOT_LABELS } from './armory/GunViewer';

export const txFmt = (n: number) => `$${n.toLocaleString('en-US')}`;

/* ---------------- micro glyphs ---------------- */

export const TxArrow = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="square" />
  </svg>
);

export const TxLock = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const TxCheck = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8.5l3.2 3.2L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
  </svg>
);

export const TxCross = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
    <circle cx="12" cy="12" r="6.5" />
    <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
  </svg>
);

export function TxMotto({ align = 'right' }: { align?: 'right' | 'left' | 'center' }) {
  return (
    <div className={`tx-motto ${align}`} aria-hidden="true">
      <span>SAME GROUND</span>
      <span>DIFFERENT STORIES</span>
      <i className="tx-rule" />
    </div>
  );
}

export function TxCoords({ lat, lon }: { lat: string; lon: string }) {
  return (
    <div className="tx-coords mono" aria-hidden="true">
      <TxCross />
      <span>{lat}<br />{lon}</span>
    </div>
  );
}

/* ---------------- hardpoint slot glyphs ---------------- */

const SLOT_PATHS: Record<AttachSlot, ReactNode> = {
  muzzle: (<><rect x="8" y="9" width="11" height="6" rx="1" /><path d="M2 12h6M19 12h3M11.5 9v6M15 9v6" /></>),
  optic: (<><circle cx="12" cy="12" r="6" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M12 10.5v3M10.5 12h3" /></>),
  magazine: (<><path d="M9 3h6v7l-1.5 9h-3L9 10z" /><path d="M9.5 7h5" /></>),
  underbarrel: (<><rect x="10" y="9" width="4" height="11" rx="2" /><path d="M7 3h10v4H7z" /></>),
  stock: (<><path d="M3 8h9v9H8l-5-5z" /><path d="M12 8v9" /></>),
  rail: (<><rect x="3" y="10" width="18" height="4" rx="1" /><path d="M7 10v4M11 10v4M15 10v4M19 10v4" /></>),
  barrel: (<><path d="M2 12h13" /><rect x="15" y="10" width="6" height="4" rx="1" /><path d="M5.5 8.5V12" /></>),
};

export function SlotIcon({ slot, size = 20 }: { slot: AttachSlot; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {SLOT_PATHS[slot]}
    </svg>
  );
}

/* ---------------- armor tier glyphs ---------------- */

export function ArmorIcon({ tier, size = 26 }: { tier: 0 | 1 | 2; size?: number }) {
  if (tier === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={tier === 2 ? 'currentColor' : 'none'} fillOpacity={tier === 2 ? 0.25 : 0} stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M9 3L4 6v13h5v-5h6v5h5V6l-5-3a4 4 0 0 1-6 0z" strokeLinejoin="round" />
      {tier === 2 && <path d="M8 11h8M8 14.5h8" fill="none" />}
    </svg>
  );
}

/* ---------------- weapon data helpers ---------------- */

export const CLASS_LABEL: Record<WeaponClass, string> = {
  AR: 'ASSAULT RIFLE', BR: 'BATTLE RIFLE', SMG: 'SUBMACHINE GUN', PDW: 'PERSONAL DEFENSE',
  SR: 'SNIPER RIFLE', SG: 'SHOTGUN', LMG: 'LIGHT MACHINE GUN', PISTOL: 'SIDEARM',
};

export const CALIBER: Record<WeaponId, { round: string; note: string }> = {
  m4a1: { round: '5.56×45 NATO', note: 'Balanced performance, high rate of fire, and exceptional modularity. The trusted choice for operators worldwide.' },
  ak47: { round: '7.62×39MM', note: 'Heavy intermediate cartridge. Punches through cover and brush like they owe it money.' },
  m1911: { round: '.45 ACP', note: 'Big, slow, authoritative. Eight rounds that end arguments.' },
  awm: { round: '.338 LAPUA', note: 'Long-range magnum. Flat, fast, and final — if you can stand the sway.' },
  mp7: { round: '4.6×30MM', note: 'Armor-piercing PDW round. Small case, vicious cycle rate.' },
  vector: { round: '.45 ACP', note: 'Pistol-caliber thumper in a fire hose of a gun. Manage the climb.' },
  spas12: { round: '12 GAUGE', note: 'Eight pellets per trigger pull. Devastating inside a doorway.' },
  scar_h: { round: '7.62×51MM', note: 'Full-power battle rifle round. Two taps solve most problems.' },
  deagle: { round: '.50 AE', note: 'Hand-cannon magnum. Loud, proud, and wrist-breaking.' },
  m249: { round: '5.56×45 BELT', note: 'Linked suppression. One hundred rounds before the long reload.' },
};

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function accuracyRating(s: ResolvedWeaponStats): number {
  return Math.round(clampN(97 - Math.sqrt(s.adsSpread * 1000) * 15 - s.hipSpread * 350, 12, 97));
}

/** Three punchy capability tags derived from live stats (M416 → ACCURATE / VERSATILE / MODULAR). */
export function weaponTags(entry: WeaponCatalogEntry, stats: ResolvedWeaponStats): string[] {
  const acc = accuracyRating(stats);
  const rules: [string, boolean][] = [
    ['PRECISION', !!entry.boltAction],
    ['SPREAD', (entry.pellets ?? 1) > 1],
    ['SUSTAINED', !!entry.beltFed],
    ['HEAVY', stats.damage >= 50],
    ['RAPID', stats.rpm >= 850],
    ['ACCURATE', acc >= 75],
    ['VERSATILE', stats.auto && stats.damage >= 24 && stats.damage <= 46],
    ['MODULAR', entry.slots.length >= 6],
    ['STEADY', stats.auto && stats.rpm < 650],
    ['SEMI', !stats.auto && !entry.boltAction && !entry.pump],
    ['LONG REACH', stats.falloffStart >= 35],
    ['DEEP MAG', stats.magSize >= 40],
    ['SNAPPY', stats.adsTime <= 0.18],
    ['AGILE', stats.moveSpeedMul > 1],
    ['PUMP', !!entry.pump],
    ['CLASSIC', !!entry.slideBlowback],
    ['FIELD-TESTED', true],
    ['RELIABLE', true],
    ['PROVEN', true],
  ];
  return rules.filter(([, ok]) => ok).slice(0, 3).map(([t]) => t);
}

/* ---------------- stat bars ---------------- */

export interface BarDatum { key: string; label: string; text: string; fill: number }

export function statBars(entry: WeaponCatalogEntry, stats: ResolvedWeaponStats): BarDatum[] {
  const pellets = entry.pellets ?? 1;
  const dmgText = pellets > 1 ? `${stats.damage.toFixed(0)}×${pellets}` : stats.damage.toFixed(0);
  const dmgFill = clampN(stats.damage * (pellets > 1 ? Math.sqrt(pellets) : 1) / 85 * 100, 4, 100);
  const rate = Math.round(stats.rpm / 10);
  const acc = accuracyRating(stats);
  const range = Math.round(clampN(stats.falloffStart * 1.9, 8, 99));
  const mob = Math.round(clampN(
    74 * stats.moveSpeedMul + (stats.adsTime <= 0.2 ? 4 : 0)
    - (stats.tacReload > 3 ? 8 : 0) - (stats.magSize >= 60 ? 3 : 0), 8, 99));
  return [
    { key: 'dmg', label: 'DAMAGE', text: dmgText, fill: dmgFill },
    { key: 'rate', label: 'FIRE RATE', text: String(rate), fill: clampN(stats.rpm / 1100 * 100, 4, 100) },
    { key: 'acc', label: 'ACCURACY', text: String(acc), fill: acc },
    { key: 'range', label: 'RANGE', text: String(range), fill: range },
    { key: 'mob', label: 'MOBILITY', text: String(mob), fill: mob },
  ];
}

const BAR_ICONS: Record<string, ReactNode> = {
  dmg: (<><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>),
  rate: (<><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></>),
  acc: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><circle cx="12" cy="12" r="0.8" /></>),
  range: (<><path d="M3 17l14-10M17 7v4h-4M7 13v4h4" /></>),
  mob: (<><path d="M4 18l6-9 4 4 6-9" /><path d="M4 20h16" /></>),
};

const TDM_ORDER = ['dmg', 'rate', 'acc', 'range', 'mob'];
const ARMORY_ORDER = ['dmg', 'acc', 'range', 'rate', 'mob'];

export function StatBars({ entry, stats, variant }: {
  entry: WeaponCatalogEntry; stats: ResolvedWeaponStats; variant: 'tdm' | 'armory';
}) {
  const order = variant === 'tdm' ? TDM_ORDER : ARMORY_ORDER;
  const bars = statBars(entry, stats).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return (
    <div className={`tx-bars ${variant}`}>
      {bars.map(b => (
        <div key={b.key} className="tx-bar">
          {variant === 'armory' && (
            <svg viewBox="0 0 24 24" className="tx-bar-ico" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              {BAR_ICONS[b.key]}
            </svg>
          )}
          <span className="tx-bar-label">{b.label}</span>
          <span className="tx-bar-track" aria-hidden="true"><i style={{ width: `${b.fill}%` }} /></span>
          <b className="tx-bar-val mono tabular">{b.text}</b>
        </div>
      ))}
    </div>
  );
}

/* ---------------- hardpoint rows ---------------- */

export function HardpointRows({ entry, build, onOpen }: {
  entry: WeaponCatalogEntry; build: WeaponBuild; onOpen: (slot: AttachSlot) => void;
}) {
  return (
    <div className="tx-hp-list" role="list" aria-label="Equipped attachments">
      {entry.slots.map(slot => {
        const id = build.attachments[slot];
        const part = id ? attachmentById(id) : undefined;
        return (
          <button key={slot} type="button" role="listitem" className={`tx-hp ${part ? 'filled' : ''}`} onClick={() => onOpen(slot)}>
            <span className="tx-hp-ico"><SlotIcon slot={slot} /></span>
            <i>{SLOT_LABELS[slot]}</i>
            <b>{part ? part.name : 'Stock'}</b>
            <span className="tx-hp-chev" aria-hidden="true">›</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- parts browser (right panel) ---------------- */

export function PartsPanel({ entry, build, slot, parts, owned, cash, mode, onEquip, onBuy, onStrip, onClose }: {
  entry: WeaponCatalogEntry; build: WeaponBuild; slot: AttachSlot;
  parts: AttachmentCatalogEntry[]; owned: AttachmentId[]; cash: number;
  mode: 'tdm' | 'armory';
  onEquip: (id: AttachmentId) => void; onBuy: (id: AttachmentId) => void;
  onStrip: () => void; onClose: () => void;
}) {
  const equippedId = build.attachments[slot];
  return (
    <div className="tx-parts" key={slot}>
      <div className="tx-sec">
        <span>{SLOT_LABELS[slot]} — {entry.short}</span>
        <button type="button" className="tx-mini" onClick={onClose}>CLOSE</button>
      </div>
      {equippedId && (
        <button type="button" className="tx-strip" onClick={onStrip}>
          <span>Strip {attachmentById(equippedId)?.name}</span>
          <span className="mono">Back to stock</span>
        </button>
      )}
      <div className="tx-parts-list">
        {parts.map(part => {
          const isOwned = owned.includes(part.id);
          const isEquipped = equippedId === part.id;
          const afford = cash >= part.price;
          return (
            <div key={part.id} className={`pcard ${isEquipped ? 'equipped' : ''}`}>
              <div className="pcard-head">
                <strong>{part.name}</strong>
                <span className="pcard-tier" aria-label={`tier ${part.tier}`}>
                  {[1, 2, 3].map(i => <i key={i} className={i <= part.tier ? 'on' : ''} />)}
                </span>
              </div>
              {mode === 'armory' && (
                <div className="pcard-fit mono">{part.family ?? 'Dedicated fit'} · {part.compat.length} host{part.compat.length === 1 ? '' : 's'}</div>
              )}
              <p className="pcard-desc">{part.desc}</p>
              <div className="pcard-mods">
                {part.pros.map(p => <span key={p} className="pro">+ {p}</span>)}
                {part.cons.map(c => <span key={c} className="con">− {c}</span>)}
              </div>
              {isEquipped ? (
                <button type="button" className="pcard-btn equipped" onClick={onStrip}>Equipped — click to strip</button>
              ) : isOwned ? (
                <button type="button" className="pcard-btn" onClick={() => onEquip(part.id)}>Equip</button>
              ) : mode === 'tdm' ? (
                <button type="button" className="pcard-btn buy" onClick={() => onBuy(part.id)}>Buy &amp; Equip — {txFmt(part.price)}</button>
              ) : (
                <button type="button" className={`pcard-btn buy ${afford ? '' : 'cant'}`} onClick={() => onBuy(part.id)}>
                  Buy — {txFmt(part.price)}
                </button>
              )}
            </div>
          );
        })}
        {parts.length === 0 && <p className="partmenu-empty mono">No compatible parts for this socket.</p>}
      </div>
    </div>
  );
}

/* ---------------- big orange deploy ---------------- */

export function OrangeDeploy({ title, hint, onClick, wide }: {
  title: string; hint: string; onClick: () => void; wide?: boolean;
}) {
  return (
    <button type="button" className={`tx-deploy${wide ? ' wide' : ''}`} onClick={onClick}>
      <span className="tx-deploy-title">{title}</span>
      <span className="tx-deploy-div" aria-hidden="true" />
      <span className="tx-deploy-hint mono">{hint}</span>
      <TxArrow />
    </button>
  );
}

export function TxBack({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="tx-back" onClick={onClick}>
      <span aria-hidden="true">‹</span> BACK
    </button>
  );
}
