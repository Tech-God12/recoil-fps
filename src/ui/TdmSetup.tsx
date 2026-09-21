// Recoil FPS — Warehouse TDM pre-match loadout.
// Full-screen setup shown between Deploy and the actual drop: pick armor, build
// your gun on the live viewer (brass-pin hotspots), read the enemy squad's kit.
import { useEffect, useMemo, useState } from 'react';
import {
  WEAPON_CATALOG, attachmentById, attachmentsFor, weaponById,
  type AttachSlot, type AttachmentId, type WeaponId,
} from '../game/economy/catalog';
import { resolveWeaponStats } from '../game/economy/stats';
import {
  buildForWeapon, buyAttachment, equipAttachment, setLoadoutWeapon, skinFor,
  type PlayerProfile,
} from '../game/economy/profile';
import { weaponTexturesReady } from '../game/weapons/finish';
import GunViewer, { SLOT_LABELS, gunThumbnail } from './armory/GunViewer';
import { BRAVO_ROSTER, TDM_ARMOR_ICONS, TDM_ARMOR_NAMES, TDM_BASE_HP, TDM_HP_PER_ARMOR, TDM_HEAD_REDUCTION, TDM_BODY_REDUCTION, type TDMArmor } from '../game/tdm';

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
  const skin = skinFor(profile, selected);
  const build = useMemo(() => buildForWeapon(profile, selected), [profile, selected]);
  const stats = useMemo(() => {
    const mods = Object.values(build.attachments).map(id => attachmentById(id)?.mods).filter(m => !!m);
    return resolveWeaponStats(entry.base, mods);
  }, [build, entry]);

  const primaries = WEAPON_CATALOG.filter(w => w.slot === 'primary');
  const secondaries = WEAPON_CATALOG.filter(w => w.slot === 'secondary');

  const pulse = (slot: AttachSlot) => { const key = flashKey + 1; setFlashKey(key); setFlash({ slot, key }); };

  const selectWeapon = (id: WeaponId) => {
    const w = weaponById(id)!;
    if (!profile.ownedWeapons.includes(id)) { say(`${w.name} is locked — unlock it in the Armory`, true); return; }
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

  const WeaponGrid = ({ list, label }: { list: typeof WEAPON_CATALOG; label: string }) => (
    <div className="tdm-wgrid-block">
      <div className="sec-label"><span>{label}</span><span className="mono">{list.length} guns</span></div>
      <div className="tdm-wgrid">
        {list.map(w => {
          const isOwned = profile.ownedWeapons.includes(w.id);
          const fielded = profile.loadout[w.slot].weapon === w.id;
          return (
            <button
              key={w.id}
              className={`tdm-wcell ${w.id === selected ? 'sel' : ''} ${isOwned ? '' : 'locked'}`}
              onClick={() => selectWeapon(w.id)}
              aria-pressed={w.id === selected}
            >
              {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} /> : <span className="tdm-wcell-ph" />}
              <span className="tdm-wcell-name">{w.short}</span>
              {fielded && <span className="tdm-wcell-tag">EQUIPPED</span>}
              {!isOwned && <span className="tdm-wcell-tag lock">LOCKED</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="armory-root tdm-root" onKeyDown={e => { if (e.key === 'Escape' && menuSlot) setMenuSlot(null); }}>
      <div className="armory-glow" aria-hidden="true" />
      <div className="armory-vignette" aria-hidden="true" />

      <header className="cmdbar">
        <button className="cmd-back" onClick={onBack}><span aria-hidden="true">‹</span> Back</button>
        <div className="tdm-rules-chip mono">3 FRAG + 1 FLASH &nbsp;·&nbsp; 2:30 MATCH &nbsp;·&nbsp; 5s RESPAWN</div>
        <span className="tdm-title-chip">WAREHOUSE — 5v5 TDM</span>
      </header>

      <div className="tdm-main">
        {/* ============ LEFT — ARMOR ============ */}
        <aside className="armory-rail tdm-left" aria-label="Armor selection">
          <div className="rail-head">
            <span className="stencil">Armor</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--bone-mute)' }}>{TDM_BASE_HP + armor * TDM_HP_PER_ARMOR} HP</span>
          </div>
          <div className="tdm-armor-list" role="radiogroup" aria-label="Choose armor">
            {([0, 1, 2] as TDMArmor[]).map(a => (
              <button key={a} className={`tdm-armor ${armor === a ? 'on' : ''}`} onClick={() => onArmor(a)} aria-pressed={armor === a}>
                <span className="tdm-armor-icon" aria-hidden="true">{TDM_ARMOR_ICONS[a]}</span>
                <span className="tdm-armor-body">
                  <b>{TDM_ARMOR_NAMES[a]}</b>
                  <i className="mono">{TDM_BASE_HP + a * TDM_HP_PER_ARMOR} HP</i>
                  <em className="mono">{a === 0 ? 'Fast target · zero plating' : `Head −${pct(TDM_HEAD_REDUCTION[a])} · Body −${pct(TDM_BODY_REDUCTION[a])}`}</em>
                </span>
              </button>
            ))}
          </div>

          <div className="rail-head" style={{ marginTop: 14 }}>
            <span className="stencil">Bravo squad</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--bone-mute)' }}>enemy kit</span>
          </div>
          <div className="tdm-enemy-list" aria-label="Enemy armor preview">
            {BRAVO_ROSTER.map(e => (
              <div key={e.name} className="tdm-enemy mono">
                <span className="tdm-enemy-icon" aria-hidden="true">{TDM_ARMOR_ICONS[e.armor]}</span>
                <b>{e.name}</b>
                <span className={`tdm-enemy-armor a${e.armor}`}>{TDM_ARMOR_NAMES[e.armor]}</span>
              </div>
            ))}
          </div>
          <p className="armory-rail-hint mono">Heavier targets need more rounds — aim high</p>
        </aside>

        {/* ============ CENTER — GUN + GRIDS ============ */}
        <section className="armory-stage tdm-stage" aria-label="Weapon preview">
          <div className="armory-stage-head">
            <div>
              <h2>{entry.name}</h2>
              <p>{entry.cls} · click a brass pin to fit parts</p>
            </div>
            <div className="armory-stage-tags"><span className="tag-fielded">TDM issue — free</span></div>
          </div>

          <div className="stage-viewport tdm-viewport">
            <GunViewer weapon={selected} skin={skin} build={build} activeSlot={menuSlot} flashSlot={flash} onHotspot={openSlot} />
          </div>

          <div className="stage-ribbon mono" aria-label="Key weapon figures">
            <div><span>DMG</span><b>{stats.damage.toFixed(0)}</b></div>
            <div><span>RPM</span><b>{stats.rpm}</b></div>
            <div><span>MAG</span><b>{stats.magSize}</b></div>
            <div><span>ADS</span><b>{(stats.adsTime * 1000).toFixed(0)}ms</b></div>
          </div>

          <div className="tdm-grids">
            <WeaponGrid list={primaries} label="Primary" />
            <WeaponGrid list={secondaries} label="Secondary" />
          </div>
        </section>

        {/* ============ RIGHT — PARTS + RULES ============ */}
        <aside className="armory-panel tdm-right" aria-label="Attachments and rules">
          {menuSlot ? (
            <div className="partmenu" key={menuSlot}>
              <div className="partmenu-head">
                <span>{SLOT_LABELS[menuSlot]} — {entry.short}</span>
                <button className="util-btn" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => setMenuSlot(null)}>Close</button>
              </div>
              {build.attachments[menuSlot] && (
                <button className="part-strip" onClick={() => unequipSlot(menuSlot)}>
                  <span>Strip {attachmentById(build.attachments[menuSlot]!)!.name}</span>
                  <span className="mono">Back to stock</span>
                </button>
              )}
              <div className="partmenu-list">
                {menuParts.map(part => {
                  const isOwned = ownedParts.includes(part.id);
                  const isEquipped = build.attachments[menuSlot] === part.id;
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
                      ) : isOwned ? (
                        <button className="pcard-btn" onClick={() => equipPart(part.id)}>Equip</button>
                      ) : (
                        <button className="pcard-btn buy" onClick={() => buyPart(part.id)}>Buy &amp; Equip</button>
                      )}
                    </div>
                  );
                })}
                {menuParts.length === 0 && <p className="partmenu-empty mono">No compatible parts for this socket.</p>}
              </div>
            </div>
          ) : (
            <div className="statpanel">
              <div className="sec-label"><span>Hardpoints</span><span className="mono">{entry.short}</span></div>
              <div className="hardpoint-list" aria-label="Equipped attachments">
                {entry.slots.map(slot => {
                  const id = build.attachments[slot];
                  const part = id ? attachmentById(id) : undefined;
                  return (
                    <button key={slot} className={`hardpoint ${part ? 'filled' : ''}`} onClick={() => openSlot(slot)}>
                      <i>{SLOT_LABELS[slot]}</i>
                      <b>{part ? part.name : 'Stock'}</b>
                      <span aria-hidden="true">›</span>
                    </button>
                  );
                })}
              </div>

              <div className="sec-label" style={{ marginTop: 14 }}><span>Loadout rules</span><span className="mono">TDM</span></div>
              <div className="tdm-rulebox mono">
                <p>▸ Every combatant spawns with <b>3 frags + 1 flash</b>.</p>
                <p>▸ TDM ballistics: damage tuned so headshots take <b>3+ hits</b>.</p>
                <p>▸ Armor cuts head and body damage — check Bravo's kit.</p>
                <p>▸ Respawn in <b>5s</b> at your protected yard.</p>
                <p>▸ Most kills at <b>2:30</b> wins the match.</p>
              </div>
              <p className="statpanel-hint mono">Click a hardpoint or a brass pin to fit parts</p>
            </div>
          )}
        </aside>
      </div>

      <footer className="tdm-footer">
        <div className="tdm-footer-sum mono">
          {TDM_ARMOR_ICONS[armor]} {TDM_ARMOR_NAMES[armor]} armor · {TDM_BASE_HP + armor * TDM_HP_PER_ARMOR} HP
          &nbsp;·&nbsp; 1 {weaponById(profile.loadout.primary.weapon)?.short} · 2 {weaponById(profile.loadout.secondary.weapon)?.short}
        </div>
        <button className="deploy-btn tdm-deploy" onClick={onDeploy}>
          <span>Play</span>
          <span className="hint">Warehouse · 5v5 · 2:30</span>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="square" /></svg>
        </button>
      </footer>

      {toast && <div key={toast.key} className={`armory-toast mono ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div>}
    </div>
  );
}
