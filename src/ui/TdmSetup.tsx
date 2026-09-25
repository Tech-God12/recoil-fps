// Recoil FPS — Warehouse TDM pre-match loadout.
// Build your gun on the live viewer and pick the two weapons you deploy with.
// Armor is fixed (everyone spawns in light plating), so there is nothing to pick.
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
  CALIBER, CLASS_LABEL, HardpointRows, OrangeDeploy, PartsPanel, StatBars,
  TxBack, TxCheck, TxCoords, TxLock, txFmt, weaponTags,
} from './tactical';
import mapArena from '../assets/map-arena.jpg';
import tdmBackdrop from '../assets/tdm-backdrop.jpg';

interface TdmSetupProps {
  profile: PlayerProfile;
  onProfile: (next: PlayerProfile) => void;
  onDeploy: () => void;
  onBack: () => void;
}

export default function TdmSetup({ profile, onProfile, onDeploy, onBack }: TdmSetupProps) {
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
    if (!profile.ownedWeapons.includes(id)) { say(`${w.name} is locked — ${txFmt(w.price)} in the armory`, true); return; }
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
        <div className="tx-title"><b>Loadout</b><em>5v5 team deathmatch · 2:30 · 5s respawn</em></div>
        <div className="tdm2-mapchip">
          <img src={mapArena} alt="" draggable={false} />
          <span>Warehouse</span>
        </div>
        <OrangeDeploy title="Play" hint="5v5 deathmatch" onClick={onDeploy} />
      </header>

      <div className="tdm2-main">
        {/* ================= CENTER — HERO + VIEWER + GRID ================= */}
        <section className="tx-col tdm2-center seq" style={{ animationDelay: '.06s' }} aria-label="Weapon preview">
          <div className="tdm2-hero">
            <div>
              <h2>{entry.name}</h2>
              <p className="tdm2-class">{CLASS_LABEL[entry.cls]} · {CALIBER[entry.id].round}</p>
              <p className="tdm2-blurb">{entry.blurb}</p>
            </div>
            {fielded ? <span className="tx-tag gold">Equipped</span>
              : owned ? <span className="tx-tag">In rack</span>
                : <span className="tx-tag lock"><TxLock size={11} /> {txFmt(entry.price)}</span>}
          </div>

          <div className="tdm2-stage">
            <TxCoords lat="33.7731° N" lon="44.4208° E" />
            <StatBars entry={entry} stats={stats} variant="tdm" />
            <div className="tdm2-viewer">
              <GunViewer weapon={selected} skin={skin} build={build} flashSlot={flash} onHotspot={openSlot} />
              <div className="tdm2-orbit-hint mono" aria-hidden="true">Drag to orbit · scroll to zoom · click the gun to fit parts</div>
            </div>
            <div className="tdm2-desc">
              <b>{tags.join('. ')}.</b>
              <p>{CALIBER[entry.id].note}</p>
            </div>
          </div>

          <div className="tdm2-tabs" role="tablist" aria-label="Weapon slot">
            {(['primary', 'secondary'] as SlotId[]).map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={gridTab === t}
                className={`tdm2-tab ${gridTab === t ? 'on' : ''}`}
                onClick={() => setGridTab(t)}
              >
                {t === 'primary' ? 'Primary' : 'Sidearm'}
              </button>
            ))}
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
                  title={isOwned ? w.name : `${w.name} — ${txFmt(w.price)} in the armory`}
                >
                  {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} /> : <span className="tdm2-cell-ph" />}
                  <span className="tdm2-cell-name mono">{w.short}</span>
                  {isFielded && <span className="tdm2-cell-tag">Equipped <TxCheck size={11} /></span>}
                  {!isOwned && <span className="tdm2-cell-lock"><TxLock size={13} /></span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* ================= RIGHT — HARDPOINTS ================= */}
        <aside className="tx-col tdm2-right seq" style={{ animationDelay: '.1s' }} aria-label="Attachments">
          {menuSlot ? (
            <PartsPanel
              entry={entry} build={build} slot={menuSlot} parts={menuParts} owned={ownedParts}
              cash={profile.cash} mode="tdm"
              onEquip={equipPart} onBuy={buyPart} onStrip={() => unequipSlot(menuSlot)} onClose={() => setMenuSlot(null)}
            />
          ) : (
            <>
              <div className="tx-sec"><span>Attachments</span><b className="mono">{entry.short}</b></div>
              <HardpointRows entry={entry} build={build} onOpen={openSlot} />
              <p className="tx-hint mono">Click a slot or the gun itself to fit parts</p>
            </>
          )}
        </aside>
      </div>

      {toast && <div key={toast.key} className={`armory-toast mono ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div>}
    </div>
  );
}
