import { useEffect, useMemo, useState } from 'react';
import {
  WEAPON_CATALOG, attachmentById, attachmentsFor, weaponById,
  type AttachSlot, type AttachmentId, type SlotId, type WeaponId,
} from '../game/economy/catalog';
import { resolveWeaponStats } from '../game/economy/stats';
import { buildForWeapon, equipAttachment, setLoadoutWeapon, type PlayerProfile } from '../game/economy/profile';
import type { Loadout } from '../game/economy/loadout';
import GunViewer, { SLOT_LABELS, gunThumbnail } from './armory/GunViewer';
import { BRAVO_ROSTER, type ArmorLevel } from '../game/tdm';
import { weaponTexturesReady } from '../game/weapons/finish';

const ARMOR: { level: ArmorLevel; name: string; icon: string; hp: number; note: string }[] = [
  { level: 0, name: 'No Armor', icon: '○', hp: 150, note: 'Fastest. 3 headshots.' },
  { level: 1, name: 'Light Vest', icon: '◍', hp: 180, note: 'Head −15% · Body −45%' },
  { level: 2, name: 'Heavy Vest', icon: '⬢', hp: 210, note: 'Head −25% · Body −55%' },
];

export default function TDMSetup({ profile, onProfile, onDeploy, onBack }: {
  profile: PlayerProfile;
  onProfile: (p: PlayerProfile) => void;
  onDeploy: (armor: ArmorLevel, loadout: Loadout) => void;
  onBack: () => void;
}) {
  const [armor, setArmor] = useState<ArmorLevel>(1);
  const [tab, setTab] = useState<SlotId>('primary');
  const [selected, setSelected] = useState<WeaponId>(profile.loadout.primary.weapon);
  const [menuSlot, setMenuSlot] = useState<AttachSlot | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<WeaponId, string>>>({});

  useEffect(() => {
    let active = true;
    void weaponTexturesReady.then(async () => {
      for (const w of WEAPON_CATALOG) {
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        if (!active) return;
        setThumbs(p => ({ ...p, [w.id]: gunThumbnail(w.id) }));
      }
    });
    return () => { active = false; };
  }, []);

  const entry = weaponById(selected)!;
  const build = useMemo(() => buildForWeapon(profile, selected), [profile, selected]);
  const stats = useMemo(() => {
    const mods = Object.values(build.attachments).map(id => attachmentById(id)?.mods).filter(m => !!m);
    return resolveWeaponStats(entry.base, mods);
  }, [build, entry]);
  const rail = WEAPON_CATALOG.filter(w => w.slot === tab && profile.ownedWeapons.includes(w.id));
  const menuParts = menuSlot ? attachmentsFor(selected, menuSlot) : [];
  const ownedParts = profile.ownedAttachments[selected] ?? [];

  const pickGun = (id: WeaponId) => {
    const w = weaponById(id)!;
    setTab(w.slot); setSelected(id); setMenuSlot(null);
    const res = setLoadoutWeapon(profile, w.slot, id);
    if (res.ok) onProfile(res.value);
  };
  const buyPart = (id: AttachmentId) => {
    const part = attachmentById(id)!;
    const res = equipAttachment(profile, selected, id, part.slot);
    if (res.ok) onProfile(res.value);
  };

  return (
    <div className="tdm-setup">
      <header className="tdm-top">
        <button className="cmd-back" onClick={onBack}>‹ Back</button>
        <b>WAREHOUSE TDM SETUP</b>
        <span className="mono">3 FRAG + 1 FLASH · 2:30 MATCH · 10s RESPAWN</span>
      </header>
      <div className="tdm-cols">
        <aside className="tdm-left">
          <h3>Armor</h3>
          {ARMOR.map(a => (
            <button key={a.level} className={`tdm-armor ${armor === a.level ? 'on' : ''}`} onClick={() => setArmor(a.level)}>
              <span className="tdm-ico">{a.icon}</span>
              <span><b>{a.name}</b><em>{a.hp} HP · {a.note}</em></span>
            </button>
          ))}
          <h3>Enemy armor</h3>
          <ul className="tdm-enemy-arm">
            {BRAVO_ROSTER.map(r => (
              <li key={r.name}><b>{r.name}</b> {ARMOR[r.armor].icon} {ARMOR[r.armor].name}</li>
            ))}
          </ul>
        </aside>
        <section className="tdm-center">
          <GunViewer weapon={selected} skin={build.skin ?? 'factory'} build={build} activeSlot={menuSlot} flashSlot={null} onHotspot={s => setMenuSlot(s)} />
          <div className="stage-ribbon mono">
            <div><span>DMG</span><b>{stats.damage.toFixed(0)}</b></div>
            <div><span>RPM</span><b>{stats.rpm}</b></div>
            <div><span>MAG</span><b>{stats.magSize}</b></div>
            <div><span>ADS</span><b>{(stats.adsTime * 1000).toFixed(0)}ms</b></div>
          </div>
          <div className="armory-tabs">
            {(['primary', 'secondary'] as SlotId[]).map(t => (
              <button key={t} className={`armory-tab ${tab === t ? 'on' : ''}`} onClick={() => { setTab(t); setSelected(profile.loadout[t].weapon); }}>{t}</button>
            ))}
          </div>
          <div className="tdm-grid">
            {rail.map(w => (
              <button key={w.id} className={`wcard ${selected === w.id ? 'sel' : ''}`} onClick={() => pickGun(w.id)}>
                {thumbs[w.id] ? <img src={thumbs[w.id]} alt="" className="wcard-thumb" /> : <span className="wcard-thumb" />}
                <span className="wcard-name">{w.short}</span>
              </button>
            ))}
          </div>
        </section>
        <aside className="tdm-right">
          {menuSlot ? (
            <>
              <div className="partmenu-head"><span>{SLOT_LABELS[menuSlot]}</span><button className="util-btn" onClick={() => setMenuSlot(null)}>Close</button></div>
              {menuParts.map(part => {
                const owned = ownedParts.includes(part.id) || true;
                const eq = build.attachments[menuSlot] === part.id;
                return (
                  <div key={part.id} className={`pcard ${eq ? 'equipped' : ''}`}>
                    <strong>{part.name}</strong>
                    <span className="pcard-tier">{[1, 2, 3].map(i => <i key={i} className={i <= part.tier ? 'on' : ''} />)}</span>
                    <p className="pcard-desc">{part.desc}</p>
                    <div className="pcard-mods">{part.pros.map(p => <span key={p} className="pro">+ {p}</span>)}{part.cons.map(c => <span key={c} className="con">− {c}</span>)}</div>
                    <button className="pcard-btn" onClick={() => buyPart(part.id)}>{eq ? 'Equipped' : owned ? 'Equip' : 'Buy & Equip'}</button>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="tdm-rules">
              <h3>Loadout rules</h3>
              <p>Main + secondary + attachments. All unlocked guns are free. Every operator spawns with 3 frags and 1 flash. No cash economy in TDM.</p>
              <p>Click brass pins on the gun to open attachment slots.</p>
            </div>
          )}
        </aside>
      </div>
      <button className="deploy-btn tdm-go" onClick={() => onDeploy(armor, profile.loadout)}>DEPLOY TO WAREHOUSE</button>
    </div>
  );
}
