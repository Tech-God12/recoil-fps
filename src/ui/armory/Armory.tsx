// Recoil FPS — Armory: hero workbench with tactile rack and spec sheet
import { useEffect, useMemo, useState } from 'react';
import {
  WEAPON_CATALOG, attachmentById, attachmentsFor, weaponById,
  type AttachSlot, type AttachmentId, type SlotId, type WeaponId,
} from '../../game/economy/catalog';
import { resolveWeaponStats } from '../../game/economy/stats';
import {
  buildForWeapon, buyAttachment, buyWeapon, equipAttachment, setLoadoutWeapon, setWeaponSkin, skinFor,
  type PlayerProfile,
} from '../../game/economy/profile';
import { SKIN_CATALOG, skinById, type SkinId } from '../../game/economy/skins';
import CashCounter from './CashCounter';
import GunViewer, { SLOT_LABELS, gunThumbnail } from './GunViewer';

interface ArmoryProps {
  profile: PlayerProfile;
  onProfile: (next: PlayerProfile) => void;
  onDeploy: () => void;
  onBack: () => void;
}

const TUTORIAL = [
  { title: 'Pick a weapon', body: 'Select any gun to preview. Buying equips it instantly.', anchor: 'rail' },
  { title: 'Hardpoints', body: 'Click a brass pin on the gun or a slot in the panel to open parts.', anchor: 'stage' },
  { title: 'Build it', body: 'Buy to auto-equip. Hover to preview stat changes.', anchor: 'panel' },
] as const;

const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;

const LockIcon = () => (
  <svg className="wcard-lock" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export default function Armory({ profile, onProfile, onDeploy, onBack }: ArmoryProps) {
  const [tab, setTab] = useState<SlotId>('primary');
  const [selected, setSelected] = useState<WeaponId>(profile.loadout.primary.weapon);
  const [menuSlot, setMenuSlot] = useState<AttachSlot | null>(null);
  const [flash, setFlash] = useState<{ slot: AttachSlot; key: number } | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [toast, setToast] = useState<{ text: string; key: number; bad?: boolean } | null>(null);
  const [tutStep, setTutStep] = useState(profile.seenArmoryTutorial ? -1 : 0);
  const [thumbs, setThumbs] = useState<Partial<Record<WeaponId, string>>>({});

  useEffect(() => {
    const next: Partial<Record<WeaponId, string>> = {};
    for (const w of WEAPON_CATALOG) next[w.id] = gunThumbnail(w.id);
    setThumbs(next);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.key === toast.key ? null : cur)), 1700);
    return () => window.clearTimeout(t);
  }, [toast]);

  const say = (text: string, bad = false) => setToast({ text, key: Date.now() + Math.random(), bad });

  const entry = weaponById(selected)!;
  const owned = profile.ownedWeapons.includes(selected);
  const skin = skinFor(profile, selected);
  const skinName = skinById(skin).name;
  const fielded = profile.loadout[entry.slot].weapon === selected;
  const build = useMemo(() => buildForWeapon(profile, selected), [profile, selected]);
  const stats = useMemo(() => {
    const mods = Object.values(build.attachments).map(id => attachmentById(id)?.mods).filter(m => !!m);
    return resolveWeaponStats(entry.base, mods);
  }, [build, entry]);
  const rail = WEAPON_CATALOG.filter(w => w.slot === tab);

  const pulse = (slot: AttachSlot) => {
    const key = flashKey + 1;
    setFlashKey(key);
    setFlash({ slot, key });
  };

  const pickTab = (t: SlotId) => {
    setTab(t);
    setSelected(profile.loadout[t].weapon);
    setMenuSlot(null);
  };

  const selectWeapon = (id: WeaponId) => {
    const w = weaponById(id)!;
    setTab(w.slot);
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
      say(bought.error === 'INSUFFICIENT_FUNDS' ? `Need ${fmt(entry.price)} — ${fmt(profile.cash)} available` : 'Purchase failed', true);
      return;
    }
    const fieldedRes = setLoadoutWeapon(bought.value, entry.slot, selected);
    onProfile(fieldedRes.ok ? fieldedRes.value : bought.value);
    say(`${entry.name} added to ${entry.slot} slot`);
  };

  const openSlot = (slot: AttachSlot) => {
    // Browsing parts is always allowed, even on unowned guns — window shopping
    // shows exactly what a locked weapon can become before you commit.
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

  const pickSkin = (id: SkinId) => {
    const res = setWeaponSkin(profile, selected, id);
    if (res.ok) {
      onProfile(res.value);
      say(`${skinById(id).name} finish`);
    }
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
    <div className="armory-root" onClick={tutStep >= 0 ? advanceTutorial : undefined}
      onKeyDown={e => { if (e.key === 'Escape' && menuSlot) setMenuSlot(null); }}>

      <div className="armory-glow" aria-hidden="true" />
      <div className="armory-vignette" aria-hidden="true" />

      <header className="cmdbar">
        <button className="cmd-back" onClick={onBack}><span aria-hidden="true">‹</span> Back</button>
        <div className="cmd-cash"><span className="cmd-coin" aria-hidden="true" /><CashCounter value={profile.cash} /></div>
        <button className="cmd-deploy" onClick={onDeploy}>Deploy <span aria-hidden="true">→</span></button>
      </header>

      <div className="armory-main">
        {/* ============ RACK ============ */}
        <aside className={`armory-rail ${tutStep === 0 ? 'tut-ring' : ''}`} aria-label="Weapon rack">
          <div className="rail-head">
            <span className="stencil">Rack</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--bone-mute)' }}>{rail.length} items</span>
          </div>
          <div className="armory-tabs" role="tablist">
            {(['primary', 'secondary'] as SlotId[]).map(t => (
              <button key={t} role="tab" aria-selected={tab === t} className={`armory-tab ${tab === t ? 'on' : ''}`} onClick={() => pickTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="armory-cards" tabIndex={0} onKeyDown={railKey} aria-label={`${tab} weapons`}>
            {rail.map(w => {
              const isOwned = profile.ownedWeapons.includes(w.id);
              const isFielded = profile.loadout[w.slot].weapon === w.id;
              const isSel = w.id === selected;
              return (
                <button key={w.id} className={`wcard ${isSel ? 'sel' : ''} ${isOwned ? '' : 'locked'}`} onClick={() => selectWeapon(w.id)} aria-pressed={isSel}>
                  <span className="wcard-sel" aria-hidden="true" />
                  {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} className="wcard-thumb" /> : <span className="wcard-thumb" />}
                  <span className="wcard-body">
                    <span className="wcard-name">{w.name}</span>
                    <span className="wcard-sub">
                      <i className="wcard-cls">{w.cls}</i>
                      {isFielded ? <b className="wcard-fielded">Equipped</b> : isOwned ? <b className="wcard-owned">Owned</b> : <b className="wcard-price">{fmt(w.price)}</b>}
                    </span>
                  </span>
                  {!isOwned && <LockIcon />}
                </button>
              );
            })}
          </div>
          <p className="armory-rail-hint mono">↑↓ navigate · Enter preview</p>
        </aside>

        {/* ============ STAGE — HERO WORKBENCH ============ */}
        <section className={`armory-stage ${tutStep === 1 ? 'tut-ring' : ''}`} aria-label="Weapon preview">
          <div className="armory-stage-head">
            <div>
              <h2>{entry.name}</h2>
              <p>{entry.cls} · {skinName} finish {!owned && <span className="locknote">Locked preview</span>}</p>
            </div>
            <div className="armory-stage-tags">
              {fielded ? <span className="tag-fielded">Equipped</span> : owned ? <span className="tag-owned">In rack</span> : (
                <span className="tag-stack">
                  <span className="tag-price">{fmt(entry.price)}</span>
                  <button className="stage-buy" onClick={buyGun}>Buy {entry.short}</button>
                </span>
              )}
            </div>
          </div>

          <div className="stage-viewport">
            <GunViewer weapon={selected} skin={skin} build={build} activeSlot={menuSlot} flashSlot={flash} onHotspot={openSlot} />
            <div className="stage-fallback mono" aria-hidden="true">Drag to orbit · Scroll to zoom · Click pins to fit parts</div>
          </div>

          {/* Key figures ribbon under the gun — the numbers that matter at a glance */}
          <div className="stage-ribbon mono" aria-label="Key weapon figures">
            <div><span>DMG</span><b>{stats.damage.toFixed(0)}</b></div>
            <div><span>RPM</span><b>{stats.rpm}</b></div>
            <div><span>MAG</span><b>{stats.magSize}</b></div>
            <div><span>ADS</span><b>{(stats.adsTime * 1000).toFixed(0)}ms</b></div>
            <div><span>RELOAD</span><b>{stats.tacReload.toFixed(1)}s</b></div>
            <div className={stats.suppressed ? 'on' : ''}><span>SUPPR</span><b>{stats.suppressed ? 'YES' : '—'}</b></div>
          </div>

        </section>

        {/* ============ SPEC SHEET ============ */}
        <aside className={`armory-panel ${tutStep === 2 ? 'tut-ring' : ''}`} aria-label="Spec sheet">
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
                        <button className={`pcard-btn buy ${profile.cash < part.price ? 'cant' : ''}`} onClick={() => buyPart(part.id)}>
                          Buy — {fmt(part.price)}
                        </button>
                      )}
                    </div>
                  );
                })}
                {menuParts.length === 0 && <p className="partmenu-empty mono">No compatible parts for this socket.</p>}
              </div>
            </div>
          ) : (
            <div className="statpanel">
              <div className="sec-label"><span>Equipped</span><span className="mono">{entry.short}</span></div>
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

              <div className="sec-label"><span>Finish</span><span className="mono">{skinName}</span></div>
              <div className="skin-row">
                {SKIN_CATALOG.map(s => (
                  <button key={s.id} className={`skin-swatch ${s.id === skin ? 'on' : ''}`} onClick={() => pickSkin(s.id)} title={s.desc} aria-pressed={s.id === skin}>
                    <i style={{ background: s.swatch }} />
                    <b>{s.name}</b>
                  </button>
                ))}
              </div>

              <p className="statpanel-hint mono">Click a hardpoint to fit parts</p>
            </div>
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
