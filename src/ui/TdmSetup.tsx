// Recoil FPS — Warehouse TDM pre-match loadout.
// Pick armor, build your gun on the live viewer, read the enemy squad's kit.
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
import { BRAVO_ROSTER, TDM_ARMOR_NAMES, TDM_BASE_HP, TDM_HP_PER_ARMOR, TDM_HEAD_REDUCTION, TDM_BODY_REDUCTION, type TDMArmor } from '../game/tdm';
import {
  ArmorIcon, CALIBER, CLASS_LABEL, HardpointRows, OrangeDeploy, PartsPanel, StatBars,
  TxBack, TxCheck, TxCoords, TxLock, txFmt, weaponTags,
} from './tactical';
import mapArena from '../assets/map-arena.jpg';
import tdmBackdrop from '../assets/tdm-backdrop.jpg';

interface TdmSetupProps {
  profile: PlayerProfile;
  onProfile: (next: PlayerProfile) => void;
  armor: TDMArmor;
  onArmor: (a: TDMArmor) => void;
  onDeploy: () => void;
  onBack: () => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function TdmSetup({ profile, onProfile, armor, onArmor, onDeploy, onBack }: TdmSetupProps) {
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
        {/* ================= LEFT — ARMOR + BRAVO ================= */}
        <aside className="tx-col tdm2-left seq" style={{ animationDelay: '.06s' }} aria-label="Armor selection">
          <div className="tx-sec"><span>ARMOR</span><b className="mono">{TDM_BASE_HP + armor * TDM_HP_PER_ARMOR} HP</b></div>
          <div className="tdm2-armor-list" role="radiogroup" aria-label="Choose armor">
            {([0, 1, 2] as TDMArmor[]).map(a => (
              <button
                key={a}
                type="button"
                className={`tdm2-armor ${armor === a ? 'on' : ''}`}
                onClick={() => onArmor(a)}
                aria-pressed={armor === a}
              >
                <span className="tdm2-armor-ico"><ArmorIcon tier={a} /></span>
                <span className="tdm2-armor-body">
                  <b>{TDM_ARMOR_NAMES[a].toUpperCase()}</b>
                  <i className="mono">{TDM_BASE_HP + a * TDM_HP_PER_ARMOR} HP</i>
                  <em className="mono">{a === 0 ? 'Fast target · zero plating' : `Head −${pct(TDM_HEAD_REDUCTION[a])} · Body −${pct(TDM_BODY_REDUCTION[a])}`}</em>
                </span>
                {armor === a && <span className="tdm2-armor-check"><TxCheck /></span>}
              </button>
            ))}
          </div>

          <div className="tx-sec" style={{ marginTop: 16 }}><span>BRAVO SQUAD</span><b className="mono dim">ENEMY KIT</b></div>
          <div className="tdm2-enemy-list" aria-label="Enemy armor preview">
            {BRAVO_ROSTER.map(e => (
              <div key={e.name} className="tdm2-enemy mono">
                <i aria-hidden="true" />
                <b>{e.name}</b>
                <span className={`tdm2-enemy-armor a${e.armor}`}>{TDM_ARMOR_NAMES[e.armor]}</span>
              </div>
            ))}
          </div>
          <p className="tx-hint mono">HEAVIER TARGETS NEED MORE ROUNDS — AIM HIGH.</p>
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
              <GunViewer weapon={selected} skin={skin} build={build} activeSlot={menuSlot} flashSlot={flash} onHotspot={openSlot} />
              <div className="tdm2-orbit-hint mono" aria-hidden="true">DRAG TO ORBIT · SCROLL TO ZOOM · CLICK PINS TO FIT PARTS</div>
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
                {t.toUpperCase()}
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

        {/* ================= RIGHT — HARDPOINTS + RULES ================= */}
        <aside className="tx-col tdm2-right seq" style={{ animationDelay: '.14s' }} aria-label="Attachments and rules">
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
              <div className="tx-sec" style={{ marginTop: 16 }}><span>LOADOUT RULES</span><b className="mono dim">TDM</b></div>
              <div className="tx-rulebox mono">
                <p>▸ Every combatant spawns with <b>3 frags + 1 flash</b>.</p>
                <p>▸ TDM ballistics: damage tuned so headshots take <b>3+ hits</b>.</p>
                <p>▸ Armor cuts head and body damage — check Bravo's kit.</p>
                <p>▸ Respawn in <b>5s</b> at your protected yard.</p>
                <p>▸ Most kills at <b>2:30</b> wins the match.</p>
              </div>
              <p className="tx-hint mono">CLICK A HARDPOINT OR A BRASS PIN TO FIT PARTS</p>
            </>
          )}
        </aside>
      </div>

      {/* ================= FOOTER ================= */}
      <footer className="tdm2-foot seq" style={{ animationDelay: '.18s' }}>
        <div className="tdm2-brand">
          <b>RECOIL</b>
          <span>DESERT OPERATIONS<br />SINGLE OPERATOR</span>
        </div>
        <div className="tdm2-sum mono">
          {TDM_ARMOR_NAMES[armor].toUpperCase()} ARMOR · {TDM_BASE_HP + armor * TDM_HP_PER_ARMOR} HP
          &nbsp;·&nbsp; 1 {weaponById(profile.loadout.primary.weapon)?.short} · 2 {weaponById(profile.loadout.secondary.weapon)?.short}
        </div>
        <OrangeDeploy title="PLAY" hint="WAREHOUSE · 5V5 TDM" onClick={onDeploy} />
      </footer>

      {toast && <div key={toast.key} className={`armory-toast mono ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div>}
    </div>
  );
}
