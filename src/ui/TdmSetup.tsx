// Recoil FPS — WAREHOUSE TDM setup: the pre-match loadout screen.
//
// Left   armour picker (3 tiers) + the BRAVO armour preview you are walking into
// Centre the live gun with brass hardpoint pins, key figures, and the two weapon
//        grids (primary in two columns, secondary below) fed by WEAPON_CATALOG
// Right  the attachment panel for whichever hardpoint pin is open + loadout rules
// Bottom DEPLOY TO WAREHOUSE
import { useEffect, useMemo, useState } from 'react';
import {
  WEAPON_CATALOG, attachmentById, attachmentsFor, weaponById,
  type AttachSlot, type SlotId, type WeaponId,
} from '../game/economy/catalog';
import {
  buyAttachment, equipAttachment, type PlayerProfile,
} from '../game/economy/profile';
import { resolveWeaponStats } from '../game/economy/stats';
import { skinFor } from '../game/economy/profile';
import type { Loadout, WeaponBuild } from '../game/economy/loadout';
import {
  ALPHA_ROSTER, ARMOR_TABLE, BRAVO_ROSTER, TDM_FLASHES, TDM_FRAGS, TDM_MATCH_SECONDS,
  TDM_RESPAWN_SECONDS, TDM_TEAM_SIZE, armorOf, bodyShotsToKillRifle, headshotsToKillRifle,
  type ArmorLevel,
} from '../game/tdm/armor';
import { weaponTexturesReady } from '../game/weapons/finish';
import GunViewer, { SLOT_LABELS, gunThumbnail } from './armory/GunViewer';

export interface TdmSetupProps {
  profile: PlayerProfile;
  armor: ArmorLevel;
  onArmor: (a: ArmorLevel) => void;
  loadout: Loadout;
  onLoadout: (l: Loadout) => void;
  onProfile: (p: PlayerProfile) => void;
  onDeploy: () => void;
  onBack: () => void;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export default function TdmSetup({
  profile, armor, onArmor, loadout, onLoadout, onProfile, onDeploy, onBack,
}: TdmSetupProps) {
  const [slot, setSlot] = useState<SlotId>('primary');
  const [menuSlot, setMenuSlot] = useState<AttachSlot | null>(null);
  const [flash, setFlash] = useState<{ slot: AttachSlot; key: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number; bad?: boolean } | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<WeaponId, string>>>({});

  const build = loadout[slot];
  const entry = weaponById(build.weapon) ?? weaponById('m4a1')!;
  const skin = skinFor(profile, entry.id);
  const owned = profile.ownedWeapons.includes(entry.id);

  // Thumbnails are rendered one per frame: ten WebGL renders in one click would
  // stall the screen, and the grid already shows names while they arrive.
  useEffect(() => {
    let live = true;
    void weaponTexturesReady.then(async () => {
      for (const w of WEAPON_CATALOG) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!live) return;
        const url = gunThumbnail(w.id);
        setThumbs(prev => ({ ...prev, [w.id]: url }));
      }
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.key === toast.key ? null : cur)), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);
  const say = (text: string, bad = false) => setToast({ text, key: Date.now() + Math.random(), bad });

  const stats = useMemo(() => {
    const mods = Object.values(build.attachments)
      .map(id => attachmentById(id)?.mods)
      .filter((m): m is NonNullable<typeof m> => !!m);
    return resolveWeaponStats(entry.base, mods);
  }, [build, entry]);

  const setSlotWeapon = (id: WeaponId) => {
    const picked = weaponById(id);
    if (!picked) return;
    if (picked.slot !== slot) return;
    // Warehouse TDM is a range issue: every catalog gun is available, and unlocked
    // ones keep their saved build. No cash changes hands (spec §3).
    const saved = profile.builds[id];
    const next: WeaponBuild = profile.ownedWeapons.includes(id) && saved
      ? { weapon: id, attachments: { ...saved.attachments } }
      : { weapon: id, attachments: {} };
    const other = slot === 'primary' ? loadout.secondary : loadout.primary;
    if (other.weapon === id) { say('Already your other slot', true); return; }
    onLoadout(slot === 'primary' ? { primary: next, secondary: loadout.secondary } : { primary: loadout.primary, secondary: next });
    setMenuSlot(null);
  };

  const equipPart = (partId: string) => {
    if (!menuSlot) return;
    const next: WeaponBuild = { weapon: build.weapon, attachments: { ...build.attachments, [menuSlot]: partId } };
    onLoadout(slot === 'primary' ? { primary: next, secondary: loadout.secondary } : { primary: loadout.primary, secondary: next });
    setFlash({ slot: menuSlot, key: Date.now() });
    // Keep the player's permanent profile in sync when this gun is actually owned.
    if (owned) {
      const res = equipAttachment(profile, build.weapon, partId, menuSlot);
      if (res.ok) onProfile(res.value);
    }
  };

  const stripPart = () => {
    if (!menuSlot) return;
    const atts = { ...build.attachments };
    delete atts[menuSlot];
    const next: WeaponBuild = { weapon: build.weapon, attachments: atts };
    onLoadout(slot === 'primary' ? { primary: next, secondary: loadout.secondary } : { primary: loadout.primary, secondary: next });
    if (owned) {
      const res = equipAttachment(profile, build.weapon, null, menuSlot);
      if (res.ok) onProfile(res.value);
    }
  };

  const buy = (partId: string, partName: string) => {
    if (!owned) { say(`${entry.short} must be unlocked in the Armory first`, true); return; }
    const part = attachmentById(partId);
    if (!part) return;
    if (profile.cash < part.price) { say('Not enough cash for that part', true); return; }
    const res = buyAttachment(profile, build.weapon, partId);
    if (!res.ok) { say(res.error === 'INSUFFICIENT_FUNDS' ? 'Not enough cash' : 'Purchase rejected', true); return; }
    onProfile(res.value);
    equipPart(partId);
    say(`${partName} purchased and fitted`);
  };

  const parts = menuSlot ? attachmentsFor(entry.id, menuSlot) : [];
  const ownedParts = profile.ownedAttachments[entry.id] ?? [];
  const equippedInSlot = menuSlot ? build.attachments[menuSlot] : undefined;

  const grid = (which: SlotId) => WEAPON_CATALOG.filter(w => w.slot === which);

  return (
    <main className="tdm-root" aria-label="Warehouse TDM setup">
      <div className="menu-bg" aria-hidden="true" />
      <div className="paper-grain" aria-hidden="true" />

      {/* ============ TOP BAR ============ */}
      <header className="tdm-top">
        <button className="cmd-back" onClick={onBack}><span aria-hidden="true">‹</span> Back</button>
        <div className="tdm-top-title">
          <span className="menu-eyebrow">Warehouse · 5v5 Team Deathmatch</span>
          <b>{TDM_TEAM_SIZE}v{TDM_TEAM_SIZE} ALPHA vs BRAVO</b>
        </div>
        <div className="tdm-top-rules mono">
          <span>{TDM_FRAGS} FRAG + {TDM_FLASHES} FLASH</span>
          <i />
          <span>{fmtTime(TDM_MATCH_SECONDS)} MATCH</span>
          <i />
          <span>{TDM_RESPAWN_SECONDS}s RESPAWN</span>
        </div>
      </header>

      <div className="tdm-main">
        {/* ============ LEFT: ARMOR ============ */}
        <aside className="tdm-left" aria-label="Armor selection">
          <div className="sec-label"><span>01</span><span>ARMOR</span></div>
          <div className="tdm-armor-list">
            {ARMOR_TABLE.map(spec => {
              const on = spec.level === armor;
              return (
                <button key={spec.level} className={`tdm-armor-card ${on ? 'on' : ''}`} onClick={() => onArmor(spec.level)} aria-pressed={on}>
                  <span className="tdm-armor-icon" data-armor={spec.level}>{spec.icon}</span>
                  <span className="tdm-armor-body">
                    <b>{spec.name}</b>
                    <em className="mono">{spec.hp} HP · speed ×{spec.moveMul.toFixed(2)}</em>
                    <span className="tdm-armor-mods mono">
                      HEAD ×{spec.headMul.toFixed(2)} · BODY ×{spec.bodyMul.toFixed(2)}
                    </span>
                    <i>{spec.blurb}</i>
                  </span>
                  <span className="tdm-armor-hs mono" title="Rifle headshots / body shots to kill this tier">HS {headshotsToKillRifle(spec.level)} · BOD {bodyShotsToKillRifle(spec.level)}</span>
                </button>
              );
            })}
          </div>

          <p className="tdm-armor-pitch">
            Equip armor at the start to last longer. A rifle needs{' '}
            <b>{headshotsToKillRifle(0)}</b> head / <b>{bodyShotsToKillRifle(0)}</b> body hits to drop a bare target, but{' '}
            <b>{headshotsToKillRifle(2)}</b> head / <b>{bodyShotsToKillRifle(2)}</b> body hits against heavy plating — armor is
            free here, the only cost is speed.
          </p>

          <div className="sec-label" style={{ marginTop: 14 }}><span>02</span><span>ENEMY ARMOR</span></div>
          <ul className="tdm-enemy-list" aria-label="Bravo armor preview">
            {BRAVO_ROSTER.map(op => {
              const spec = armorOf(op.armor);
              return (
                <li key={op.name} data-armor={op.armor}>
                  <span className="tdm-armor-icon" data-armor={op.armor}>{spec.icon}</span>
                  <b>{op.name}</b>
                  <em>{spec.name}<i> · {op.role}</i></em>
                  <span className="tdm-enemy-hp mono">{spec.hp}</span>
                </li>
              );
            })}
          </ul>

          <div className="sec-label" style={{ marginTop: 14 }}><span>03</span><span>ALPHA SQUAD</span></div>
          <ul className="tdm-enemy-list alpha" aria-label="Alpha squad">
            <li data-armor={armor}>
              <span className="tdm-armor-icon" data-armor={armor}>{armorOf(armor).icon}</span>
              <b>YOU</b><em>Operator<i> · your plate</i></em>
              <span className="tdm-enemy-hp mono">{armorOf(armor).hp}</span>
            </li>
            {ALPHA_ROSTER.map(op => {
              const spec = armorOf(op.armor);
              return (
                <li key={op.name} data-armor={op.armor}>
                  <span className="tdm-armor-icon" data-armor={op.armor}>{spec.icon}</span>
                  <b>{op.name}</b><em>{spec.name}<i> · {op.role}</i></em>
                  <span className="tdm-enemy-hp mono">{spec.hp}</span>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ============ CENTER: GUN + GRIDS ============ */}
        <section className="tdm-center" aria-label="Weapon selection">
          <div className="tdm-stage">
            <div className="tdm-stage-head">
              <div>
                <h2>{entry.name}</h2>
                <p>{entry.cls} · {owned ? 'Unlocked in your armory' : 'Range issue for this match'} · <span className="mono">{SLOT_LABELS[menuSlot ?? 'optic']} pins live</span></p>
              </div>
              <div className="tdm-slot-tabs" role="tablist">
                {(['primary', 'secondary'] as SlotId[]).map(s => (
                  <button key={s} role="tab" aria-selected={slot === s} className={`armory-tab ${slot === s ? 'on' : ''}`} onClick={() => { setSlot(s); setMenuSlot(null); }}>
                    {s} · {loadout[s].weapon === 'm4a1' ? 'M416' : weaponById(loadout[s].weapon)?.short}
                  </button>
                ))}
              </div>
            </div>
            <div className="tdm-viewport">
              <GunViewer weapon={entry.id} skin={skin} build={build} activeSlot={menuSlot} flashSlot={flash} onHotspot={s => setMenuSlot(cur => (cur === s ? null : s))} />
              <span className="tdm-viewport-hint mono" aria-hidden="true">Click a brass pin to open that hardpoint · drag to orbit</span>
            </div>
            <div className="stage-ribbon mono" aria-label="Selected weapon figures">
              <div><span>DMG</span><b>{stats.damage.toFixed(0)}</b></div>
              <div><span>RPM</span><b>{stats.rpm}</b></div>
              <div><span>MAG</span><b>{stats.magSize}</b></div>
              <div><span>ADS</span><b>{(stats.adsTime * 1000).toFixed(0)}ms</b></div>
              <div className="tdm-head-ttk"><span>HS · BARE</span><b>{Math.max(2, Math.ceil(150 / (stats.damage * stats.headMul * 0.55 * 1.21)))}</b></div>
            </div>
          </div>

          <div className="tdm-grids">
            <div className="tdm-grid-block">
              <div className="sec-label"><span>PRIMARY</span><span>{grid('primary').length} weapons</span></div>
              <div className="tdm-grid">
                {grid('primary').map(w => (
                  <button key={w.id} className={`tdm-wcard ${loadout.primary.weapon === w.id ? 'sel' : ''}`} onClick={() => { setSlot('primary'); setSlotWeapon(w.id); }} aria-pressed={loadout.primary.weapon === w.id}>
                    {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} className="wcard-thumb" /> : <span className="wcard-thumb" />}
                    <span className="wcard-body">
                      <span className="wcard-name">{w.name}</span>
                      <span className="wcard-sub">
                        <i className="wcard-cls">{w.cls}</i>
                        {profile.ownedWeapons.includes(w.id) ? <b className="wcard-owned">Owned</b> : <b className="wcard-issue">Issue</b>}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="tdm-grid-block">
              <div className="sec-label"><span>SECONDARY</span><span>{grid('secondary').length} weapons</span></div>
              <div className="tdm-grid compact">
                {grid('secondary').map(w => (
                  <button key={w.id} className={`tdm-wcard ${loadout.secondary.weapon === w.id ? 'sel' : ''}`} onClick={() => { setSlot('secondary'); setSlotWeapon(w.id); }} aria-pressed={loadout.secondary.weapon === w.id}>
                    {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} className="wcard-thumb" /> : <span className="wcard-thumb" />}
                    <span className="wcard-body">
                      <span className="wcard-name">{w.name}</span>
                      <span className="wcard-sub">
                        <i className="wcard-cls">{w.cls}</i>
                        {profile.ownedWeapons.includes(w.id) ? <b className="wcard-owned">Owned</b> : <b className="wcard-issue">Issue</b>}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ RIGHT: ATTACHMENTS ============ */}
        <aside className="tdm-right" aria-label="Attachment panel">
          <div className="sec-label"><span>04</span><span>HARDPOINTS · {entry.short}</span></div>
          <div className="tdm-slots">
            {entry.slots.map(s => {
              const part = build.attachments[s];
              return (
                <button key={s} className={`tdm-slot ${menuSlot === s ? 'open' : ''} ${part ? 'filled' : ''}`} onClick={() => setMenuSlot(cur => (cur === s ? null : s))}>
                  <span className="tdm-slot-name mono">{SLOT_LABELS[s]}</span>
                  <span className="tdm-slot-value">{part ? attachmentById(part)?.name ?? part : '— empty —'}</span>
                </button>
              );
            })}
          </div>

          {menuSlot ? (
            <div className="partmenu tdm-partmenu" key={menuSlot}>
              <div className="partmenu-head">
                <span>{SLOT_LABELS[menuSlot]} — {entry.short}</span>
                <button className="util-btn" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => setMenuSlot(null)}>Close</button>
              </div>
              {equippedInSlot && (
                <button className="part-strip" onClick={stripPart}>
                  <span>Strip {attachmentById(equippedInSlot)?.name ?? equippedInSlot}</span>
                  <span className="mono">Back to stock</span>
                </button>
              )}
              <div className="partmenu-list">
                {parts.map(part => {
                  const isOwned = ownedParts.includes(part.id);
                  const isEquipped = equippedInSlot === part.id;
                  return (
                    <div key={part.id} className={`pcard ${isEquipped ? 'equipped' : ''}`}>
                      <div className="pcard-head">
                        <strong>{part.name}</strong>
                        <span className="pcard-tier" aria-label={`tier ${part.tier}`}>
                          {[1, 2, 3].map(i => <i key={i} className={i <= part.tier ? 'on' : ''} />)}
                        </span>
                      </div>
                      <p className="pcard-desc">{part.desc}</p>
                      <div className="pcard-mods mono">
                        {part.pros.map(p => <span key={p} className="pro">+ {p}</span>)}
                        {part.cons.map(c => <span key={c} className="con">− {c}</span>)}
                      </div>
                      <div className="pcard-foot">
                        <span className="pcard-price mono">{isOwned ? 'OWNED' : `$${part.price.toLocaleString('en-US')}`}</span>
                        {isEquipped ? (
                          <span className="pcard-equipped mono">EQUIPPED</span>
                        ) : isOwned ? (
                          <button className="pcard-btn" onClick={() => equipPart(part.id)}>Equip</button>
                        ) : (
                          <button className="pcard-btn buy" onClick={() => buy(part.id, part.name)}>Buy &amp; Equip</button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {parts.length === 0 && <p className="tdm-empty mono">No compatible parts for this weapon.</p>}
              </div>
            </div>
          ) : (
            <div className="tdm-rules">
              <h3>Loadout rules</h3>
              <ul>
                <li><b>Free issue.</b> Every weapon is available for this match — unlocked guns keep their saved build, the rest come off the rack bare.</li>
                <li><b>Utility.</b> {TDM_FRAGS}× frag + {TDM_FLASHES}× flashbang on spawn, every respawn.</li>
                <li><b>Armor decides TTK.</b> An enemy rifle needs {headshotsToKillRifle(0)} / {headshotsToKillRifle(1)} / {headshotsToKillRifle(2)} headshots or {bodyShotsToKillRifle(0)} / {bodyShotsToKillRifle(1)} / {bodyShotsToKillRifle(2)} body hits against bare / light / heavy plating. Heads never one-shot.</li>
                <li><b>No cash economy</b> in Warehouse TDM — kills score, they do not pay. Parts you buy here are permanent armory unlocks.</li>
                <li><b>Respawn</b> {TDM_RESPAWN_SECONDS}s at the south yard, covered by sandbags and U-barriers.</li>
                <li><b>Win condition</b> most team kills when the {fmtTime(TDM_MATCH_SECONDS)} clock expires.</li>
              </ul>
              <p className="tdm-rules-hint">Click a hardpoint pin on the gun to open a slot.</p>
            </div>
          )}
        </aside>
      </div>

      {/* ============ BOTTOM ============ */}
      <footer className="tdm-bottom">
        <div className="tdm-loadout-summary mono">
          <span>{TDM_FRAGS} FRAG</span><span>{TDM_FLASHES} FLASH</span>
          <span>{weaponById(loadout.primary.weapon)?.short}</span><span>{weaponById(loadout.secondary.weapon)?.short}</span>
          <span>{armorOf(armor).icon} {armorOf(armor).name}</span>
        </div>
        <button className="deploy-btn tdm-deploy" onClick={onDeploy}>
          <span>DEPLOY TO WAREHOUSE</span>
          <span className="hint">5v5 TDM · {fmtTime(TDM_MATCH_SECONDS)} · {armorOf(armor).hp} HP</span>
          <span aria-hidden="true">→</span>
        </button>
      </footer>

      {toast && <div className={`tdm-toast ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div>}
    </main>
  );
}
