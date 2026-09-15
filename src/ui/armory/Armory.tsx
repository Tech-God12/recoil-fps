// Recoil FPS — Armory loadout terminal: weapon rail, large 3D stage, stat lab + full customisation column.
import { useEffect, useMemo, useState } from 'react';
import {
  WEAPON_CATALOG, attachmentById, attachmentsFor, weaponById,
  type AttachSlot, type AttachmentId, type SlotId, type WeaponId,
} from '../../game/economy/catalog';
import { resolveWeaponStats, statBarFrac, type StatBarKey } from '../../game/economy/stats';
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

const BARS: { key: StatBarKey; label: string }[] = [
  { key: 'damage', label: 'DAMAGE' },
  { key: 'rpm', label: 'FIRE RATE' },
  { key: 'range', label: 'RANGE' },
  { key: 'control', label: 'CONTROL' },
  { key: 'handling', label: 'HANDLING' },
  { key: 'noise', label: 'NOISE' },
  { key: 'mobility', label: 'MOBILITY' },
];

const TUTORIAL = [
  { title: 'PICK A WEAPON', body: 'Click any gun to preview it in full color. Buy from the stage to customize.', anchor: 'rail' },
  { title: 'INSPECT THE GUN', body: 'Drag to orbit, scroll to zoom. Everything on the right bolts straight onto this preview.', anchor: 'stage' },
  { title: 'BUY & BOLT ON', body: 'Every socket is listed on the right — buying auto-equips. Hover any part to ghost-preview its stat deltas.', anchor: 'panel' },
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
  const [hoverPart, setHoverPart] = useState<AttachmentId | null>(null);
  const [flash, setFlash] = useState<{ slot: AttachSlot; key: number } | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [toast, setToast] = useState<{ text: string; key: number; bad?: boolean } | null>(null);
  const [tutStep, setTutStep] = useState(profile.seenArmoryTutorial ? -1 : 0);
  const [thumbs, setThumbs] = useState<Partial<Record<WeaponId, string>>>({});

  useEffect(() => {
    // Thumbnail cache: one 256×128 render per catalog gun, then pure <img>.
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
  const skinName = skinById(skin).name.toUpperCase();
  const equipped = profile.loadout[entry.slot].weapon === selected;
  const build = useMemo(() => buildForWeapon(profile, selected), [profile, selected]);
  const stats = useMemo(() => {
    const mods = Object.values(build.attachments).map(id => attachmentById(id)?.mods).filter(m => !!m);
    return resolveWeaponStats(entry.base, mods);
  }, [build, entry]);
  const previewStats = useMemo(() => {
    if (!hoverPart) return null;
    const part = attachmentById(hoverPart);
    if (!part) return null;
    const mods = Object.entries(build.attachments)
      .filter(([slot]) => slot !== part.slot)
      .map(([, id]) => attachmentById(id)?.mods)
      .filter(m => !!m);
    mods.push(part.mods);
    return resolveWeaponStats(entry.base, mods);
  }, [hoverPart, build, entry]);

  const rail = WEAPON_CATALOG.filter(w => w.slot === tab);

  const pulse = (slot: AttachSlot) => {
    const key = flashKey + 1;
    setFlashKey(key);
    setFlash({ slot, key });
  };

  const pickTab = (t: SlotId) => {
    setTab(t);
    setSelected(profile.loadout[t].weapon);
    setHoverPart(null);
  };

  // Selecting only previews — locked guns render as holograms; buying is explicit.
  const selectWeapon = (id: WeaponId) => {
    const w = weaponById(id)!;
    setTab(w.slot);
    setSelected(id);
    setHoverPart(null);
    if (profile.ownedWeapons.includes(id) && profile.loadout[w.slot].weapon !== id) {
      const res = setLoadoutWeapon(profile, w.slot, id);
      if (res.ok) {
        onProfile(res.value);
        say(`${w.name} EQUIPPED`);
      }
    }
  };

  const buyGun = () => {
    if (owned) return;
    const bought = buyWeapon(profile, selected);
    if (!bought.ok) {
      say(bought.error === 'INSUFFICIENT_FUNDS' ? `NEED ${fmt(entry.price)} — ${fmt(profile.cash)} AVAILABLE` : 'PURCHASE FAILED', true);
      return;
    }
    // Buying equips the gun straight into its slot.
    const equippedRes = setLoadoutWeapon(bought.value, entry.slot, selected);
    onProfile(equippedRes.ok ? equippedRes.value : bought.value);
    say(`${entry.name} EQUIPPED TO ${entry.slot.toUpperCase()} SLOT`);
  };

  const buyPart = (id: AttachmentId) => {
    const res = buyAttachment(profile, selected, id);
    if (!res.ok) {
      say(res.error === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT FUNDS' : 'CANNOT FIT — CHECK COMPATIBILITY', true);
      return;
    }
    onProfile(res.value);
    pulse(attachmentById(id)!.slot);
    say(`${attachmentById(id)!.name.toUpperCase()} FITTED`);
  };

  const equipPart = (id: AttachmentId) => {
    const part = attachmentById(id)!;
    const res = equipAttachment(profile, selected, id, part.slot);
    if (!res.ok) {
      say('CANNOT EQUIP', true);
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
      say(`${skinById(id).name.toUpperCase()} FINISH`);
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

  const ownedParts = profile.ownedAttachments[selected] ?? [];

  return (
    <div className="armory-root" onClick={tutStep >= 0 ? advanceTutorial : undefined}>
      <div className="hex-grid" aria-hidden="true" />
      <div className="armory-glow" aria-hidden="true" />
      <div className="armory-vignette" aria-hidden="true" />

      <header className="cmdbar">
        <button className="cmd-back" onClick={onBack}><span aria-hidden="true">‹</span> BACK</button>
        <div className="cmd-cash"><span className="cmd-coin" aria-hidden="true" /><CashCounter value={profile.cash} /></div>
        <button className="cmd-deploy" onClick={onDeploy}>DEPLOY <span aria-hidden="true">→</span></button>
      </header>

      <div className="armory-main">
        {/* ================= WEAPON RAIL ================= */}
        <aside className={`armory-rail ${tutStep === 0 ? 'tut-ring' : ''}`} aria-label="Weapon rack">
          <div className="armory-tabs" role="tablist">
            {(['primary', 'secondary'] as SlotId[]).map(t => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`armory-tab ${tab === t ? 'on' : ''}`}
                onClick={() => pickTab(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="armory-cards" tabIndex={0} onKeyDown={railKey} aria-label={`${tab} weapons`}>
            {rail.map(w => {
              const isOwned = profile.ownedWeapons.includes(w.id);
              const isEquipped = profile.loadout[w.slot].weapon === w.id;
              const isSel = w.id === selected;
              return (
                <button
                  key={w.id}
                  className={`wcard ${isSel ? 'sel' : ''} ${isOwned ? '' : 'locked'}`}
                  onClick={() => selectWeapon(w.id)}
                  aria-pressed={isSel}
                >
                  <span className="wcard-sel" aria-hidden="true" />
                  {!isOwned && <span className="wcard-hazard" aria-hidden="true" />}
                  {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" draggable={false} className="wcard-thumb" /> : <span className="wcard-thumb" />}
                  <span className="wcard-body">
                    <span className="wcard-name">{w.name}</span>
                    <span className="wcard-sub">
                      <i className="wcard-cls">{w.cls}</i>
                      {isEquipped ? <b className="wcard-equipped">EQUIPPED</b> : isOwned ? <b className="wcard-owned">OWNED</b> : <b className="wcard-price">{fmt(w.price)}</b>}
                    </span>
                  </span>
                  {!isOwned && <LockIcon />}
                </button>
              );
            })}
          </div>
          <p className="armory-rail-hint mono">↑↓ NAVIGATE · ENTER PREVIEW</p>
        </aside>

        {/* ================= 3D STAGE ================= */}
        <section className={`armory-stage ${tutStep === 1 ? 'tut-ring' : ''}`} aria-label="Weapon preview">
          <div className="armory-stage-head">
            <div>
              <h2>{entry.name}</h2>
              <p className="mono">{entry.cls} · {skinName} FINISH{!owned && <span className="locknote">LOCKED PREVIEW</span>}</p>
            </div>
            <div className="armory-stage-tags mono">
              {equipped ? <span className="tag-equipped">EQUIPPED {entry.slot.toUpperCase()}</span> : owned ? <span className="tag-owned">IN RACK</span> : (
                <span className="tag-stack">
                  <span className="tag-price">{fmt(entry.price)}</span>
                  <button className="stage-buy" onClick={buyGun}>BUY {entry.short}</button>
                </span>
              )}
            </div>
          </div>
          <GunViewer weapon={selected} skin={skin} build={build} flashSlot={flash} />
        </section>

        {/* ================= STAT LAB + FULL CUSTOMISATION ================= */}
        <aside className={`armory-panel ${tutStep === 2 ? 'tut-ring' : ''}`} aria-label="Statistics and customisation">
          <div className="statpanel">
            <div className="sec-label"><span>FINISH</span><span className="mono">{skinName}</span></div>
            <div className="skin-row">
              {SKIN_CATALOG.map(s => (
                <button
                  key={s.id}
                  className={`skin-swatch ${s.id === skin ? 'on' : ''}`}
                  onClick={() => pickSkin(s.id)}
                  title={s.desc}
                  aria-pressed={s.id === skin}
                >
                  <i style={{ background: s.swatch }} />
                  <b>{s.name.toUpperCase()}</b>
                </button>
              ))}
            </div>
            <div className="sec-label"><span>STAT LAB</span><span className="mono">{entry.short}</span></div>
            {BARS.map(b => {
              const frac = statBarFrac(b.key, stats);
              const pfrac = previewStats ? statBarFrac(b.key, previewStats) : frac;
              const delta = pfrac - frac;
              return (
                <div className="sbar" key={b.key}>
                  <div className="sbar-head">
                    <span>{b.label}</span>
                    {previewStats && Math.abs(delta) > 0.001 && (
                      <span className={`sbar-delta mono ${delta > 0 ? 'up' : 'down'}`}>
                        {delta > 0 ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                  <div className="sbar-track">
                    <span className="sbar-fill" style={{ transform: `scaleX(${frac.toFixed(3)})` }} />
                    {previewStats && Math.abs(delta) > 0.001 && (
                      <span
                        className={`sbar-ghost ${delta > 0 ? 'up' : 'down'}`}
                        style={{
                          left: `${(Math.min(frac, pfrac) * 100).toFixed(1)}%`,
                          width: `${(Math.abs(delta) * 100).toFixed(1)}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <div className="snum-grid mono">
              <div><span>MAG</span><b>{stats.magSize}{previewStats && previewStats.magSize !== stats.magSize ? ` → ${previewStats.magSize}` : ''}</b></div>
              <div><span>RESERVE</span><b>{stats.reserve}{previewStats && previewStats.reserve !== stats.reserve ? ` → ${previewStats.reserve}` : ''}</b></div>
              <div><span>RELOAD</span><b>{stats.tacReload.toFixed(2)}s{previewStats && Math.abs(previewStats.tacReload - stats.tacReload) > 0.001 ? ` → ${previewStats.tacReload.toFixed(2)}` : ''}</b></div>
              <div><span>ZOOM</span><b>{stats.scopeMag ?? '1×'} · {stats.adsFov.toFixed(0)}°{previewStats && Math.abs(previewStats.adsFov - stats.adsFov) > 0.01 ? ` → ${previewStats.adsFov.toFixed(0)}` : ''}</b></div>
            </div>
          </div>

          <div className="customize">
            <div className="sec-label"><span>CUSTOMIZE</span><span className="mono">{entry.short}</span></div>
            {!owned && (
              <p className="partmenu-empty mono">BUY {entry.name.toUpperCase()} TO CUSTOMISE IT.</p>
            )}
            {owned && entry.slots.map(slot => {
              const fittedId = build.attachments[slot];
              const fitted = fittedId ? attachmentById(fittedId) : undefined;
              const parts = attachmentsFor(selected, slot);
              return (
                <section key={slot} className="slotblock" aria-label={SLOT_LABELS[slot]}>
                  <div className="slotblock-head">
                    <span className="mono">{SLOT_LABELS[slot]}</span>
                    {fitted ? (
                      <button className="slotblock-strip" onClick={() => unequipSlot(slot)}>
                        STRIP {fitted.name.toUpperCase()}
                      </button>
                    ) : (
                      <span className="slotblock-stock mono">STOCK</span>
                    )}
                  </div>
                  <div className="slotblock-list">
                    {parts.map(part => {
                      const isOwned = ownedParts.includes(part.id);
                      const isEquipped = fittedId === part.id;
                      return (
                        <div
                          key={part.id}
                          className={`pcard ${isEquipped ? 'equipped' : ''}`}
                          onMouseEnter={() => !isEquipped && setHoverPart(part.id)}
                          onMouseLeave={() => setHoverPart(cur => (cur === part.id ? null : cur))}
                        >
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
                            <button className="pcard-btn equipped" onClick={() => unequipSlot(slot)}>EQUIPPED — CLICK TO STRIP</button>
                          ) : isOwned ? (
                            <button className="pcard-btn" onClick={() => equipPart(part.id)}>EQUIP</button>
                          ) : (
                            <button
                              className={`pcard-btn buy ${profile.cash < part.price ? 'cant' : ''}`}
                              onClick={() => buyPart(part.id)}
                            >
                              BUY — {fmt(part.price)}
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {parts.length === 0 && (
                      <p className="partmenu-empty mono">STOCK ISSUE ONLY.</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </aside>
      </div>

      {/* tutorial coach marks */}
      {tutStep >= 0 && (
        <div className="tut-card" data-anchor={TUTORIAL[tutStep].anchor}>
          <span className="mono">FIELD MANUAL {tutStep + 1}/3</span>
          <strong>{TUTORIAL[tutStep].title}</strong>
          <p>{TUTORIAL[tutStep].body}</p>
          <em className="mono">CLICK ANYWHERE TO CONTINUE</em>
        </div>
      )}
      {toast && (
        <div key={toast.key} className={`armory-toast mono ${toast.bad ? 'bad' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
