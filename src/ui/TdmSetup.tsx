// Recoil FPS — Warehouse TDM pre-match loadout: ONE idea, which is your loadout.
//
// Everything that was not that has gone: the armor picker (every combatant now fields
// the same standard plating), the Bravo squad panel (it only ever previewed armor), the
// rules wall (the match teaches all of it in thirty seconds) and the whole footer with
// its second Play button. You arrive here from Arena Mode and you go back there to play,
// so Play belongs there, once. Changes save as you make them.
import { useEffect, useMemo, useState } from 'react';
import {
  WEAPON_CATALOG, attachmentById, attachmentsFor, weaponById,
  type AttachSlot, type AttachmentId, type SlotId, type WeaponId,
} from '../game/economy/catalog';
import { resolveWeaponStats } from '../game/economy/stats';
import {
  buildForWeapon, buyAttachment, equipAttachment, setLoadoutWeapon,
  type PlayerProfile,
} from '../game/economy/profile';
import { weaponTexturesReady } from '../game/weapons/finish';
import GunViewer, { gunThumbnail } from './armory/GunViewer';
import {
  CALIBER, CLASS_LABEL, HardpointRows, PartsPanel, StatBars,
  TxBack, TxCheck, TxCoords, TxLock, txFmt, weaponTags,
} from './tactical';
import { AbilityCardTall } from './Kits';
import type { KitId } from '../game/kits';
import mapArena from '../assets/map-arena.jpg';
import tdmBackdrop from '../assets/tdm-backdrop.jpg';

interface TdmSetupProps {
  profile: PlayerProfile;
  onProfile: (next: PlayerProfile) => void;
  onBack: () => void;
  /** Equipped field kit carried into the match (ability on Z); null = none bought/equipped. */
  kit?: KitId | null;
  /** Opens the ABILITIES menu (the kit itself is bought and equipped there). */
  onKits?: () => void;
}

export default function TdmSetup({ profile, onProfile, onBack, kit, onKits }: TdmSetupProps) {
  const [selected, setSelected] = useState<WeaponId>(profile.loadout.primary.weapon);
  const [gridTab, setGridTab] = useState<SlotId>(weaponById(profile.loadout.primary.weapon)?.slot ?? 'primary');
  const [menuSlot, setMenuSlot] = useState<AttachSlot | null>(null);
  const [flash, setFlash] = useState<{ slot: AttachSlot; key: number } | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [toast, setToast] = useState<{ text: string; key: number; bad?: boolean } | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<WeaponId, string>>>({});

  useEffect(() => {
    let active = true;
    void weaponTexturesReady.then(async () => {
      for (const w of WEAPON_CATALOG) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!active) return;
        setThumbs(previous => ({ ...previous, [w.id]: gunThumbnail(w.id) }));
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
  const skin = 'factory' as const;
  const build = useMemo(() => buildForWeapon(profile, selected), [profile, selected]);
  const stats = useMemo(() => {
    const mods = Object.values(build.attachments).map(id => attachmentById(id)?.mods).filter(m => !!m);
    return resolveWeaponStats(entry.base, mods);
  }, [build, entry]);
  const fielded = profile.loadout[entry.slot].weapon === selected;
  const owned = profile.ownedWeapons.includes(selected);
  const tags = weaponTags(entry, stats);

  const gridList = WEAPON_CATALOG.filter(w => w.slot === gridTab);

  const pulse = (slot: AttachSlot) => { const key = flashKey + 1; setFlashKey(key); setFlash({ slot, key }); };

  const selectWeapon = (id: WeaponId) => {
    const w = weaponById(id)!;
    if (!profile.ownedWeapons.includes(id)) { say(`${w.name} is locked — ${txFmt(w.price)} in the Armory`, true); return; }
    setSelected(id);
    setMenuSlot(null);
    if (profile.loadout[w.slot].weapon !== id) {
      const res = setLoadoutWeapon(profile, w.slot, id);
      if (res.ok) { onProfile(res.value); say(`${w.name} equipped`); }
    }
  };

  const openSlot = (slot: AttachSlot) => setMenuSlot(cur => (cur === slot ? null : slot));

  const equipPart = (id: AttachmentId) => {
    const part = attachmentById(id)!;
    const res = equipAttachment(profile, selected, id, part.slot);
    if (!res.ok) { say('Cannot equip', true); return; }
    onProfile(res.value);
    pulse(part.slot);
  };

  const buyPart = (id: AttachmentId) => {
    const res = buyAttachment(profile, selected, id);
    if (!res.ok) { say('Cannot fit — check compatibility', true); return; }
    onProfile(res.value);
    pulse(attachmentById(id)!.slot);
    say(`${attachmentById(id)!.name} fitted`);
  };

  const unequipSlot = (slot: AttachSlot) => {
    const res = equipAttachment(profile, selected, null, slot);
    if (res.ok) onProfile(res.value);
  };

  const menuParts = menuSlot ? attachmentsFor(selected, menuSlot) : [];
  const ownedParts = profile.ownedAttachments[selected] ?? [];

  return (
    <div className="tx-root tdm2-root" onKeyDown={e => { if (e.key === 'Escape' && menuSlot) setMenuSlot(null); }}>
      <div className="tdm2-backdrop" aria-hidden="true">
        <img src={tdmBackdrop} alt="" draggable={false} />
        <div className="tdm2-backdrop-shade" />
      </div>
      <div className="tx-grain" aria-hidden="true" />

      {/* ================= HEADER ================= */}
      <header className="tx-head seq" style={{ animationDelay: '.02s' }}>
        <TxBack onClick={onBack} />
        <div className="tx-title"><b>LOADOUT</b><em>PREPARE FOR DEPLOYMENT</em></div>
        <p className="tdm2-saves">
          <b>Changes save as you make them.</b>
          <span>Go back to Arena Mode to start the match.</span>
        </p>
        <div className="tdm2-match">
          <b>5V5 TEAM DEATHMATCH</b>
          <em className="mono">WAREHOUSE · 2:30 MATCH · 5s RESPAWN</em>
        </div>
        <div className="tdm2-mapchip">
          <img src={mapArena} alt="" draggable={false} />
          <span>WAREHOUSE<em className="mono">5V5 TDM</em></span>
        </div>
      </header>

      <div className="tdm2-main">
        {/* ================= LEFT — YOUR LOADOUT + ABILITY ================= */}
        <aside className="tx-col tdm2-left seq" style={{ animationDelay: '.06s' }} aria-label="Your loadout">
          <div className="tx-sec"><span>YOUR LOADOUT</span><b className="mono dim">CARRIED IN</b></div>
          <div className="tdm2-slots">
            {(['primary', 'secondary'] as SlotId[]).map(slotId => {
              const w = weaponById(profile.loadout[slotId].weapon);
              if (!w) return null;
              const fitted = Object.values(profile.loadout[slotId].attachments).filter(Boolean).length;
              const onBench = selected === w.id;
              return (
                <button
                  key={slotId}
                  type="button"
                  className={`tdm2-slot${onBench ? ' on' : ''}`}
                  onClick={() => { setSelected(w.id); setGridTab(slotId); setMenuSlot(null); }}
                  aria-pressed={onBench}
                  aria-label={`${w.name}, ${slotId}. Put it on the bench`}
                >
                  <span className="tdm2-slot-key mono">{slotId === 'primary' ? '1' : '2'}</span>
                  {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} /> : <span className="tdm2-slot-ph" />}
                  <span className="tdm2-slot-body">
                    <b>{w.short}</b>
                    <em className="mono">
                      {CLASS_LABEL[w.cls]}{fitted > 0 ? ` · ${fitted} PART${fitted > 1 ? 'S' : ''}` : ''}
                    </em>
                  </span>
                  {onBench && <span className="tdm2-slot-bench mono">ON THE BENCH</span>}
                </button>
              );
            })}
          </div>

          <div className="tx-sec" style={{ marginTop: 16 }}><span>ABILITY</span><b className="mono dim">ONE PER MATCH</b></div>
          <AbilityCardTall kit={kit ?? null} onOpen={onKits} />
        </aside>

        {/* ================= CENTER — HERO + VIEWER + GRID ================= */}
        <section className="tx-col tdm2-center seq" style={{ animationDelay: '.1s' }} aria-label="Weapon preview">
          <div className="tdm2-hero">
            <div>
              <h2>{entry.name}</h2>
              <p className="tdm2-class">{CLASS_LABEL[entry.cls]} · {CALIBER[entry.id].round}</p>
              <p className="tdm2-blurb">{entry.blurb}</p>
            </div>
            {fielded ? <span className="tx-tag gold">EQUIPPED</span>
              : owned ? <span className="tx-tag">IN RACK</span>
                : <span className="tx-tag lock"><TxLock size={11} /> {txFmt(entry.price)}</span>}
          </div>

          <div className="tdm2-stage">
            <TxCoords lat="33.7731° N" lon="44.4208° E" />
            <StatBars entry={entry} stats={stats} variant="tdm" />
            <div className="tdm2-viewer">
              <GunViewer weapon={selected} skin={skin} build={build} flashSlot={flash} onHotspot={openSlot} />
              <div className="tdm2-orbit-hint mono" aria-hidden="true">DRAG TO ORBIT · SCROLL TO ZOOM · CLICK THE GUN TO FIT PARTS</div>
            </div>
          </div>

          <div className="tdm2-grid" role="listbox" aria-label={`${gridTab} weapons`}>
            {gridList.map(w => {
              const isOwned = profile.ownedWeapons.includes(w.id);
              const isFielded = profile.loadout[w.slot].weapon === w.id;
              const isSel = w.id === selected;
              return (
                <button
                  key={w.id}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  className={`tdm2-cell ${isSel ? 'sel' : ''} ${isOwned ? '' : 'locked'}`}
                  onClick={() => selectWeapon(w.id)}
                  title={isOwned ? w.name : `${w.name} — ${txFmt(w.price)} in the Armory`}
                >
                  {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} /> : <span className="tdm2-cell-ph" />}
                  <span className="tdm2-cell-name mono">{w.short}</span>
                  {isFielded && <span className="tdm2-cell-tag">EQUIPPED <TxCheck size={11} /></span>}
                  {!isOwned && <span className="tdm2-cell-lock"><TxLock size={13} /></span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* ================= RIGHT — HARDPOINTS + THIS BUILD ================= */}
        <aside className="tx-col tdm2-right seq" style={{ animationDelay: '.14s' }} aria-label="Attachments and build">
          {menuSlot ? (
            <PartsPanel
              entry={entry} build={build} slot={menuSlot} parts={menuParts} owned={ownedParts}
              cash={profile.cash} mode="tdm"
              onEquip={equipPart} onBuy={buyPart} onStrip={() => unequipSlot(menuSlot)} onClose={() => setMenuSlot(null)}
            />
          ) : (
            <>
              <div className="tx-sec"><span>HARDPOINTS</span><b className="mono">{entry.short}</b></div>
              <HardpointRows entry={entry} build={build} onOpen={openSlot} />
              <div className="tx-sec" style={{ marginTop: 16 }}><span>THIS BUILD</span><b className="mono dim">{CALIBER[entry.id].round}</b></div>
              <div className="tdm2-build">
                <div className="tdm2-build-tags">
                  {tags.map(t => <span key={t} className="tdm2-build-tag mono">{t}</span>)}
                </div>
                <p className="tdm2-build-note">{CALIBER[entry.id].note}</p>
              </div>
              <p className="tx-hint mono">CLICK A HARDPOINT OR THE GUN TO FIT PARTS</p>
            </>
          )}
        </aside>
      </div>

      {toast && <div key={toast.key} className={`armory-toast mono ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div>}
    </div>
  );
}
