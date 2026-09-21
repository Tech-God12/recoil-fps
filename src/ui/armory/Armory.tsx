// Recoil FPS — Armory: weapons, gear and customization.
import { useEffect, useMemo, useState } from 'react';
import {
  WEAPON_CATALOG, attachmentById, attachmentsFor, weaponById,
  type AttachSlot, type AttachmentId, type WeaponId,
} from '../../game/economy/catalog';
import { resolveWeaponStats } from '../../game/economy/stats';
import {
  buildForWeapon, buyAttachment, buyWeapon, equipAttachment, setLoadoutWeapon,
  type PlayerProfile,
} from '../../game/economy/profile';
import CashCounter from './CashCounter';
import { weaponTexturesReady } from '../../game/weapons/finish';
import GunViewer, { gunThumbnail } from './GunViewer';
import {
  CALIBER, CLASS_LABEL, HardpointRows, OrangeDeploy, PartsPanel, StatBars,
  TxBack, TxCoords, txFmt, weaponTags,
} from '../tactical';

interface ArmoryProps {
  profile: PlayerProfile;
  onProfile: (next: PlayerProfile) => void;
  onDeploy: () => void;
  onBack: () => void;
  deployHint?: string;
}

const TUTORIAL = [
  { title: 'Pick a weapon', body: 'Select any gun to preview. Buying equips it instantly.', anchor: 'rail' },
  { title: 'Hardpoints', body: 'Click the gun or a slot in the panel to open parts.', anchor: 'stage' },
  { title: 'Build it', body: 'Buy to auto-equip. Finishes repaint the whole gun live.', anchor: 'panel' },
] as const;



const RankGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 22 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="miter">
    <path d="M3 7.5l8-5 8 5" /><path d="M3 12.5l8-5 8 5" /><path d="M3 17.5l8-5 8 5" />
  </svg>
);

export default function Armory({ profile, onProfile, onDeploy, onBack, deployHint }: ArmoryProps) {
  const [selected, setSelected] = useState<WeaponId>(profile.loadout.primary.weapon);
  const [menuSlot, setMenuSlot] = useState<AttachSlot | null>(null);
  const [flash, setFlash] = useState<{ slot: AttachSlot; key: number } | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [toast, setToast] = useState<{ text: string; key: number; bad?: boolean } | null>(null);
  const [tutStep, setTutStep] = useState(profile.seenArmoryTutorial ? -1 : 0);
  const [thumbs, setThumbs] = useState<Partial<Record<WeaponId, string>>>({});

  useEffect(() => {
    let active = true;
    void weaponTexturesReady.then(async () => {
      for (const w of WEAPON_CATALOG) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!active) return;
        const thumbnail = gunThumbnail(w.id);
        setThumbs(previous => ({ ...previous, [w.id]: thumbnail }));
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.key === toast.key ? null : cur)), 1700);
    return () => window.clearTimeout(t);
  }, [toast]);

  const say = (text: string, bad = false) => setToast({ text, key: Date.now() + Math.random(), bad });

  const entry = weaponById(selected)!;
  const owned = profile.ownedWeapons.includes(selected);
  const skin = 'factory' as const;
  const fielded = profile.loadout[entry.slot].weapon === selected;
  const build = useMemo(() => buildForWeapon(profile, selected), [profile, selected]);
  const stats = useMemo(() => {
    const mods = Object.values(build.attachments).map(id => attachmentById(id)?.mods).filter(m => !!m);
    return resolveWeaponStats(entry.base, mods);
  }, [build, entry]);
  const tags = weaponTags(entry, stats);
  // The whole rack as one flat list — primaries first, then sidearms. No tabs, no scroll.
  const rail = useMemo(
    () => [...WEAPON_CATALOG].sort((a, b) => (a.slot === b.slot ? 0 : a.slot === 'primary' ? -1 : 1)),
    [],
  );
  const level = 13 + profile.missions;

  const pulse = (slot: AttachSlot) => {
    const key = flashKey + 1;
    setFlashKey(key);
    setFlash({ slot, key });
  };

  const selectWeapon = (id: WeaponId) => {
    const w = weaponById(id)!;
    setSelected(id);
    setMenuSlot(null);
    if (profile.ownedWeapons.includes(id) && profile.loadout[w.slot].weapon !== id) {
      const res = setLoadoutWeapon(profile, w.slot, id);
      if (res.ok) {
        onProfile(res.value);
        say(`${w.name} equipped`);
      }
    }
  };

  const buyGun = () => {
    if (owned) return;
    const bought = buyWeapon(profile, selected);
    if (!bought.ok) {
      say(bought.error === 'INSUFFICIENT_FUNDS' ? `Need ${txFmt(entry.price)} — ${txFmt(profile.cash)} available` : 'Purchase failed', true);
      return;
    }
    const fieldedRes = setLoadoutWeapon(bought.value, entry.slot, selected);
    onProfile(fieldedRes.ok ? fieldedRes.value : bought.value);
    say(`${entry.name} added to ${entry.slot} slot`);
  };

  const openSlot = (slot: AttachSlot) => {
    setMenuSlot(cur => (cur === slot ? null : slot));
  };

  const buyPart = (id: AttachmentId) => {
    const res = buyAttachment(profile, selected, id);
    if (!res.ok) {
      say(res.error === 'INSUFFICIENT_FUNDS' ? 'Insufficient funds'
        : res.error === 'WEAPON_NOT_OWNED' ? `Buy the ${entry.name} first — parts fit onto owned guns`
          : 'Cannot fit — check compatibility', true);
      return;
    }
    onProfile(res.value);
    pulse(attachmentById(id)!.slot);
    say(`${attachmentById(id)!.name} fitted`);
  };

  const equipPart = (id: AttachmentId) => {
    const part = attachmentById(id)!;
    const res = equipAttachment(profile, selected, id, part.slot);
    if (!res.ok) {
      say('Cannot equip', true);
      return;
    }
    onProfile(res.value);
    pulse(part.slot);
  };

  const unequipSlot = (slot: AttachSlot) => {
    const res = equipAttachment(profile, selected, null, slot);
    if (res.ok) onProfile(res.value);
  };

  const advanceTutorial = () => {
    if (tutStep < 0) return;
    if (tutStep >= TUTORIAL.length - 1) {
      setTutStep(-1);
      onProfile({ ...profile, seenArmoryTutorial: true });
    } else {
      setTutStep(tutStep + 1);
    }
  };

  const railKey = (e: React.KeyboardEvent) => {
    const i = rail.findIndex(w => w.id === selected);
    if (e.key === 'ArrowDown' && i < rail.length - 1) {
      e.preventDefault();
      selectWeapon(rail[i + 1].id);
    } else if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault();
      selectWeapon(rail[i - 1].id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectWeapon(selected);
    }
  };

  const menuParts = menuSlot ? attachmentsFor(selected, menuSlot) : [];
  const ownedParts = profile.ownedAttachments[selected] ?? [];

  return (
    <div className="tx-root arm2-root" onClick={tutStep >= 0 ? advanceTutorial : undefined}
      onKeyDown={e => { if (e.key === 'Escape' && menuSlot) setMenuSlot(null); }}>
      <div className="arm2-glow" aria-hidden="true" />
      <div className="tx-grain" aria-hidden="true" />

      {/* ================= HEADER ================= */}
      <header className="tx-head seq" style={{ animationDelay: '.02s' }}>
        <TxBack onClick={onBack} />
        <div className="arm2-brand"><b>RECOIL</b></div>
        <div className="tx-title"><b>ARMORY</b><em>WEAPONS, GEAR AND CUSTOMIZATION</em></div>
        <div className="arm2-wallet" title="Wallet balance">
          <span className="arm2-coin" aria-hidden="true" />
          <CashCounter value={profile.cash} />
        </div>
        <div className="arm2-op">
          <RankGlyph />
          <span className="arm2-op-body"><em>OPERATOR</em><b>RECOIL_01</b><i>LVL {level}</i></span>
        </div>
      </header>

      <div className="arm2-main">
        {/* ================= RACK ================= */}
        <aside className={`tx-col arm2-rail seq ${tutStep === 0 ? 'tut-ring' : ''}`} style={{ animationDelay: '.06s' }} aria-label="Weapon rack">
          <div className="arm2-rackhead"><span>WEAPON RACK</span><b className="mono">{rail.length} GUNS</b></div>
          <div className="arm2-cards" tabIndex={0} onKeyDown={railKey} aria-label="All weapons">
            {rail.map((w, i) => {
              const isOwned = profile.ownedWeapons.includes(w.id);
              const isFielded = profile.loadout[w.slot].weapon === w.id;
              const isSel = w.id === selected;
              const n = i + 1;
              return (
                <button
                  key={w.id} type="button"
                  className={`arm2-row ${isSel ? 'sel' : ''} ${isOwned ? '' : 'locked'}`}
                  onClick={() => selectWeapon(w.id)}
                  aria-pressed={isSel}
                >
                  <span className="arm2-num mono">{n < 10 ? `0${n}` : n}</span>
                  {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} className="arm2-thumb" /> : <span className="arm2-thumb" />}
                  <span className="arm2-row-body">
                    <span className="arm2-name">{w.name}</span>
                    <span className="arm2-row-sub">
                      <i className="arm2-cls">{w.cls}</i>
                      {isFielded ? <b className="arm2-fielded">Equipped</b> : isOwned ? <b className="arm2-owned">Owned</b> : <b className="arm2-price">{txFmt(w.price)}</b>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="tx-hint mono">↑↓ NAVIGATE · ENTER PREVIEW</p>
        </aside>

        {/* ================= STAGE ================= */}
        <section className={`tx-col arm2-stage seq ${tutStep === 1 ? 'tut-ring' : ''}`} style={{ animationDelay: '.1s' }} aria-label="Weapon preview">
          <div className="arm2-hero">
            <div>
              <h2>{entry.name}</h2>
              <p className="arm2-class">{CLASS_LABEL[entry.cls]}</p>
              <p className="arm2-tags">{tags.join('. ')}.</p>
              <p className="arm2-blurb">{entry.blurb}</p>
              <div className="arm2-chips">
                <span className="arm2-chip">{CALIBER[entry.id].round}</span>
                <span className="arm2-chip">{stats.auto ? 'FULL-AUTO' : entry.boltAction ? 'BOLT' : entry.pump ? 'PUMP' : 'SEMI'}</span>
                <span className="arm2-chip">{stats.magSize} RD</span>
              </div>
            </div>
            <div className="arm2-hero-side">
              {fielded ? <span className="tx-tag gold">EQUIPPED</span> : owned ? <span className="tx-tag">IN RACK</span> : (
                <span className="tx-tagstack">
                  <span className="tx-tag gold">{txFmt(entry.price)}</span>
                  <button type="button" className="arm2-buy" onClick={buyGun}>BUY {entry.short}</button>
                </span>
              )}
              {!owned && <span className="arm2-locknote mono">LOCKED PREVIEW</span>}
            </div>
          </div>

          <div className="arm2-viewer">
            <GunViewer weapon={selected} skin={skin} build={build} flashSlot={flash} onHotspot={openSlot} />
            <div className="arm2-orbit-hint mono" aria-hidden="true">DRAG TO ORBIT · SCROLL TO ZOOM · CLICK THE GUN TO FIT PARTS</div>
            <div className="arm2-viewer-coords"><TxCoords lat="33.7731° N" lon="44.4208° E" /></div>
          </div>

          <div className="arm2-stats">
            <div>
              <div className="tx-sec"><span>WEAPON STATS</span></div>
              <StatBars entry={entry} stats={stats} variant="armory" />
            </div>
            <div className="arm2-caliber">
              <b className="mono">{CALIBER[entry.id].round}</b>
              <p>{CALIBER[entry.id].note}</p>
            </div>
          </div>
        </section>

        {/* ================= SPEC SHEET ================= */}
        <aside className={`tx-col arm2-panel seq ${tutStep === 2 ? 'tut-ring' : ''}`} style={{ animationDelay: '.14s' }} aria-label="Spec sheet">
          {menuSlot ? (
            <PartsPanel
              entry={entry} build={build} slot={menuSlot} parts={menuParts} owned={ownedParts}
              cash={profile.cash} mode="armory"
              onEquip={equipPart} onBuy={buyPart} onStrip={() => unequipSlot(menuSlot)} onClose={() => setMenuSlot(null)}
            />
          ) : (
            <>
              <div className="tx-sec"><span>EQUIPPED PARTS</span><b className="mono">{entry.slots.length}/{entry.slots.length}</b></div>
              <HardpointRows entry={entry} build={build} onOpen={openSlot} />

              <div className="arm2-cta">
                <OrangeDeploy title="PLAY" hint={deployHint ?? 'READY'} onClick={onDeploy} wide />
              </div>
            </>
          )}
        </aside>
      </div>

      {tutStep >= 0 && (
        <div className="tut-card" data-anchor={TUTORIAL[tutStep].anchor}>
          <span className="mono">Field manual {tutStep + 1}/3</span>
          <strong>{TUTORIAL[tutStep].title}</strong>
          <p>{TUTORIAL[tutStep].body}</p>
          <em className="mono">Click anywhere to continue</em>
        </div>
      )}
      {toast && <div key={toast.key} className={`armory-toast mono ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div>}
    </div>
  );
}
