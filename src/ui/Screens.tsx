import { useCallback, useEffect, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import type { CashLogEntry, GameSettings, TdmHud } from '../game/engine';
import { weaponById } from '../game/economy/catalog';
import { DEFAULT_PROFILE, type PlayerProfile } from '../game/economy/profile';
import { MAPS, isMissionMap, type MapId } from '../game/world';
import type { DefusalHud, DefusalResult } from '../game/defusal/mode';
import { WEAPON_CATALOG } from '../game/economy/catalog';
import { getMission, type MissionReport } from '../game/systems/mission';
import type { MissionHud } from '../game/systems/mission-runtime';
import type { KitHud, KitId } from '../game/kits';
import { AbilityCardWide, KitPauseCard } from './Kits';
import type { PressureStats } from '../game/systems/reinforcements';
import { missionClock, objectiveReadout } from './MissionObjective';
import { CountUp } from './components';
import CashCounter from './armory/CashCounter';
import { gradeFor } from '../game/economy/rewards';
import { voice } from '../game/voice';
import mapAlrasul from '../assets/map-alrasul.jpg';
import mapKasbah from '../assets/map-kasbah.jpg';
import mapArena from '../assets/map-arena.jpg';
import mapSirocco from '../assets/map-sirocco.jpg';
import operatorArt from '../assets/operator.jpg';
import menuCenter from '../assets/menu-center.jpg';
import { TxBack } from './tactical';
import { menuStep } from './bindings';
import MapFlyover from './MapFlyover';
import { gunThumbnail } from './armory/GunViewer';
import { weaponTexturesReady } from '../game/weapons/finish';
import type { TDMOutcome } from '../game/tdm';

export const MAP_ART: Record<MapId, string> = { alrasul: mapAlrasul, kasbah: mapKasbah, arena: mapArena, sirocco: mapSirocco };

/** Arena Mode → Bomb Defusal launch options (persisted by App). */
export interface DefusalMenuOptions { side: 'attack' | 'defend' | 'random'; format: 'short' | 'long' }

/** Story operations. The select screen intentionally says enough without a dossier wall. */
const OPERATIONS: { id: MapId; name: string; setting: string; line: string; art: string }[] = [
  { id: 'kasbah', name: 'Kasbah', setting: 'Fortified market town', line: 'Thread the alleys, break the blockade and get your team out.', art: mapKasbah },
  { id: 'alrasul', name: 'Sandblast', setting: 'Desert river valley', line: 'Push through the wadi and hold the crossing before the convoy arrives.', art: mapAlrasul },
];

export interface Results {
  win: boolean; kills: number; score: number; shots: number; hits: number; headshots: number; timeSec: number;
  mission: MissionReport; pressure: PressureStats;
  cash: number; cashLog: CashLogEntry[]; difficultyMul: number;
  tdm?: {
    alphaScore: number; bravoScore: number; playerKills: number; outcome: TDMOutcome;
    roster: { name: string; team: 'alpha' | 'bravo'; dead: boolean; armorIcon: string; you?: boolean; kills: number; deaths: number; headshots: number }[];
  };
  defusal?: DefusalResult;
}

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="square" /></svg>
);

/* ---------- tactical-home glyphs (inline, no extra assets) ---------- */
const CoinIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="#C9A15A" strokeWidth="1.4" /><circle cx="6" cy="6" r="1.6" fill="#C9A15A" /></svg>
);
const RankIcon = () => (
  <svg width="20" height="20" viewBox="0 0 22 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="miter"><path d="M3 7.5l8-5 8 5" /><path d="M3 12.5l8-5 8 5" /><path d="M3 17.5l8-5 8 5" /></svg>
);
const CrossIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true"><circle cx="12" cy="12" r="6.5" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></svg>
);



const INTEL_TABS = [
  { id: 'people', label: 'PEOPLE' },
  { id: 'terrain', label: 'TERRAIN' },
  { id: 'objectives', label: 'OBJECTIVES' },
  { id: 'results', label: 'RESULTS' },
] as const;

/* ================================================================
   TACTICAL HOME — full-bleed operations interface.
   Left: wordmark + stacked deploy nav. Center: torn-paper AO slice.
   Right: wallet + operator chip, intel tabs, loadout card, motto.
   Fully interactive: mouse + WASD/arrows + Enter + Tab profile.
   ================================================================ */
function TacticalHome({ prof, primaryName, secondaryName, onSelect, onArmory, onSettings }: {
  prof: PlayerProfile; primaryName: string; secondaryName: string;
  onSelect: (view: 'maps' | 'arena') => void; onArmory: () => void; onSettings: () => void;
}) {
  const [sel, setSel] = useState(0);
  const [intel, setIntel] = useState(2);
  const [profileOpen, setProfileOpen] = useState(false);
  const [cashShown, setCashShown] = useState(0);
  const rootRef = useRef<HTMLElement | null>(null);
  const cashTarget = prof.cash;
  const level = 13 + prof.missions;
  const phaseCount = getMission('kasbah').phases.length + getMission('alrasul').phases.length;
  const intelReadouts = [
    'Recoil_01',
    'Desert valley · grid 39S',
    `2 arenas · ${phaseCount} phases`,
    prof.missions > 0 || prof.kills > 0 ? `${prof.missions} ops · ${prof.kills} kills` : 'Awaiting deployment',
  ];

  // Wallet ticker — rolls up fast on mount.
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setCashShown(Math.round(cashTarget * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cashTarget]);

  const items = [
    { id: 'missions', idx: '01', title: 'Missions', sub: 'Pick a battlefield and deploy', action: () => onSelect('maps') },
    { id: 'arena', idx: '02', title: 'Arena', sub: 'Bomb defusal and team deathmatch', action: () => onSelect('arena') },
    { id: 'loadout', idx: '03', title: 'Loadout', sub: 'Weapons, attachments and skins', action: onArmory },
    { id: 'settings', idx: '04', title: 'Settings', sub: 'Video, audio and controls', action: onSettings },
  ];
  const activate = useCallback((i: number) => { items[i]?.action(); }, [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab') { e.preventDefault(); setProfileOpen(o => !o); return; }
      if (e.code === 'Escape') { setProfileOpen(false); return; }
      if (profileOpen) return;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') { e.preventDefault(); setSel(s => menuStep(s, -1, items.length)); }
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') { e.preventDefault(); setSel(s => menuStep(s, 1, items.length)); }
      else if (e.code === 'KeyA' || e.code === 'ArrowLeft') { setIntel(v => (v + 3) % 4); }
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') { setIntel(v => (v + 1) % 4); }
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); activate(sel); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activate, items.length, profileOpen, sel]);

  // Pointer parallax — backdrop layers drift against the operator.
  const onMouse = (e: RMouseEvent) => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    const ny = ((e.clientY - r.top) / r.height - 0.5) * 2;
    el.style.setProperty('--mx', nx.toFixed(3));
    el.style.setProperty('--my', ny.toFixed(3));
  };

  return (
    <main ref={rootRef} className="rm-root" onMouseMove={onMouse}>
      <div className="rm-base" aria-hidden="true" />
      <div className="rm-topo" aria-hidden="true" />
      <div className="rm-center" aria-hidden="true">
        <img src={menuCenter} alt="" draggable={false} />
        <div className="rm-center-shade" />
        <div className="rm-coords mono seq" style={{ animationDelay: '.18s' }}>
          <CrossIcon />
          <span>33.7731° N<br />44.4208° E</span>
        </div>
      </div>
      <img src={operatorArt} alt="" draggable={false} className="rm-operator" aria-hidden="true" />
      <div className="rm-vignette" aria-hidden="true" />
      <div className="rm-grain" aria-hidden="true" />

      <div className="rm-layout">
        <div className="rm-left">
          <div className="rm-titleblock seq" style={{ animationDelay: '.02s' }}>
            <h1 className="rm-title">RECOIL<sup>®</sup></h1>
            <span className="rm-subtitle">Desert operations</span>
            <i className="rm-goldrule" aria-hidden="true" />
          </div>

          <nav className="rm-nav" aria-label="Main menu">
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                className={`rm-item seq${i === sel ? ' sel' : ''}`}
                style={{ animationDelay: `${0.08 + i * 0.05}s` }}
                onMouseEnter={() => setSel(i)}
                onFocus={() => setSel(i)}
                onClick={() => activate(i)}
                aria-current={i === sel ? 'true' : undefined}
              >
                <span className="rm-idx mono">{it.idx}</span>
                <span className="rm-item-body"><b>{it.title}</b><em>{it.sub}</em></span>
                <span className="rm-arrow"><Arrow /></span>
              </button>
            ))}
          </nav>

        </div>

        <div className="rm-right">
          <div className="rm-topbar seq" style={{ animationDelay: '.06s' }}>
            <span className="rm-cash" title="Wallet balance">
              <CoinIcon />
              <b className="mono tabular">${cashShown.toLocaleString('en-US')}</b>
            </span>
            <button type="button" className="rm-op" onClick={() => setProfileOpen(true)} title="Open player profile (Tab)">
              <RankIcon />
              <span className="rm-op-body"><b>Recoil_01</b><i>Level {level}</i></span>
            </button>
          </div>

          <div className="rm-intel seq" style={{ animationDelay: '.14s' }} role="tablist" aria-label="Field intel">
            {INTEL_TABS.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={i === intel}
                className={`rm-intel-tab${i === intel ? ' on' : ''}`}
                onMouseEnter={() => setIntel(i)}
                onFocus={() => setIntel(i)}
                onClick={() => setIntel(i)}
              >
                {t.label}
              </button>
            ))}
            <span className="rm-intel-readout mono">{intelReadouts[intel]}</span>
            <i className="rm-goldrule sm right" aria-hidden="true" />
          </div>

        </div>
      </div>

      <footer className="rm-foot seq" style={{ animationDelay: '.32s' }}>
        <span className="rm-keys">
          <span className="rm-key">W</span><span className="rm-key">A</span><span className="rm-key">S</span><span className="rm-key">D</span>
        </span>
        <span className="rm-sep" aria-hidden="true" />
        <span className="rm-keys"><span className="rm-key wide">ENTER</span></span>
        <span className="rm-sep" aria-hidden="true" />
        <span className="rm-keys"><span className="rm-key wide">TAB</span></span>
        <span className="rm-foot-right">v1.1.0</span>
      </footer>

      {profileOpen && (
        <div className="rm-profile-scrim" onClick={() => setProfileOpen(false)}>
          <aside className="rm-profile" role="dialog" aria-label="Player profile" onClick={e => e.stopPropagation()}>
            <div className="rm-profile-head">
              <span>Profile</span>
              <button type="button" onClick={() => setProfileOpen(false)} aria-label="Close profile">✕</button>
            </div>
            <div className="rm-profile-callsign">RECOIL_01</div>
            <div className="rm-profile-lvl">Level {level}</div>
            <div className="rm-profile-rows">
              <div><span>Missions</span><b className="tabular">{prof.missions}</b></div>
              <div><span>Eliminations</span><b className="tabular">{prof.kills}</b></div>
              <div><span>Wallet</span><b className="tabular">${prof.cash.toLocaleString('en-US')}</b></div>
              <div><span>Primary</span><b>{primaryName}</b></div>
              <div><span>Secondary</span><b>{secondaryName}</b></div>
            </div>
            <div className="rm-profile-foot">Tab or Esc to close</div>
          </aside>
        </div>
      )}
    </main>
  );
}

/* ================================================================
   ARENA MODE — two 5v5 modes. Hovering a card turns the whole screen into a
   live 3D orbit of that arena.
   ================================================================ */
/** A labelled row. One word on the left, the control on the right. */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="ar-row">
    <span className="ar-row-label">{label}</span>
    <div className="ar-row-body">{children}</div>
  </div>
);

/** A segmented control. Flat, one line, no badges — pick one and move on. */
const Seg = <T extends string,>({ name, value, options, onChange }: {
  name: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void;
}) => (
  <div className="ar-seg" role="radiogroup" aria-label={name}>
    {options.map(o => (
      <button key={o.id} type="button" role="radio" aria-checked={value === o.id}
        className={`ar-seg-btn${value === o.id ? ' on' : ''}`} onClick={() => onChange(o.id)}>
        {o.label}
      </button>
    ))}
  </div>
);

function ArenaView({ primaryName, secondaryName, onBack, onMap, onDeploy, onArenaSetup, onAbilities, equippedKit, defusal, onDefusal }: {
  primaryName: string; secondaryName: string;
  onBack: () => void; onMap: (map: GameSettings['map']) => void;
  onDeploy: (map?: GameSettings['map']) => void; onArenaSetup?: () => void; onAbilities: () => void;
  equippedKit: KitId | null;
  defusal: DefusalMenuOptions; onDefusal: (o: DefusalMenuOptions) => void;
}) {
  const [mode, setMode] = useState<'defusal' | 'tdm'>('defusal');
  const [hovered, setHovered] = useState<MapId | null>(null);
  const live = hovered !== null;
  const isDf = mode === 'defusal';
  // Warm the buy-menu thumbnails in the background while the player reads the options.
  useEffect(() => {
    if (!isDf) return;
    let active = true;
    void weaponTexturesReady.then(async () => {
      for (const w of WEAPON_CATALOG) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!active) return;
        gunThumbnail(w.id);
      }
    });
    return () => { active = false; };
  }, [isDf]);
  const play = () => { const m: MapId = isDf ? 'sirocco' : 'arena'; onMap(m); onDeploy(m); };
  const cards = [
    {
      id: 'sirocco' as MapId, mode: 'defusal' as const, name: 'Sirocco', kind: 'Bomb defusal',
      line: 'Rounds, no respawns, buy your gun each round. Plant the bomb — or stop it.',
    },
    {
      id: 'arena' as MapId, mode: 'tdm' as const, name: 'Warehouse', kind: 'Team deathmatch',
      line: 'One long fight with respawns. Most eliminations when the clock runs out wins it.',
    },
  ];
  return (
    <main className="tx-root ar-root">
      <div className="map2-base" aria-hidden="true" />
      <div className={`map2-flyover ${live ? 'live' : ''}`} aria-hidden="true">
        {cards.map(c => (
          <div key={c.id} className="map2-flyover-slot" style={{ opacity: hovered === c.id ? 1 : 0 }}>
            <MapFlyover mapId={c.id} active={hovered === c.id} />
          </div>
        ))}
      </div>
      <div className="tx-grain" aria-hidden="true" />

      <header className="ar-head seq" style={{ animationDelay: '.02s' }}>
        <TxBack onClick={onBack} />
        <h1 className="ar-title">Arena</h1>
      </header>

      <div className="ar-cards seq" style={{ animationDelay: '.08s' }} role="listbox" aria-label="Choose a mode">
        {cards.map(c => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={mode === c.mode}
            className={`ar-card${mode === c.mode ? ' on' : ''}`}
            onMouseEnter={() => setHovered(c.id)}
            onMouseLeave={() => setHovered(cur => (cur === c.id ? null : cur))}
            onFocus={() => setHovered(c.id)}
            onBlur={() => setHovered(cur => (cur === c.id ? null : cur))}
            onClick={() => setMode(c.mode)}
            onDoubleClick={() => { setMode(c.mode); onMap(c.id); onDeploy(c.id); }}
          >
            <img src={MAP_ART[c.id]} alt="" draggable={false} className="ar-card-art" />
            <span className="ar-card-veil" aria-hidden="true" />
            <span className="ar-card-text">
              <b>{c.name}</b>
              <em>{c.kind}</em>
              <span className="ar-card-line">{c.line}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="ar-setup seq" style={{ animationDelay: '.14s' }}>
        {isDf ? (
          <>
            <Row label="Side">
              <Seg name="Side" value={defusal.side} onChange={side => onDefusal({ ...defusal, side })}
                options={[
                  { id: 'attack', label: 'Attack' },
                  { id: 'defend', label: 'Defend' },
                  { id: 'random', label: 'Random' },
                ]} />
            </Row>
            <Row label="Match">
              <Seg name="Match length" value={defusal.format} onChange={format => onDefusal({ ...defusal, format })}
                options={[
                  { id: 'short', label: 'First to 7' },
                  { id: 'long', label: 'First to 13' },
                ]} />
            </Row>
          </>
        ) : (
          <Row label="Loadout">
            <span className="ar-loadline">{primaryName} <i>·</i> {secondaryName}</span>
            <button type="button" className="ar-link" onClick={() => { onMap('arena'); onArenaSetup?.(); }}>Change</button>
          </Row>
        )}
        <Row label="Ability">
          <AbilityCardWide kit={equippedKit} onOpen={onAbilities} />
        </Row>
      </div>

      <div className="ar-go seq" style={{ animationDelay: '.2s' }}>
        <button className="deploy-btn" onClick={play}>
          <span>Play</span>
          <Arrow />
        </button>
      </div>
    </main>
  );
}

/* ================================================================
   MAIN MENU — home, operation selection, operation briefing and arena setup.
   ================================================================ */
const PHASE_VERB: Record<string, string> = {
  advance: 'Advance', clear: 'Clear', destroy: 'Destroy', hold: 'Hold', defend: 'Defend', extract: 'Extract',
};

export function MainMenu({ s, onDeploy, onSettings, onMap, onArmory, onArenaSetup, onAbilities, initialView, profile, defusal, onDefusal }: {
  s: GameSettings; onDeploy: (map?: GameSettings['map']) => void; onSettings: () => void; onMap: (map: GameSettings['map']) => void;
  onArmory?: () => void; onArenaSetup?: () => void; onAbilities?: () => void; initialView?: 'home' | 'maps' | 'arena'; profile?: PlayerProfile;
  defusal?: DefusalMenuOptions; onDefusal?: (o: DefusalMenuOptions) => void;
}) {
  const prof = profile ?? DEFAULT_PROFILE;
  const primaryName = weaponById(prof.loadout.primary.weapon)?.short ?? '—';
  const secondaryName = weaponById(prof.loadout.secondary.weapon)?.short ?? '—';
  const [view, setView] = useState<'home' | 'maps' | 'missions' | 'arena'>(initialView ?? 'home');
  const [selectedOperation, setSelectedOperation] = useState<MapId>(() => isMissionMap(s.map) ? s.map : 'kasbah');
  const operationRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIdxRef = useRef(0);
  // Arrow keys mirror the calm segmented controls used elsewhere: choose an
  // operation, then activate the one clear continuation action.
  useEffect(() => {
    if (view !== 'maps') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'KeyD') {
        e.preventDefault();
        focusIdxRef.current = (focusIdxRef.current + 1) % OPERATIONS.length;
        operationRefs.current[focusIdxRef.current]?.focus();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA') {
        e.preventDefault();
        focusIdxRef.current = (focusIdxRef.current + OPERATIONS.length - 1) % OPERATIONS.length;
        operationRefs.current[focusIdxRef.current]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  /* ---------------- HOME ---------------- */
  if (view === 'home') {
    return (
      <TacticalHome
        prof={prof}
        primaryName={primaryName}
        secondaryName={secondaryName}
        onSelect={v => setView(v)}
        onArmory={() => onArmory?.()}
        onSettings={onSettings}
      />
    );
  }

  /* ---------------- MISSIONS — OPERATION SELECT ---------------- */
  if (view === 'maps') {
    const selected = OPERATIONS.find(operation => operation.id === selectedOperation) ?? OPERATIONS[0];
    const selectedMission = getMission(selected.id);
    const continueToBrief = () => { onMap(selected.id); setView('missions'); };
    return (
      <main className="op-root">
        <div className="op-wash" aria-hidden="true" />
        <div className="op-grain" aria-hidden="true" />
        <header className="op-head seq" style={{ animationDelay: '.02s' }}>
          <TxBack onClick={() => setView('home')} />
          <div>
            <h1>Operations</h1>
            <p>Choose where to deploy.</p>
          </div>
        </header>

        <section className="op-layout">
          <div className="op-list seq" style={{ animationDelay: '.07s' }} role="listbox" aria-label="Choose an operation">
            {OPERATIONS.map((operation, i) => {
              const active = operation.id === selected.id;
              return (
                <button
                  key={operation.id}
                  ref={node => { operationRefs.current[i] = node; }}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`op-row${active ? ' on' : ''}`}
                  onClick={() => setSelectedOperation(operation.id)}
                  onDoubleClick={continueToBrief}
                  onFocus={() => { focusIdxRef.current = i; setSelectedOperation(operation.id); }}
                >
                  <img src={operation.art} alt="" draggable={false} />
                  <span>
                    <b>{operation.name}</b>
                    <em>{operation.setting}</em>
                  </span>
                </button>
              );
            })}
          </div>

          <article className="op-feature seq" style={{ animationDelay: '.12s' }}>
            <img src={selected.art} alt="" draggable={false} className="op-feature-art" />
            <div className="op-feature-shade" aria-hidden="true" />
            <div className="op-feature-copy">
              <p>{selected.setting}</p>
              <h2>{selected.name}</h2>
              <span>{selected.line}</span>
            </div>
            <div className="op-objectives">
              {selectedMission.phases.map(phase => (
                <span key={phase.id}>{phase.title}</span>
              ))}
            </div>
          </article>
        </section>

        <footer className="op-foot seq" style={{ animationDelay: '.18s' }}>
          <span>{selectedMission.phases.length} objectives</span>
          <button type="button" className="deploy-btn" onClick={continueToBrief}>
            <span>Continue</span><Arrow />
          </button>
        </footer>
      </main>
    );
  }

  /* ---------------- ARENA MODE ---------------- */
  if (view === 'arena') {
    return (
      <ArenaView
        primaryName={primaryName}
        secondaryName={secondaryName}
        onBack={() => setView('home')}
        onMap={onMap}
        onDeploy={onDeploy}
        onArenaSetup={onArenaSetup}
        onAbilities={() => onAbilities?.()}
        equippedKit={prof.equippedKit}
        defusal={defusal ?? { side: 'random', format: 'short' }}
        onDefusal={o => onDefusal?.(o)}
      />
    );
  }

  /* ---------------- MISSIONS ---------------- */
  const mapName = MAPS.find(m => m.id === s.map)?.name ?? '';
  const mission = getMission(isMissionMap(s.map) ? s.map : 'alrasul');
  return (
    <main className="menu-root msn-root">
      <div className="menu-bg" aria-hidden="true" />
      <div className="msn-art" aria-hidden="true" style={{ backgroundImage: `url(${MAP_ART[s.map]})` }} />
      <div className="msn-art-fade" aria-hidden="true" />
      <div className="paper-grain" aria-hidden="true" />

      <header className="menu-header">
        <button className="cmd-back" onClick={() => setView('maps')}><span aria-hidden="true">‹</span> Back</button>
        <span className="pick-heading">
          <span className="menu-eyebrow">{mapName}</span>
          <b>Operation {mission.name}</b>
        </span>
        <span className="menu-loadout" aria-label="Equipped loadout">
          <span><b>1</b> {primaryName}</span>
          <span><b>2</b> {secondaryName}</span>
        </span>
      </header>

      <div className="msn-wrap">
        <div className="msn-brief seq" style={{ animationDelay: '.05s' }}>
          <p>{mission.brief}</p>
        </div>
        <ol className="msn-list" aria-label="Mission list">
          {mission.phases.map((p, i) => (
            <li key={p.id} className="msn-card seq" style={{ animationDelay: `${0.1 + i * 0.05}s` }}>
              <span className="msn-idx mono">0{i + 1}</span>
              <span className="msn-verb">{PHASE_VERB[p.type] ?? 'Secure'}</span>
              <span className="msn-body">
                <b>{p.title}</b>
                <em>{p.location}</em>
              </span>
              <span className="msn-status mono">{i === 0 ? 'START' : 'LOCKED'}</span>
            </li>
          ))}
        </ol>
        <div className="msn-cta seq" style={{ animationDelay: `${0.15 + mission.phases.length * 0.05}s` }}>
          <button className="deploy-btn" onClick={() => onDeploy()}>
            <span>Deploy</span>
            <span className="hint">{mapName} · {mission.phases.length} objectives</span>
            <Arrow />
          </button>
          <button className="menu-secondary-btn" onClick={onArmory}>
            Loadout <span>{primaryName} + {secondaryName}</span>
          </button>
        </div>
      </div>
    </main>
  );
}

/* ================================================================
   DEPLOY SEQUENCE — CINEMATIC INSERTION
   Full-bleed aerial of the AO slowly pushing in, a typed sitrep feed,
   and a clean progress rail. Replaces the old cramped briefing plate
   (the objective list already lives on the missions screen).
   ================================================================ */
const BOOT_TIPS = [
  'Use hard cover to break hostile line of sight.',
  'Hold G to cook a frag; release to throw it.',
  'Press X inside the objective ring to interact.',
  'Lean with Q and E, then return to cover before firing.',
  'Reload before crossing an exposed lane.',
  'Manage the magazine; reserve ammunition is not consumed.',
  'Buy an ability in ABILITIES, then press Z in game: Mine, Decoy, Medkit or Barricade.',
];

export function BootScreen({ map }: { map?: MapId }) {
  const [tipIndex, setTipIndex] = useState(0);
  const isDefusal = map === 'sirocco';
  const mission = map && !isMissionMap(map) ? null : getMission(map && isMissionMap(map) ? map : 'alrasul');
  const mapName = MAPS.find(m => m.id === (map ?? 'alrasul'))?.name ?? '';
  useEffect(() => {
    const timer = window.setInterval(() => setTipIndex(index => (index + 1) % BOOT_TIPS.length), 3600);
    return () => window.clearInterval(timer);
  }, []);
  // Voiceover: brief the operator while the world builds. The Deploy click is the
  // user gesture, so speech is already unlocked when this mounts.
  useEffect(() => {
    voice.unlock();
    if (!mission) {
      voice.briefing(isDefusal
        ? 'Sirocco. Bomb defusal, five on five. Attackers carry the bomb to site A or site B. Defenders hold the sites, or defuse. Buy between rounds, keep your gun if you survive. Win the rounds, win the economy. Good luck, operator.'
        : 'Warehouse arena. Five on five, two minutes thirty on the clock. Most eliminations wins. Five second redeploy. Watch the container lanes and fight for the twin halls. Good luck, operator.');
      return;
    }
    const first = mission.phases[0];
    const narration = `Operation ${mission.name}. ${mission.brief} First objective: ${first.title.toLowerCase()}, at the ${first.location.toLowerCase()}. ${mission.phases.length} objectives stand between you and extraction. Good luck, operator.`;
    voice.briefing(narration);
    // No cancel on unmount: builds are fast, so the narration is allowed to
    // finish over the first seconds in-game (mission radio interrupts it anyway).
  }, [mission, isDefusal]);
  return (
    <div className="boot-root boot-cine" aria-busy="true">
      <div className="boot-cine-art" style={{ backgroundImage: `url(${MAP_ART[map ?? 'alrasul']})` }} aria-hidden="true" />
      <div className="boot-cine-shade" aria-hidden="true" />
      <div className="boot-cine-grid" aria-hidden="true" />

      <div className="boot-cine-top">
        <span className="boot-kicker">Insertion — {mapName}</span>
        <h2 className="boot-cine-title">{mission ? `Operation ${mission.name}` : isDefusal ? 'Sirocco · Bomb Defusal' : 'Warehouse TDM'}</h2>
      </div>

      <div className="boot-cine-bottom">
        <div className="boot-feed mono" role="status" aria-live="polite" aria-atomic="true">
          <span key={tipIndex} className="cur">Tip — {BOOT_TIPS[tipIndex]}</span>
        </div>
        <div className="boot-cine-railwrap">
          <div className="boot-bar" role="progressbar" aria-label="Preparing match" aria-valuetext="Loading">
            <span className="boot-bar__fill boot-bar__indeterminate" aria-hidden="true" />
          </div>
          <div className="boot-cine-railmeta mono">
            <span>{mission ? `${mission.phases[0].title} · ${mission.phases[0].location}` : isDefusal ? 'Plant on A or B · defuse · buy every round' : 'Loading world…'}</span>
            <span>Loading world…</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   PAUSE — SUSPENDED
   ================================================================ */
const PZ_ICONS: Record<string, React.ReactNode> = {
  resume: <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  restart: <><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v4h4" /></>,
  quit: <><path d="M14 4h5v16h-5" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
};

export function PauseMenu({ mission, kit, tdm, mapName, defusal, onResume, onRestart, onSettings, onQuit }: {
  mission?: MissionHud; kit?: KitHud; tdm?: TdmHud; mapName?: string; defusal?: DefusalHud;
  onResume: () => void; onRestart: () => void; onSettings: () => void; onQuit: () => void;
}) {
  const readout = mission && !tdm ? objectiveReadout(mission) : undefined;
  // Restart and Quit throw away the match: the first press arms, the second confirms.
  const [armed, setArmed] = useState<'restart' | 'quit' | null>(null);
  const [focus, setFocus] = useState(0);
  const actions = [
    { id: 'resume', label: 'Resume', sub: 'Back into the fight', run: onResume },
    { id: 'settings', label: 'Settings', sub: 'Controls · video · audio', run: onSettings },
    { id: 'restart', label: armed === 'restart' ? 'Confirm restart' : 'Restart', sub: armed === 'restart' ? 'Progress this match is lost' : 'Same map, fresh start', run: () => (armed === 'restart' ? onRestart() : setArmed('restart')) },
    { id: 'quit', label: armed === 'quit' ? 'Confirm quit' : 'Quit to menu', sub: armed === 'quit' ? 'Ends the game · change abilities in ABILITIES' : 'End the game', run: () => (armed === 'quit' ? onQuit() : setArmed('quit')) },
  ];
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    btns.current[0]?.focus();
    const resumeOnEscape = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onResume(); }
    };
    window.addEventListener('keydown', resumeOnEscape);
    return () => window.removeEventListener('keydown', resumeOnEscape);
  }, [onResume]);
  const onKey = (e: React.KeyboardEvent) => {
    const n = actions.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (focus + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      setFocus(next); btns.current[next]?.focus();
    } else if (/^[1-4]$/.test(e.key)) {
      actions[Number(e.key) - 1].run();
    }
  };
  const you = tdm?.roster.find(r => r.you);
  if (defusal) {
    // Arena card: the live match instead of an operation brief.
    const df = defusal;
    return (
      <section className="pause-layer" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <div className="pause-wrap anim-rise">
          <div className="pause-left">
            <span className="stencil">System pause</span>
            <h2 id="pause-title" className="pause-title">Paused</h2>
            <div className="pause-actions">
              <button className="pause-action pause-action-primary" onClick={onResume}><span>Resume</span><span className="idx">01</span></button>
              <button className="pause-action" onClick={onSettings}><span>Settings</span><span className="idx">02</span></button>
              <button className="pause-action" onClick={onRestart}><span>Restart match</span><span className="idx">03</span></button>
              <button className="pause-action" onClick={onQuit}><span>Quit to menu</span><span className="idx">04</span></button>
            </div>
            <p className="pause-hint"><span className="keycap">Esc</span> Resume anytime</p>
          </div>
          <div className="pause-card">
            <div className="pause-card-head">
              <span>Sirocco <b>Bomb Defusal</b></span>
              <span className="pause-clock tabular">{df.alphaScore} — {df.bravoScore}</span>
            </div>
            <span className="pause-phase">Round {String(df.round).padStart(2, '0')} / {df.maxRounds} · first to {df.roundsToWin}</span>
            <h3>{df.alphaSide === 'attack' ? 'Your squad is attacking' : 'Your squad is defending'}</h3>
            <p>{df.alphaSide === 'attack' ? 'Get the bomb onto A or B and hold it until it blows.' : 'Hold both sites. If the bomb goes down, retake and defuse.'}</p>
            <div className="pause-progress"><span style={{ width: `${Math.round((Math.max(df.alphaScore, df.bravoScore) / df.roundsToWin) * 100)}%` }} /></div>
            <div className="pause-readout">
              <strong className="tabular">${df.money.toLocaleString('en-US')}</strong>
              <span>Round money</span>
            </div>
            <p className="pause-note">The round clock is frozen</p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="pz-layer" role="dialog" aria-modal="true" aria-labelledby="pause-title" onKeyDown={onKey}>
      <div className="pz-vignette" aria-hidden="true" />
      <div className="pz-wrap">
        <div className="pz-left">
          <span className="pz-eyebrow mono"><i className="pz-dot" />SYSTEM PAUSE · TIMERS FROZEN</span>
          <h2 id="pause-title" className="pz-title">Paused</h2>
          {mapName && <span className="pz-map mono">{mapName}</span>}
          <nav className="pz-actions" aria-label="Pause menu">
            {actions.map((a, i) => (
              <button key={a.id} ref={el => { btns.current[i] = el; }}
                className={`pz-action ${a.id === 'resume' ? 'primary' : ''} ${armed === a.id ? 'armed' : ''}`}
                style={{ animationDelay: `${60 + i * 45}ms` }}
                onFocus={() => setFocus(i)} onMouseEnter={() => setFocus(i)}
                onBlur={() => { if (armed === a.id) setArmed(null); }}
                onClick={a.run}>
                <svg className="pz-action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PZ_ICONS[a.id]}</svg>
                <span className="pz-action-text"><b>{a.label}</b><em>{a.sub}</em></span>
                <span className="pz-action-key mono">{i + 1}</span>
              </button>
            ))}
          </nav>
          <p className="pz-hint mono"><span className="keycap">Esc</span> resume · <span className="keycap">↑↓</span> move · <span className="keycap">1–4</span> select</p>
        </div>

        <div className="pz-right">
          {tdm ? (
            <div className="pz-panel pz-score" style={{ animationDelay: '80ms' }}>
              <div className="pz-panel-head mono"><span>TEAM DEATHMATCH</span><span className="tabular">{missionClock(tdm.timeLeft)} LEFT</span></div>
              <div className="pz-score-row">
                <div className="pz-team alpha"><span>ALPHA</span><b className="tabular">{tdm.alphaScore}</b></div>
                <span className="pz-vs mono">VS</span>
                <div className="pz-team bravo"><b className="tabular">{tdm.bravoScore}</b><span>BRAVO</span></div>
              </div>
              <div className="pz-score-bar" aria-hidden="true">
                <i style={{ flex: Math.max(1, tdm.alphaScore) }} /><i className="b" style={{ flex: Math.max(1, tdm.bravoScore) }} />
              </div>
              {you && (
                <div className="pz-stats mono">
                  <span><b className="tabular">{you.kills}</b>KILLS</span>
                  <span><b className="tabular">{you.deaths}</b>DEATHS</span>
                  <span><b className="tabular">{you.headshots}</b>HEADSHOTS</span>
                  <span><b className="tabular">{you.deaths ? (you.kills / you.deaths).toFixed(2) : you.kills.toFixed(2)}</b>K/D</span>
                </div>
              )}
            </div>
          ) : (
            <div className="pz-panel pz-op" style={{ animationDelay: '80ms' }}>
              <div className="pz-panel-head mono">
                <span>OPERATION · <b>{mission?.name ?? 'Ready'}</b></span>
                <span className="tabular">{mission ? missionClock(mission.elapsed) : '00:00'}</span>
              </div>
              <span className="pz-phase mono">PHASE {mission ? `0${mission.index + 1} / 0${mission.phaseCount}` : '—'}</span>
              <h3>{mission?.title ?? 'Ready to deploy'}</h3>
              <p>{mission?.brief ?? 'Select resume to continue.'}</p>
              <div className="pz-progress"><span style={{ width: `${Math.round((mission?.progress ?? 0) * 100)}%` }} /></div>
              {readout && <div className="pz-readout"><strong className="tabular">{readout.value}</strong><span>{readout.label}</span></div>}
            </div>
          )}

          <div className="pz-panel" style={{ animationDelay: '140ms' }}>
            <div className="pz-panel-head mono"><span>KIT</span><span>{kit ? <span className="keycap">{kit.key}</span> : 'NONE'}</span></div>
            <KitPauseCard kit={kit} />
          </div>

        </div>
      </div>
    </section>
  );
}

/* ================================================================
   RESULTS — AFTER-ACTION REPORT
   ================================================================ */
export type ResultsWallet = { before: number; after: number; gradeBonus: number; earned: number };

const CASH_REASONS: Record<string, string> = {
  kill: 'Eliminations', headshot: 'Headshots', grenade: 'Grenade kills',
  streak: 'Multi-kill bonuses', shutdown: 'Momentum stopped', draw: 'Match draw', phase: 'Phases secured', extraction: 'Extraction',
  round: 'Rounds won', plant: 'Bombs planted', defuse: 'Bombs defused', mvp: 'Round MVPs', match: 'Match victory',
};
const DF_REASON_ICON: Record<string, string> = { elimination: '☠', bomb: '✹', defuse: '✂', time: '◷' };

interface CashRow { label: string; detail: string; total: number }

/** Shared payout ledger: mission, TDM and defusal all settle cash, so
 *  all results screens itemize it. */
function CashCard({ r, cashRows, wallet, grade }: { r: Results; cashRows: CashRow[]; wallet: ResultsWallet; grade: string }) {
  return (
    <section className="cash-card" aria-label="Cash earned">
      <div className="sec-label"><span>Cash earned</span><CashCounter value={r.cash} /></div>
      {cashRows.map((row) => (
        <div className="cash-row" key={row.label}>
          <span className="cash-row-label">{row.label} <small>{row.detail}</small></span>
          <span className="cash-row-val mono">+${row.total.toLocaleString('en-US')}</span>
        </div>
      ))}
      <div className="cash-row">
        <span className="cash-row-label">Difficulty <small>×{r.difficultyMul}</small></span>
        <span className="cash-row-val mono">+${Math.round(r.cash * r.difficultyMul).toLocaleString('en-US')}</span>
      </div>
      {wallet.gradeBonus > 0 && (
        <div className="cash-row">
          <span className="cash-row-label">Grade bonus <small>{grade}</small></span>
          <span className="cash-row-val mono">+${wallet.gradeBonus.toLocaleString('en-US')}</span>
        </div>
      )}
      <div className="cash-wallet">
        <span>Wallet</span>
        <span className="tabular">${wallet.before.toLocaleString('en-US')} → <CashCounter value={wallet.after} /></span>
      </div>
    </section>
  );
}

export function ResultsScreen({ r, wallet, onRedeploy, onMenu, onArmory }: {
  r: Results; wallet: ResultsWallet; onRedeploy: () => void; onMenu: () => void; onArmory: () => void;
}) {
  const accuracy = r.shots ? Math.round(r.hits / r.shots * 100) : 0;
  const completed = r.mission.phases.filter(p => p.complete).length;
  const { grade, tint } = gradeFor(r);
  const isDraw = r.tdm?.outcome === 'draw';
  const hasWon = r.tdm ? r.tdm.outcome === 'win' : r.win;
  const cashRows: { label: string; detail: string; total: number }[] = [];
  for (const reason of Object.keys(CASH_REASONS)) {
    const entries = r.cashLog.filter(e => e.reason === reason);
    if (!entries.length) continue;
    const total = entries.reduce((a, e) => a + e.amount, 0);
    cashRows.push({ label: CASH_REASONS[reason], detail: `×${entries.length}`, total });
  }
  const tdm = r.tdm;
  const df = r.defusal;
  const dfTitle = df ? `${df.winner === 'alpha' ? 'Victory' : df.winner === 'draw' ? 'Draw' : 'Defeat'} ${df.alphaScore} — ${df.bravoScore}` : '';
  return (
    <main className={`results-root ${r.win || df?.winner === 'draw' || tdm?.outcome === 'draw' ? '' : 'lose'}`}>
      <div className="results-wrap">
        <div className="results-header">
          <div className="stamp"><span className="stamp-grade" style={{ color: isDraw ? '#C9A15A' : tint }}>{isDraw ? '=' : grade}</span></div>
          <div className="results-titleblock">
            <div className="stamp-label">{isDraw ? 'Match draw' : `Grade ${grade}`}</div>
            <h2 className="results-title">{df ? dfTitle : tdm
              ? (tdm.outcome === 'draw' ? 'Draw' : tdm.outcome === 'win' ? 'Victory — Alpha squad' : 'Defeat — Bravo squad')
              : (r.win ? 'Extraction complete' : 'Mission failed')}</h2>
            <p className="results-sub">{df
              ? `Sirocco bomb defusal — you started on ${df.startSide === 'attack' ? 'attack' : 'defense'} · ${df.rounds} rounds · ${df.plants} plant${df.plants === 1 ? '' : 's'} · ${df.defuses} defuse${df.defuses === 1 ? '' : 's'} · ${df.mvps} MVP${df.mvps === 1 ? '' : 's'}.`
              : tdm
              ? `Warehouse TDM — final score ALPHA ${tdm.alphaScore} : ${tdm.bravoScore} BRAVO. You dropped ${tdm.playerKills} of Alpha's ${tdm.alphaScore}.`
              : `${r.mission.name} — ${r.win
                ? 'You completed the operation and reached the pickup.'
                : `Operation ended during ${r.mission.phases.find(p => !p.complete)?.title.toLowerCase() ?? 'extraction'}.`}`}</p>
          </div>
        </div>
        {df && (
          <section className="df-debrief" aria-label="Round history and standings">
            <div className="sec-label"><span>Round history</span><span className="mono">☠ ELIM · ✹ BOMB · ✂ DEFUSE · ◷ TIME</span></div>
            <div className="df-history big">
              {df.history.map((h, i) => (
                <span key={h.round} className={`df-hcell ${h.winner === 'alpha' ? 'win' : 'loss'} ${i > 0 && h.half !== df.history[i - 1].half ? 'half' : ''}`} title={`Round ${h.round}`}>
                  {DF_REASON_ICON[h.reason]}
                </span>
              ))}
            </div>
            <div className="sec-label"><span>Final standings</span><span className="mono">K · A · D · ADR · HS · MVP</span></div>
            {[...df.roster].sort((a, b) => b.score - a.score || b.kills - a.kills).map((p, i) => (
              <div key={p.id} className={`tdm-standing-row df-standing ${p.you ? 'you' : ''} ${p.team}`}>
                <span className="rank mono">{i + 1}</span>
                <span className="who">
                  {p.mvps > 0 && <i className="mvp">★{p.mvps > 1 ? p.mvps : ''}</i>}
                  {p.name}{p.you ? ' (YOU)' : ''}
                  <b className={`side ${p.team}`}>{p.team === 'alpha' ? 'YOUR SQUAD' : 'HOSTILES'}</b>
                </span>
                <span className="mono tabular">{p.kills}</span>
                <span className="mono tabular dim">{p.assists}</span>
                <span className="mono tabular dim">{p.deaths}</span>
                <span className="mono tabular dim">{Math.round(p.damage / Math.max(1, df.rounds))}</span>
                <span className="mono tabular dim">{p.kills ? Math.round(p.headshots / p.kills * 100) : 0}%</span>
                <span className="mono tabular kd">{p.score}</span>
              </div>
            ))}
          </section>
        )}
        {tdm && (() => {
          const standings = [...tdm.roster].sort((a, b) =>
            b.kills - a.kills || b.headshots - a.headshots || a.deaths - b.deaths);
          const mvpKills = Math.max(...standings.map(x => x.kills));
          return (
            <section className="tdm-standings" aria-label="Final standings">
              <div className="sec-label"><span>Final standings</span><span className="mono">K · D · HS · K/D</span></div>
              {standings.map((p, i) => (
                <div key={p.name} className={`tdm-standing-row ${p.you ? 'you' : ''} ${p.team}`}>
                  <span className="rank mono">{i + 1}</span>
                  <span className="who">
                    {mvpKills > 0 && p.kills === mvpKills && <i className="mvp">★</i>}
                    <em aria-hidden="true">{p.armorIcon}</em>
                    {p.name}{p.you ? ' (YOU)' : ''}
                    <b className={`side ${p.team}`}>{p.team === 'alpha' ? 'ALPHA' : 'BRAVO'}</b>
                  </span>
                  <span className="mono tabular">{p.kills}</span>
                  <span className="mono tabular dim">{p.deaths}</span>
                  <span className="mono tabular dim">{p.headshots}</span>
                  <span className="mono tabular kd">{p.deaths ? (p.kills / p.deaths).toFixed(1) : p.kills.toFixed(1)}</span>
                </div>
              ))}
            </section>
          );
        })()}

        <div className="stats-grid">
          {!tdm && !df && (
            <div className="stat-cell">
              <span className="stat-label">Objectives</span>
              <div className="stat-value tabular"><CountUp to={completed} /><small> / {r.mission.phases.length}</small></div>
            </div>
          )}
          {df && (
            <div className="stat-cell">
              <span className="stat-label">Rounds won</span>
              <div className="stat-value tabular"><CountUp to={df.alphaScore} /><small> / {df.rounds}</small></div>
            </div>
          )}
          <div className="stat-cell">
            <span className="stat-label">{tdm || df ? 'Match time' : 'Mission time'}</span>
            <div className="stat-value tabular">{missionClock(r.timeSec)}</div>
          </div>
          <div className="stat-cell">
            <span className="stat-label">Accuracy</span>
            <div className={`stat-value tabular ${accuracy >= 50 ? 'volt' : accuracy >= 25 ? '' : 'red'}`}><CountUp to={accuracy} /><small>%</small></div>
          </div>
          <div className="stat-cell">
            <span className="stat-label">Eliminations</span>
            <div className="stat-value tabular red"><CountUp to={r.kills} /></div>
          </div>
          <div className="stat-cell">
            <span className="stat-label">Score</span>
            <div className="stat-value tabular volt"><CountUp to={r.score} format={v => v.toLocaleString('en-US')} /></div>
          </div>
        </div>

        <CashCard r={r} cashRows={cashRows} wallet={wallet} grade={grade} />

        {!tdm && !df && <section className="timeline" aria-label="Mission timeline">
          <div className="sec-label" style={{ paddingBottom: 10 }}><span>Timeline</span><span className="mono">Elapsed</span></div>
          {r.mission.phases.map((phase, i) => {
            const isDone = phase.complete;
            const isFail = !isDone && phase.seconds > 0;
            return (
              <div className={`tl-row ${isDone ? 'done' : ''}`} key={phase.id}>
                <span className="tl-idx tabular">0{i + 1}</span>
                <div className="tl-body">
                  <div className="tl-title"><strong>{phase.title}</strong><time className="tabular">{missionClock(phase.seconds)}</time></div>
                  <div className="tl-bar"><span style={{ width: `${isDone ? 100 : isFail ? 45 : 0}%`, background: isDone ? 'var(--olive)' : isFail ? 'var(--blood)' : 'var(--steel)', opacity: 0.95 }} /></div>
                </div>
                <span className={`tl-status ${isDone ? 'done' : isFail ? 'fail' : ''}`}>{isDone ? 'Complete' : isFail ? 'Interrupted' : 'Not reached'}</span>
              </div>
            );
          })}
        </section>}

        <p className="results-note">
          {df
            ? <><b>{df.damage.toLocaleString('en-US')}</b> damage dealt · <b>{df.assists}</b> assists · <b>{r.headshots}</b> headshots · money resets every match — the wallet keeps it.</>
            : tdm
            ? <><b>10</b> combatants in the yard · <b>{r.headshots}</b> headshots confirmed · armor absorbed the rest.</>
            : <><b>{r.pressure.totalSpawned}</b> hostiles entered the operation · peak pressure <b>{r.pressure.peakLive}</b> · <b>{r.headshots}</b> headshots confirmed.</>}
        </p>

        <div className="results-actions">
          {isDraw ? (
            <>
              <button className="btn btn-primary" style={{ padding: '12px 20px' }} onClick={onRedeploy}><span>Rematch</span><Arrow /></button>
              <button className="btn btn-ghost" onClick={onArmory}>Open armory</button>
              <button className="btn btn-ghost" onClick={onMenu}>Return to base</button>
            </>
          ) : hasWon ? (
            <>
              <button className="btn btn-primary" style={{ padding: '12px 20px' }} onClick={onArmory}><span>Open armory</span><Arrow /></button>
              <button className="btn btn-ghost" onClick={onRedeploy}>Redeploy</button>
              <button className="btn btn-ghost" onClick={onMenu}>Return to base</button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" style={{ padding: '12px 20px' }} onClick={onRedeploy}><span>Redeploy</span><Arrow /></button>
              <button className="btn btn-ghost" onClick={onArmory}>Open armory</button>
              <button className="btn btn-ghost" onClick={onMenu}>Return to base</button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
