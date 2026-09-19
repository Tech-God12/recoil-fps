// Recoil FPS — Armory: hero workbench with tactile rack and spec sheet
import { useEffect, useMemo, useState } from 'react';
import {
  WEAPON_CATALOG, attachmentById, attachmentsFor, weaponById,
  type AttachSlot, type AttachmentId, type SlotId, type WeaponId,
} from '../../game/economy/catalog';
import { resolveWeaponStats, statBarFrac } from '../../game/economy/stats';
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
  const [filter, setFilter] = useState<'ALL' | 'AR' | 'SMG' | 'SR' | 'SG'>('ALL');
  const [infoTab, setInfoTab] = useState<'stats' | 'details'>('stats');
  const [menuSlot, setMenuSlot] = useState<AttachSlot | null>(null);
  const [flash, setFlash] = useState<{ slot: AttachSlot; key: number } | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [toast, setToast] = useState<{ text: string; key: number; bad?: boolean } | null>(null);
  // The loadout screen is dense enough to be its own tutorial. Keep the first
  // frame clean; the interaction hints live beside the controls instead of
  // covering the weapon preview with a modal card.
  const [tutStep, setTutStep] = useState(-1);
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
  const rail = WEAPON_CATALOG.filter(w => w.slot === tab && (filter === 'ALL' || w.cls === filter));

  const pulse = (slot: AttachSlot) => {
    const key = flashKey + 1;
    setFlashKey(key);
    setFlash({ slot, key });
  };

  const pickTab = (t: SlotId) => {
    setTab(t);
    setFilter('ALL');
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
  const infoRows = [
    { label: 'DAMAGE', value: `${Math.round(stats.damage)}`, fill: statBarFrac('damage', stats) },
    { label: 'RPM', value: `${stats.rpm}`, fill: statBarFrac('rpm', stats) },
    { label: 'MAGAZINE', value: `${stats.magSize}`, fill: Math.min(1, stats.magSize / 100) },
    { label: 'ACCURACY', value: `${Math.round(Math.max(0, 1 - stats.hipSpread * 20) * 100)}`, fill: Math.max(0, Math.min(1, 1 - stats.hipSpread * 20)) },
    { label: 'RECOIL CONTROL', value: `${Math.round(statBarFrac('control', stats) * 100)}`, fill: statBarFrac('control', stats) },
    { label: 'MOBILITY', value: `${Math.round(statBarFrac('mobility', stats) * 100)}`, fill: statBarFrac('mobility', stats) },
    { label: 'HANDLING', value: `${Math.round(statBarFrac('handling', stats) * 100)}`, fill: statBarFrac('handling', stats) },
  ];

  return (
    <div className="armory-root" onClick={tutStep >= 0 ? advanceTutorial : undefined}
      onKeyDown={e => { if (e.key === 'Escape' && menuSlot) setMenuSlot(null); }}>

      <div className="armory-glow" aria-hidden="true" />
      <div className="armory-vignette" aria-hidden="true" />

      <header className="cmdbar">
        <button className="armory-brand" onClick={onBack} aria-label="Return to operations">
          <svg className="armory-brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="m3 5 13-2 13 2-13 24L3 5Z" /><path d="m10 9 6-1 6 1-6 11-6-11Z" /></svg>
          <span><b>OPERATOR</b><em>LOADOUT SYSTEM</em></span>
        </button>
        <nav className="armory-global-nav" aria-label="Operator system">
          <button className="armory-global-link is-active" type="button">LOADOUT</button>
          <button className="armory-global-link" type="button" disabled>OPERATORS</button>
          <button className="armory-global-link" type="button" disabled>BARRACKS</button>
          <button className="armory-global-link" type="button" disabled>STORE</button>
        </nav>
        <div className="armory-top-actions">
          <button className="armory-deploy-link" type="button" onClick={onDeploy}>DEPLOY <span aria-hidden="true">→</span></button>
          <div className="cmd-cash"><span className="cmd-coin" aria-hidden="true" /><CashCounter value={profile.cash} /></div>
          <button className="armory-top-icon" type="button" aria-label="System settings" title="System settings"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="m19.4 15 1.3 1.3-2.1 2.1-1.3-1.3a8 8 0 0 1-2.1.9v1.8h-3v-1.8a8 8 0 0 1-2.1-.9l-1.3 1.3-2.1-2.1L8 15a8 8 0 0 1-.9-2.1H5.3v-3h1.8A8 8 0 0 1 8 7.8L6.7 6.5l2.1-2.1 1.3 1.3a8 8 0 0 1 2.1-.9V3h3v1.8a8 8 0 0 1 2.1.9l1.3-1.3 2.1 2.1-1.3 1.3a8 8 0 0 1 .9 2.1h1.8v3h-1.8a8 8 0 0 1-.9 2.1Z" /></svg></button>
          <span className="armory-motto">PREPARE<br />ADAPT<br />REPEAT</span>
        </div>
      </header>

      <nav className="armory-subbar" aria-label="Loadout slots">
        <div className="armory-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'primary'} className={`armory-tab ${tab === 'primary' ? 'on' : ''}`} onClick={() => pickTab('primary')}>
            <span className="armory-tab-mark">▰</span> PRIMARY
          </button>
          <button role="tab" aria-selected={tab === 'secondary'} className={`armory-tab ${tab === 'secondary' ? 'on' : ''}`} onClick={() => pickTab('secondary')}>
            <span className="armory-tab-mark">▰</span> SECONDARY
          </button>
          <button className="armory-tab armory-tab-muted" type="button" disabled><span className="armory-tab-mark">◉</span> TACTICAL</button>
          <button className="armory-tab armory-tab-muted" type="button" disabled><span className="armory-tab-mark">◉</span> LETHAL</button>
          <button className="armory-tab armory-tab-muted" type="button" disabled><span className="armory-tab-mark">◇</span> PERKS</button>
        </div>
        <span className="armory-custom-loadout">CUSTOM LOADOUT 1 <b>⌄</b></span>
      </nav>

      <div className="armory-main">
        {/* ============ RACK ============ */}
        <aside className={`armory-rail ${tutStep === 0 ? 'tut-ring' : ''}`} aria-label="Weapon rack">
          <div className="rail-head">
            <span className="armory-rail-title">{tab === 'primary' ? 'PRIMARY WEAPONS' : 'SECONDARY WEAPONS'}</span>
            <span className="mono armory-item-count">{rail.length} ITEMS</span>
          </div>
          <div className="armory-filters" role="tablist" aria-label="Weapon filters">
            {(['ALL', 'AR', 'SMG', 'SR', 'SG'] as const).map(f => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>
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
            <div className="armory-stage-copy">
              <span className="armory-stage-kicker">{entry.cls === 'AR' ? 'ASSAULT RIFLE' : entry.cls === 'SMG' ? 'SUBMACHINE GUN' : entry.cls === 'SR' ? 'SNIPER RIFLE' : `${entry.cls} PLATFORM`}</span>
              <h2>{entry.name}</h2>
              <p>{entry.cls} <i>·</i> {skinName.toUpperCase()} FINISH {!owned && <span className="locknote">LOCKED PREVIEW</span>}</p>
              <p className="armory-stage-blurb">{entry.blurb}</p>
            </div>
            <div className="armory-stage-tags">
              {fielded ? <span className="tag-fielded">EQUIPPED</span> : owned ? <span className="tag-owned">IN RACK</span> : (
                <span className="tag-stack">
                  <span className="tag-price">{fmt(entry.price)}</span>
                  <button className="stage-buy" onClick={buyGun}>BUY {entry.short}</button>
                </span>
              )}
            </div>
          </div>

          <div className="stage-viewport">
            <GunViewer weapon={selected} skin={skin} build={build} activeSlot={menuSlot} flashSlot={flash} onHotspot={openSlot} />
            <div className="stage-fallback mono" aria-hidden="true">Drag to orbit · Scroll to zoom · Click pins to fit parts</div>
          </div>

          <div className="stage-attachments-head">
            <span>ATTACHMENTS</span>
            <span>{Object.keys(build.attachments).length}/{entry.slots.length} ATTACHMENTS EQUIPPED</span>
          </div>
          <div className="stage-attachments" aria-label="Weapon attachments">
            {entry.slots.map(slot => {
              const id = build.attachments[slot];
              const part = id ? attachmentById(id) : undefined;
              return (
                <button key={slot} type="button" className={`attachment-card ${part ? 'filled' : ''} ${menuSlot === slot ? 'active' : ''}`} onClick={() => openSlot(slot)}>
                  <span className="attachment-card-icon" aria-hidden="true">{part ? '◆' : '+'}</span>
                  <span className="attachment-card-slot">{SLOT_LABELS[slot]}</span>
                  <strong>{part ? part.name : 'Empty'}</strong>
                </button>
              );
            })}
          </div>

          {/* Kept in the DOM for the existing stat animation and narrow-screen fallback. */}
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
              <div className="armory-info-tabs" role="tablist" aria-label="Weapon information">
                <button type="button" role="tab" aria-selected={infoTab === 'stats'} className={infoTab === 'stats' ? 'on' : ''} onClick={() => setInfoTab('stats')}>STATS</button>
                <button type="button" role="tab" aria-selected={infoTab === 'details'} className={infoTab === 'details' ? 'on' : ''} onClick={() => setInfoTab('details')}>DETAILS</button>
              </div>

              {infoTab === 'stats' ? (
                <div className="armory-stat-sheet">
                  <div className="armory-stat-heading"><span>{entry.short} PERFORMANCE</span><b>LIVE BUILD</b></div>
                  <div className="armory-stat-list">
                    {infoRows.map(row => (
                      <div className="armory-stat-row" key={row.label}>
                        <div><span>{row.label}</span><b>{row.value}</b></div>
                        <div className="armory-stat-track"><span style={{ transform: `scaleX(${row.fill})` }} /></div>
                      </div>
                    ))}
                  </div>
                  <div className="armory-stat-summary">
                    <span><small>FIRE MODE</small><b>{stats.auto ? 'FULL AUTO' : 'SEMI AUTO'}</b></span>
                    <span><small>CALIBER</small><b>{entry.cls === 'BR' ? '7.62 NATO' : entry.cls === 'SR' ? '.338 LAPUA' : '5.56 NATO'}</b></span>
                  </div>
                </div>
              ) : (
                <div className="armory-details-sheet">
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
            </div>
          )}
        </aside>

      </div>

      <footer className="armory-footer">
        <span><kbd>ESC</kbd> BACK</span>
        <span className="armory-footer-center"><kbd>DRAG</kbd> ROTATE <kbd>SCROLL</kbd> ZOOM <kbd>H</kbd> HIDE UI</span>
        <span>VER. 1.0.0</span>
      </footer>

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
