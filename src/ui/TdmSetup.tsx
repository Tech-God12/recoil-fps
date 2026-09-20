// Recoil FPS — WAREHOUSE TDM pre-match setup (PUBG-style full-screen loadout).
// Left: armor picker + enemy armor preview. Center: GunViewer + weapon grids.
// Right: attachment parts + loadout rules. Bottom: DEPLOY TO WAREHOUSE.
import { useEffect, useMemo, useState } from 'react';
import {
  WEAPON_CATALOG, attachmentById, attachmentsFor, weaponById,
  type AttachSlot, type AttachmentId, type WeaponId,
} from '../game/economy/catalog';
import { resolveWeaponStats } from '../game/economy/stats';
import {
  buildForWeapon, equipAttachment,
  type PlayerProfile,
} from '../game/economy/profile';
import { type Loadout, type WeaponBuild } from '../game/economy/loadout';
import { skinFor } from '../game/economy/profile';
import GunViewer, { SLOT_LABELS, gunThumbnail } from './armory/GunViewer';
import { ARMOR_HP, ARMOR_ICON, ARMOR_LABEL, ARMOR_HEAD, ARMOR_BODY, BRAVO_NAMES, BRAVO_ARMOR, type TDMArmor } from '../game/tdm';

interface TdmSetupProps {
  profile: PlayerProfile;
  onProfile: (next: PlayerProfile) => void;
  armor: TDMArmor;
  onArmor: (armor: TDMArmor) => void;
  loadout: Loadout;
  onLoadout: (next: Loadout) => void;
  onDeploy: () => void;
  onBack: () => void;
}

const ARMOR_BLURB = [
  'Nothing but fatigues and hustle. You go down quick and you move like it.',
  'Standard plates. Shrug off body fire, keep your legs moving.',
  'Composite everything. Slow to maneuver, miserable to kill.',
] as const;
const ARMOR_STATS = [
  { hp: '150 HP', head: 'HEAD 0%', body: 'BODY 0%' },
  { hp: '180 HP', head: `HEAD −${Math.round((1 - ARMOR_HEAD[1]) * 100)}%`, body: `BODY −${Math.round((1 - ARMOR_BODY[1]) * 100)}%` },
  { hp: '210 HP', head: `HEAD −${Math.round((1 - ARMOR_HEAD[2]) * 100)}%`, body: `BODY −${Math.round((1 - ARMOR_BODY[2]) * 100)}%` },
] as const;

const ARMOR_SPEED_LABEL = ['FASTEST', 'BALANCED', 'TANKY'] as const;

export default function TdmSetup({ profile, onProfile, armor, onArmor, loadout, onLoadout, onDeploy, onBack }: TdmSetupProps) {
  const [selected, setSelected] = useState<WeaponId>(loadout.primary.weapon);
  const [menuSlot, setMenuSlot] = useState<AttachSlot | null>(null);
  const [flash, setFlash] = useState<{ slot: AttachSlot; key: number } | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [thumbs, setThumbs] = useState<Partial<Record<WeaponId, string>>>({});

  useEffect(() => {
    const next: Partial<Record<WeaponId, string>> = {};
    for (const w of WEAPON_CATALOG) next[w.id] = gunThumbnail(w.id);
    setThumbs(next);
  }, []);

  const entry = weaponById(selected)!;
  const owned = profile.ownedWeapons.includes(selected);
  const skin = skinFor(profile, selected);
  /** The build the DEPLOY button will actually send: override loadout wins. */
  const activeBuild: WeaponBuild = useMemo(() => {
    const slot = entry.slot;
    const fromOverride = loadout[slot].weapon === selected ? loadout[slot] : undefined;
    return fromOverride ?? buildForWeapon(profile, selected);
  }, [loadout, profile, selected, entry.slot]);
  const stats = useMemo(() => {
    const mods = Object.values(activeBuild.attachments).map(id => attachmentById(id)?.mods).filter(m => !!m);
    return resolveWeaponStats(entry.base, mods);
  }, [activeBuild, entry]);

  const pulse = (slot: AttachSlot) => {
    const key = flashKey + 1;
    setFlashKey(key);
    setFlash({ slot, key });
  };

  const pickWeapon = (id: WeaponId) => {
    const w = weaponById(id)!;
    setSelected(id);
    setMenuSlot(null);
    if (!profile.ownedWeapons.includes(id)) return; // locked guns preview only — no buying here
    if (loadout[w.slot].weapon !== id) {
      const carry = buildForWeapon(profile, id);
      const next: Loadout = { ...loadout, [w.slot]: carry };
      onLoadout(next);
    }
  };

  const equipPart = (id: AttachmentId) => {
    const part = attachmentById(id)!;
    const slot = entry.slot; // attachments land on the weapon's own loadout slot
    const base = activeBuild;
    const res = owned
      ? equipAttachment(profile, selected, id, part.slot)
      : { ok: true as const, value: profile };
    if (!res.ok) return;
    if (owned) onProfile(res.value);
    const nextAtts = { ...base.attachments, [part.slot]: id };
    const nextLoadout: Loadout = { ...loadout, [slot]: { ...base, attachments: nextAtts } };
    onLoadout(nextLoadout);
    pulse(part.slot);
  };

  const unequipSlot = (slot: AttachSlot) => {
    const slotId = entry.slot;
    const nextAtts = { ...activeBuild.attachments };
    delete nextAtts[slot];
    onLoadout({ ...loadout, [slotId]: { ...activeBuild, attachments: nextAtts } });
    if (owned) {
      const res = equipAttachment(profile, selected, null, slot);
      if (res.ok) onProfile(res.value);
    }
  };

  const menuParts = menuSlot ? attachmentsFor(selected, menuSlot) : [];
  const ownedParts = profile.ownedAttachments[selected] ?? [];
  const primaryGuns = WEAPON_CATALOG.filter(w => w.slot === 'primary');
  const secondaryGuns = WEAPON_CATALOG.filter(w => w.slot === 'secondary');

  const gunCard = (w: (typeof WEAPON_CATALOG)[number]) => {
    const isOwned = profile.ownedWeapons.includes(w.id);
    const isFielded = loadout[w.slot].weapon === w.id;
    return (
      <button key={w.id} className={`tdm-gun-card ${w.id === selected ? 'sel' : ''} ${isFielded ? 'fielded' : ''} ${isOwned ? '' : 'locked'}`}
        onClick={() => pickWeapon(w.id)} aria-pressed={w.id === selected}>
        {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} /> : <span className="tdm-gun-thumb-blank" />}
        <span className="tdm-gun-meta">
          <b>{w.name}</b>
          <i className="mono">{w.cls}</i>
        </span>
        <span className="tdm-gun-state mono">{isFielded ? 'EQUIPPED' : isOwned ? 'OWNED' : '🔒 LOCKED'}</span>
      </button>
    );
  };

  return (
    <main className="tdm-root anim-fade">
      <div className="tdm-glow" aria-hidden="true" />
      <header className="tdm-topbar">
        <button className="cmd-back" onClick={onBack}><span aria-hidden="true">‹</span> Back</button>
        <div className="tdm-topbar-center">
          <span className="tdm-topbar-title">WAREHOUSE TDM — 5v5 TEAM DEATHMATCH</span>
          <span className="tdm-topbar-sub mono">3 FRAG + 1 FLASH · 2:30 MATCH · 10s RESPAWN</span>
        </div>
        <span className="tdm-econ mono">FREE LOADOUT · NO CASH</span>
      </header>

      <div className="tdm-columns">
        {/* ================= LEFT — ARMOR ================= */}
        <aside className="tdm-panel tdm-left" aria-label="Armor picker">
          <div className="tdm-panel-head"><span className="stencil">Armor</span><span className="mono tdm-panel-note">WORN INTO THE MATCH</span></div>
          <div className="tdm-armor-list" role="radiogroup" aria-label="Armor level">
            {([0, 1, 2] as TDMArmor[]).map(level => (
              <button key={level} role="radio" aria-checked={armor === level}
                className={`tdm-armor-card a${level} ${armor === level ? 'on' : ''}`} onClick={() => onArmor(level)}>
                <span className="tdm-armor-icon" aria-hidden="true">{ARMOR_ICON[level]}</span>
                <span className="tdm-armor-body">
                  <b>{ARMOR_LABEL[level]}</b>
                  <i className="mono">{ARMOR_STATS[level].hp} · {ARMOR_SPEED_LABEL[level]}</i>
                  <i className="mono dim">{ARMOR_STATS[level].head} · {ARMOR_STATS[level].body}</i>
                  <em>{ARMOR_BLURB[level]}</em>
                </span>
                <span className={`tdm-armor-pick mono ${armor === level ? 'on' : ''}`}>{armor === level ? 'EQUIPPED' : 'EQUIP'}</span>
              </button>
            ))}
          </div>
          <div className="tdm-panel-head" style={{ marginTop: 'auto' }}><span className="stencil">Enemy Armor — BRAVO</span></div>
          <div className="tdm-enemy-list" aria-label="Enemy armor preview">
            {BRAVO_NAMES.map((name, i) => (
              <span key={name} className="tdm-enemy-row">
                <i className="tdm-armor-icon sm" aria-hidden="true">{ARMOR_ICON[BRAVO_ARMOR[i]]}</i>
                <b>{name}</b>
                <em className="mono">{ARMOR_LABEL[BRAVO_ARMOR[i]]} · {ARMOR_HP[BRAVO_ARMOR[i]]}HP</em>
              </span>
            ))}
          </div>
        </aside>

        {/* ================= CENTER — GUN VIEWER ================= */}
        <section className="tdm-panel tdm-center" aria-label="Weapon preview">
          <div className="tdm-stage-head">
            <div>
              <h2>{entry.name}</h2>
              <p className="mono">{entry.cls} · {entry.slot.toUpperCase()} SLOT{owned ? '' : ' · LOCKED PREVIEW'}</p>
            </div>
            <div className="stage-ribbon mono" aria-label="Key weapon figures">
              <div><span>DMG</span><b>{stats.damage.toFixed(0)}</b></div>
              <div><span>RPM</span><b>{stats.rpm}</b></div>
              <div><span>MAG</span><b>{stats.magSize}</b></div>
              <div><span>ADS</span><b>{(stats.adsTime * 1000).toFixed(0)}ms</b></div>
            </div>
          </div>
          <div className="tdm-stage">
            <GunViewer weapon={selected} skin={skin} build={activeBuild} activeSlot={menuSlot} flashSlot={flash}
              onHotspot={slot => setMenuSlot(cur => (cur === slot ? null : slot))} />
            <div className="stage-fallback mono" aria-hidden="true">Drag to orbit · Click brass pins to open attachment slots</div>
          </div>
          <div className="tdm-grids">
            <div className="tdm-grid-block">
              <div className="tdm-grid-head"><span className="stencil">Primary</span><span className="mono dim">{loadout.primary.weapon ? weaponById(loadout.primary.weapon)?.name : ''}</span></div>
              <div className="tdm-gun-grid cols2">{primaryGuns.map(gunCard)}</div>
            </div>
            <div className="tdm-grid-block">
              <div className="tdm-grid-head"><span className="stencil">Secondary</span><span className="mono dim">{weaponById(loadout.secondary.weapon)?.name}</span></div>
              <div className="tdm-gun-grid">{secondaryGuns.map(gunCard)}</div>
            </div>
          </div>
        </section>

        {/* ================= RIGHT — ATTACHMENTS + RULES ================= */}
        <aside className="tdm-panel tdm-right" aria-label="Attachments and loadout rules">
          {menuSlot ? (
            <div className="partmenu" key={menuSlot}>
              <div className="partmenu-head">
                <span>{SLOT_LABELS[menuSlot]} — {entry.short}</span>
                <button className="util-btn" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => setMenuSlot(null)}>Close</button>
              </div>
              {activeBuild.attachments[menuSlot] && (
                <button className="part-strip" onClick={() => unequipSlot(menuSlot)}>
                  <span>Strip {attachmentById(activeBuild.attachments[menuSlot]!)!.name}</span>
                  <span className="mono">Back to stock</span>
                </button>
              )}
              <div className="partmenu-list">
                {menuParts.map(part => {
                  const isOwned = ownedParts.includes(part.id);
                  const isEquipped = activeBuild.attachments[menuSlot] === part.id;
                  return (
                    <div key={part.id} className={`pcard ${isEquipped ? 'equipped' : ''}`}>
                      <div className="pcard-head">
                        <strong>{part.name}</strong>
                        <span className="pcard-tier" aria-label={`tier ${part.tier}`}>
                          {[1, 2, 3].map(i => <i key={i} className={i <= part.tier ? 'on' : ''} />)}
                        </span>
                      </div>
                      <p className="pcard-desc">{part.desc}</p>
                      <div className="pcard-mods">
                        {part.pros.map(p => <span key={p} className="pro">+ {p}</span>)}
                        {part.cons.map(c => <span key={c} className="con">− {c}</span>)}
                      </div>
                      {isEquipped ? (
                        <button className="pcard-btn equipped" onClick={() => unequipSlot(menuSlot)}>Equipped — click to strip</button>
                      ) : isOwned && owned ? (
                        <button className="pcard-btn" onClick={() => equipPart(part.id)}>Equip</button>
                      ) : (
                        <button className="pcard-btn buy" disabled title="Unlocks through the campaign">
                          {owned ? '🔒 Locked — unlock in campaign' : '🔒 Weapon not unlocked'}
                        </button>
                      )}
                    </div>
                  );
                })}
                {menuParts.length === 0 && <p className="partmenu-empty mono">No compatible parts for this socket.</p>}
              </div>
            </div>
          ) : (
            <div className="tdm-rules">
              <div className="tdm-panel-head"><span className="stencil">Loadout Rules</span></div>
              <ul className="tdm-rules-list mono">
                <li>ALL OPERATORS DEPLOY WITH 3× FRAG + 1× FLASH — EVERY RESPAWN.</li>
                <li>NO CASH ECONOMY IN MATCH. YOUR UNLOCKED GUNS ARE FREE.</li>
                <li>🔒 GEAR STAYS LOCKED — EARN IT IN THE CAMPAIGN ARMORY.</li>
                <li>MAIN + SECONDARY + ATTACHMENTS RIDE THE WHOLE MATCH.</li>
                <li>CLICK A BRASS PIN ON THE GUN (OR A SLOT HERE) TO FIT PARTS.</li>
                <li>10s RESPAWN · FIRST TO OUT-FRAG IN 2:30 TAKES THE WAREHOUSE.</li>
              </ul>
              <div className="tdm-panel-head"><span className="stencil">Your Deploy</span></div>
              <div className="tdm-deploy-summary">
                <span className="tdm-enemy-row">
                  <i className="tdm-armor-icon sm" aria-hidden="true">{ARMOR_ICON[armor]}</i>
                  <b>YOU</b>
                  <em className="mono">{ARMOR_LABEL[armor]} · {ARMOR_HP[armor]}HP</em>
                </span>
                <span className="tdm-enemy-row">
                  <i className="tdm-armor-icon sm" aria-hidden="true">⌖</i>
                  <b>MAIN</b>
                  <em className="mono">{weaponById(loadout.primary.weapon)?.name}</em>
                </span>
                <span className="tdm-enemy-row">
                  <i className="tdm-armor-icon sm" aria-hidden="true">⌖</i>
                  <b>SIDE</b>
                  <em className="mono">{weaponById(loadout.secondary.weapon)?.name}</em>
                </span>
              </div>
              <p className="tdm-rules-hint mono">Attachment panel opens when you click a slot on the gun.</p>
            </div>
          )}
        </aside>
      </div>

      <footer className="tdm-deploybar">
        <span className="tdm-deploybar-note mono">TEAM ALPHA · 4 AI SQUADMATES + YOU · VS TEAM BRAVO · 5 AI</span>
        <button className="tdm-deploy-btn" onClick={onDeploy}>DEPLOY TO WAREHOUSE <span aria-hidden="true">→</span></button>
      </footer>
    </main>
  );
}
