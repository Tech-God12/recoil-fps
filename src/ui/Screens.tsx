import { useCallback, useEffect, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import type { CashLogEntry, GameSettings, TdmHud } from '../game/engine';
import { weaponById } from '../game/economy/catalog';
import { DEFAULT_PROFILE, type PlayerProfile } from '../game/economy/profile';
import { MAPS, type MapId } from '../game/world';
import { getMission, type MissionReport } from '../game/systems/mission';
import type { MissionHud } from '../game/systems/mission-runtime';
import type { StreakHud } from '../game/streaks';
import type { KitHud } from '../game/kits';
import { KitEquipButton, KitIcon, KitPauseCard } from './Kits';
import { KIT_DEFS } from '../game/kits';
import type { PressureStats } from '../game/systems/reinforcements';
import { missionClock, objectiveReadout } from './MissionObjective';
import { CountUp } from './components';
import CashCounter from './armory/CashCounter';
import { gradeFor } from '../game/economy/rewards';
import { voice } from '../game/voice';
import mapAlrasul from '../assets/map-alrasul.jpg';
import mapKasbah from '../assets/map-kasbah.jpg';
import mapArena from '../assets/map-arena.jpg';
import operatorArt from '../assets/operator.jpg';
import menuCenter from '../assets/menu-center.jpg';
import { TxBack, TxCoords } from './tactical';
import MapFlyover from './MapFlyover';
import { gunThumbnail } from './armory/GunViewer';
import { weaponTexturesReady } from '../game/weapons/finish';
import type { TDMOutcome } from '../game/tdm';

export const MAP_ART: Record<MapId, string> = { alrasul: mapAlrasul, kasbah: mapKasbah, arena: mapArena };

/* Theater cards: Town and Sandblast, the two live story operations. */
const THEATERS: { num: string; code: string; id: MapId; type: string; art: string; lat: string; lon: string }[] = [
  { num: '01', code: 'TOWN', id: 'kasbah', type: 'FORTIFIED MARKET TOWN', art: mapKasbah, lat: '32.4567° N', lon: '44.8335° E' },
  { num: '02', code: 'SANDBLAST', id: 'alrasul', type: 'DESERT RIVER VALLEY', art: mapAlrasul, lat: '34.1975° N', lon: '41.4215° E' },
];

export interface Results {
  win: boolean; kills: number; score: number; shots: number; hits: number; headshots: number; timeSec: number;
  mission: MissionReport; pressure: PressureStats;
  cash: number; cashLog: CashLogEntry[]; difficultyMul: number;
  tdm?: {
    alphaScore: number; bravoScore: number; playerKills: number; outcome: TDMOutcome;
    roster: { name: string; team: 'alpha' | 'bravo'; dead: boolean; armorIcon: string; you?: boolean; kills: number; deaths: number; headshots: number }[];
  };
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

const PistolIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 8.5h13.5v3.6H11l-.8 5.4H7.4l.8-5.4H4.5v2.4H2z" />
    <path d="M15.5 8.5V12 M18.5 8.5h2.8v2.6h-2.8" />
  </svg>
);
const FragIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="9" y="2.5" width="6" height="3.4" rx="1" />
    <circle cx="16.6" cy="4.4" r="1.7" />
    <path d="M7 9.5h10V15a5 5 0 0 1-10 0z" />
    <path d="M7 12.5h10" />
  </svg>
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
function TacticalHome({ prof, primaryName, secondaryName, onSelect, onArmory, onSettings, onKits }: {
  prof: PlayerProfile; primaryName: string; secondaryName: string;
  onSelect: (view: 'maps' | 'arena') => void; onArmory: () => void; onSettings: () => void; onKits: () => void;
}) {
  const [sel, setSel] = useState(0);
  const [intel, setIntel] = useState(2);
  const [profileOpen, setProfileOpen] = useState(false);
  const [cashShown, setCashShown] = useState(0);
  const [thumbs, setThumbs] = useState<{ primary: string; secondary: string }>({ primary: '', secondary: '' });
  const primaryId = prof.loadout.primary.weapon;
  const secondaryId = prof.loadout.secondary.weapon;
  const rootRef = useRef<HTMLElement | null>(null);
  const cashTarget = prof.cash;
  const level = 13 + prof.missions;
  const phaseCount = getMission('kasbah').phases.length + getMission('alrasul').phases.length;
  const intelReadouts = [
    '1 OPERATOR · RECOIL_01',
    'DESERT VALLEY · GRID 39S',
    `2 ARENAS · ${phaseCount} PHASES`,
    prof.missions > 0 || prof.kills > 0 ? `${prof.missions} OPS · ${prof.kills} KILLS` : 'AWAITING DEPLOYMENT',
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

  // Whole-weapon renders for the loadout card — real 3D thumbnails, one per slot.
  useEffect(() => {
    let active = true;
    void weaponTexturesReady.then(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!active) return;
      setThumbs({ primary: gunThumbnail(primaryId), secondary: gunThumbnail(secondaryId) });
    });
    return () => { active = false; };
  }, [primaryId, secondaryId]);

  const items = [
    { id: 'missions', idx: '01', title: 'MISSIONS', sub: 'CHOOSE A BATTLEFIELD AND DEPLOY', action: () => onSelect('maps') },
    { id: 'arena', idx: '02', title: 'ARENA MODE', sub: '5V5 TEAM DEATHMATCH', action: () => onSelect('arena') },
    { id: 'kits', idx: '03', title: 'KITS', sub: prof.equippedKit ? `${KIT_DEFS[prof.equippedKit].name} EQUIPPED · ${KIT_DEFS[prof.equippedKit].ability.toUpperCase()}` : 'BUY AND EQUIP A FIELD ABILITY', action: onKits },
    { id: 'loadout', idx: '04', title: 'LOADOUT', sub: 'WEAPONS, ARMOR AND CUSTOMIZATION', action: onArmory },
    { id: 'settings', idx: '05', title: 'SETTINGS', sub: 'VIDEO, AUDIO AND CONTROLS', action: onSettings },
  ];
  const activate = useCallback((i: number) => { items[i]?.action(); }, [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab') { e.preventDefault(); setProfileOpen(o => !o); return; }
      if (e.code === 'Escape') { setProfileOpen(false); return; }
      if (profileOpen) return;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') { e.preventDefault(); setSel(s => (s + items.length - 1) % items.length); }
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') { e.preventDefault(); setSel(s => (s + 1) % items.length); }
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
            <span className="rm-kicker">DEPLOYMENT TERMINAL<br />V1.1.0</span>
            <h1 className="rm-title">RECOIL<sup>®</sup></h1>
            <span className="rm-subtitle">DESERT OPERATIONS&nbsp;&nbsp;•&nbsp;&nbsp;SINGLE OPERATOR</span>
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
                {it.id === 'kits' && (
                  <span className={`rm-kit-badge ${prof.equippedKit ? `kit-${prof.equippedKit}` : 'new'}`} aria-hidden="true">
                    {prof.equippedKit ? <KitIcon id={prof.equippedKit} size={16} /> : 'NEW'}
                  </span>
                )}
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
              <span className="rm-op-body"><em>OPERATOR</em><b>RECOIL_01</b><i>LVL {level}</i></span>
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

          <button type="button" className="rm-loadout seq" style={{ animationDelay: '.2s' }} onClick={onArmory} title="Open loadout">
            <span className="rm-lo-kicker">CURRENT LOADOUT</span>
            <span className="rm-lo-main">
              <span className="rm-lo-tag mono">PRIMARY</span>
              <b className="rm-lo-name">{primaryName}</b>
              {thumbs.primary
                ? <img src={thumbs.primary} alt="" draggable={false} className="rm-lo-gun" />
                : <span className="rm-lo-gun rm-lo-gun-loading" aria-hidden="true" />}
            </span>
            <span className="rm-lo-div" aria-hidden="true" />
            <span className="rm-lo-slots">
              <span className="rm-lo-slot">
                <span className="rm-lo-tag mono">SIDEARM</span>
                {thumbs.secondary
                  ? <img src={thumbs.secondary} alt="" draggable={false} className="rm-lo-gun sm" />
                  : <PistolIcon />}
                <em>{secondaryName}</em>
              </span>
              <span className="rm-lo-slot">
                <span className="rm-lo-tag mono">TACTICAL</span>
                <FragIcon />
                <em>FRAG ×2</em>
              </span>
            </span>
            <span className="rm-lo-foot"><em>EDIT IN ARMORY</em><Arrow /></span>
          </button>
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
        <span className="rm-foot-right">V1.1.0&nbsp;&nbsp;//&nbsp;&nbsp;FIELD BUILD</span>
      </footer>

      {profileOpen && (
        <div className="rm-profile-scrim" onClick={() => setProfileOpen(false)}>
          <aside className="rm-profile" role="dialog" aria-label="Player profile" onClick={e => e.stopPropagation()}>
            <div className="rm-profile-head">
              <span>OPERATOR FILE</span>
              <button type="button" onClick={() => setProfileOpen(false)} aria-label="Close profile">✕</button>
            </div>
            <div className="rm-profile-callsign">RECOIL_01</div>
            <div className="rm-profile-lvl">LVL {level} · DESERT OPERATIONS</div>
            <div className="rm-profile-rows">
              <div><span>MISSIONS</span><b className="tabular">{prof.missions}</b></div>
              <div><span>ELIMINATIONS</span><b className="tabular">{prof.kills}</b></div>
              <div><span>WALLET</span><b className="tabular">${prof.cash.toLocaleString('en-US')}</b></div>
              <div><span>PRIMARY</span><b>{primaryName}</b></div>
              <div><span>SECONDARY</span><b>{secondaryName}</b></div>
            </div>
            <div className="rm-profile-foot">TAB / ESC — CLOSE</div>
          </aside>
        </div>
      )}
    </main>
  );
}

/* ================================================================
   ARENA MODE — hovering the Warehouse card turns the whole screen into
   a live 3D orbit of the arena (same MapFlyover tech as theater select).
   ================================================================ */
function ArenaView({ primaryName, secondaryName, onBack, onMap, onDeploy, onArenaSetup }: {
  primaryName: string; secondaryName: string;
  onBack: () => void; onMap: (map: GameSettings['map']) => void;
  onDeploy: (map?: GameSettings['map']) => void; onArenaSetup?: () => void;
}) {
  const [live, setLive] = useState(false);
  return (
    <main className="tx-root arena2-root">
      <div className="map2-base" aria-hidden="true" />
      <div className={`map2-flyover ${live ? 'live' : ''}`} aria-hidden="true">
        <div className="map2-flyover-slot" style={{ opacity: live ? 1 : 0 }}>
          <MapFlyover mapId="arena" active={live} />
        </div>
      </div>
      <div className="tx-grain" aria-hidden="true" />

      <header className="map2-head seq" style={{ animationDelay: '.02s' }}>
        <TxBack onClick={onBack} />
        <div className="map2-titleblock">
          <span className="map2-kicker">ARENA MODE<br />TEAM DEATHMATCH</span>
          <h1 className="map2-title">WAREHOUSE</h1>
          <span className="map2-sub">5V5 · 2:30 MATCH · 5S RESPAWN</span>
          <i className="tx-rule" aria-hidden="true" />
        </div>
        <TxCoords lat="33.7731° N" lon="44.4208° E" />
        <div className="map2-brand">
          <b>RECOIL</b>
          <em>{primaryName}&nbsp;&nbsp;//&nbsp;&nbsp;{secondaryName}</em>
        </div>
      </header>

      <div className="arena2-cards" role="listbox" aria-label="Choose an arena">
        <button
          type="button"
          role="option"
          aria-selected={live}
          className={`map2-card seq ${live ? 'sel' : ''}`}
          style={{ animationDelay: '.08s' }}
          onMouseEnter={() => setLive(true)}
          onMouseLeave={() => setLive(false)}
          onFocus={() => setLive(true)}
          onBlur={() => setLive(false)}
          onClick={() => { onMap('arena'); onDeploy('arena'); }}
          aria-label="Warehouse arena, deploy"
        >
          <img src={MAP_ART.arena} alt="" draggable={false} className="map2-art" />
          <span className="map2-shade" aria-hidden="true" />
          <span className="map2-num mono">01</span>
          <span className="map2-info">
            <b>WAREHOUSE</b>
            <em>CONTAINER YARD · TWIN HALLS</em>
            <span className="map2-obj mono">5V5 · 2:30 · 5S RESPAWN</span>
          </span>
          <span className="map2-go"><Arrow /></span>
        </button>
      </div>
      <p className="map2-hint mono" role="status">
        HOVER WAREHOUSE FOR A LIVE FLYOVER · CLICK TO PLAY
      </p>

      <div className="arena2-cta seq" style={{ animationDelay: '.2s' }}>
        <button className="deploy-btn" onClick={() => { onMap('arena'); onDeploy('arena'); }}>
          <span>Play</span>
          <span className="hint">Warehouse · 5v5 TDM</span>
          <Arrow />
        </button>
        <button className="menu-secondary-btn" onClick={() => { onMap('arena'); onArenaSetup?.(); }}>
          Set up loadout <span>armor + weapon</span>
        </button>
      </div>

      <footer className="map2-foot mono">
        <span>ALPHA 5&nbsp;&nbsp;//&nbsp;&nbsp;BRAVO 5</span>
        <span className="map2-foot-right">V1.1.0&nbsp;&nbsp;//&nbsp;&nbsp;FIELD BUILD</span>
      </footer>
    </main>
  );
}

/* ================================================================
   MAIN MENU — three screens:
   HOME     · title left, stacked menu (Missions / Arena / Loadout / Settings),
              operator character art on the right.
   MAPS     · pick the AO — hovering a tile turns the WHOLE screen into a
              live 3D orbit of that arena.
   MISSIONS · the selected map's operation with its objective card list,
              then Deploy → loading screen → straight into the game.
   ================================================================ */
const PHASE_VERB: Record<string, string> = {
  advance: 'Advance', clear: 'Clear', destroy: 'Destroy', hold: 'Hold', defend: 'Defend', extract: 'Extract',
};

export function MainMenu({ s, onDeploy, onSettings, onMap, onArmory, onArenaSetup, initialView, profile, onKits }: {
  s: GameSettings; onDeploy: (map?: GameSettings['map']) => void; onSettings: () => void; onMap: (map: GameSettings['map']) => void;
  onArmory?: () => void; onArenaSetup?: () => void; initialView?: 'home' | 'arena'; profile?: PlayerProfile;
  /** Opens the KITS menu (home tile and the missions deploy panel). */
  onKits?: () => void;
}) {
  const prof = profile ?? DEFAULT_PROFILE;
  const primaryName = weaponById(prof.loadout.primary.weapon)?.short ?? '—';
  const secondaryName = weaponById(prof.loadout.secondary.weapon)?.short ?? '—';
  const [view, setView] = useState<'home' | 'maps' | 'missions' | 'arena'>(initialView ?? 'home');
  const [hovered, setHovered] = useState<MapId | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIdxRef = useRef(0);
  // Theater keyboard: arrows/A-D hop between cards (focus drives the live
  // overview), native Enter/Space on the focused card deploys to its operation.
  useEffect(() => {
    if (view !== 'maps') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        focusIdxRef.current = (focusIdxRef.current + 1) % THEATERS.length;
        cardRefs.current[focusIdxRef.current]?.focus();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        focusIdxRef.current = (focusIdxRef.current + THEATERS.length - 1) % THEATERS.length;
        cardRefs.current[focusIdxRef.current]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);
  // Missions cover the story maps only — the arena lives under Arena Mode.
  const mapOrder = MAPS.filter(m => m.id !== 'arena').sort(a => (a.id === 'kasbah' ? -1 : 1));

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
        onKits={() => onKits?.()}
      />
    );
  }

  /* ---------------- MAPS — THEATER SELECT ---------------- */
  if (view === 'maps') {
    const activateTheater = (index: number) => {
      const t = THEATERS[index];
      onMap(t.id);
      setHovered(null);
      setView('missions');
    };
    const preview = (index: number, on: boolean) => {
      const t = THEATERS[index];
      setHovered(on ? t.id : cur => (cur === t.id ? null : cur));
    };
    return (
      <main className="tx-root map2-root">
        <div className="map2-base" aria-hidden="true" />
        {/* Hovering a live theater takes over the screen with a 3D orbit. */}
        <div className={`map2-flyover ${hovered ? 'live' : ''}`} aria-hidden="true">
          {mapOrder.map(map => (
            <div key={map.id} className="map2-flyover-slot" style={{ opacity: hovered === map.id ? 1 : 0 }}>
              <MapFlyover mapId={map.id} active={hovered === map.id} />
            </div>
          ))}
        </div>
        <div className="tx-grain" aria-hidden="true" />

        <header className="map2-head seq" style={{ animationDelay: '.02s' }}>
          <TxBack onClick={() => setView('home')} />
          <div className="map2-titleblock">
            <span className="map2-kicker">OPERATIONS COMMAND<br />THEATER SELECT</span>
            <h1 className="map2-title">SELECT AREA OF OPERATIONS</h1>
            <span className="map2-sub">DEPLOY TO A THEATER.</span>
            <i className="tx-rule" aria-hidden="true" />
          </div>
          <TxCoords lat="33.7731° N" lon="44.4208° E" />
          <div className="map2-brand">
            <b>RECOIL</b>
            <em>DESERT OPERATIONS&nbsp;&nbsp;//&nbsp;&nbsp;GLOBAL REACH</em>
            <div className="map2-intel" aria-hidden="true">
              <span>PEOPLE</span><span>TERRAIN</span><span>OBJECTIVES</span><span>RESULTS</span>
            </div>
          </div>
        </header>

        <div className="map2-cards" role="listbox" aria-label="Choose a theater">
          {THEATERS.map((t, i) => {
            const obj = getMission(t.id).phases.length;
            const isLive = hovered === t.id;
            return (
              <button
                key={t.code}
                ref={node => { cardRefs.current[i] = node; }}
                type="button"
                role="option"
                aria-selected={isLive}
                disabled={false}
                onClick={() => activateTheater(i)}
                onMouseEnter={() => preview(i, true)}
                onMouseLeave={() => preview(i, false)}
                onFocus={() => { focusIdxRef.current = i; preview(i, true); }}
                onBlur={() => preview(i, false)}
                className={`map2-card seq ${isLive ? 'sel' : ''}`}
                style={{ animationDelay: `${0.08 + i * 0.06}s` }}
                aria-label={`${t.code} theater, ${obj} objectives`}
              >
                <img src={t.art} alt="" draggable={false} className="map2-art" />
                <span className="map2-shade" aria-hidden="true" />
                <span className="map2-num mono">{t.num}</span>
                <span className="map2-cardcoords mono">{t.lat}<br />{t.lon}</span>
                <span className="map2-info">
                  <b>{t.code}</b>
                  <em>{t.type}</em>
                  <span className="map2-obj mono">{`${obj} OBJECTIVES · ${t.code}`}</span>
                </span>
                <span className="map2-go"><Arrow /></span>
              </button>
            );
          })}
        </div>
        <p className="map2-hint mono" role="status">
          HOVER A THEATER FOR A LIVE OVERVIEW · CLICK TO VIEW ITS OPERATION
        </p>

        <div className="map2-features seq" style={{ animationDelay: '.26s' }}>
          <div className="map2-feat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c-5.5 5-5.5 12 0 17M12 3.5c5.5 5 5.5 12 0 17" /></svg>
            <span><b>TWO THEATERS</b><em>UNIQUE ENVIRONMENTS</em></span>
          </div>
          <div className="map2-feat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8" r="3" /><circle cx="16" cy="9.5" r="2.4" /><path d="M3 20c0-3.3 2.5-5.5 5.5-5.5S14 16.7 14 20M15 14.7c2.8.2 5 2.2 5 5.3" /></svg>
            <span><b>DIFFERENT THREATS</b><em>REAL OPERATIONS</em></span>
          </div>
          <div className="map2-feat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" strokeLinejoin="round"><path d="M3 19L10 6l4 7 2.5-4L21 19z" /><path d="M10 6l-2 3.5M12.5 13L11 15.5" /></svg>
            <span><b>PROVE YOURSELF</b><em>COMPLETE ALL OBJECTIVES</em></span>
          </div>
        </div>

        <footer className="map2-foot mono">
          <span>RECOIL&nbsp;&nbsp;//&nbsp;&nbsp;FIELD NOTES&nbsp;&nbsp;//&nbsp;&nbsp;SURVIVE ADAPT WIN</span>
          <span className="map2-foot-right">V1.1.0&nbsp;&nbsp;//&nbsp;&nbsp;FIELD BUILD</span>
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
      />
    );
  }

  /* ---------------- MISSIONS ---------------- */
  const mapName = MAPS.find(m => m.id === s.map)?.name ?? '';
  const mission = getMission(s.map === 'arena' ? 'alrasul' : s.map);
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
          <KitEquipButton kit={prof.equippedKit} onOpen={onKits} />
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
  'Press Z for your field kit: sonar dart, barricade or holo-decoy.',
];

export function BootScreen({ map }: { map?: MapId }) {
  const [tipIndex, setTipIndex] = useState(0);
  const isTdm = map === 'arena';
  const mission = isTdm ? null : getMission(map ?? 'alrasul');
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
      voice.briefing('Warehouse arena. Five on five, two minutes thirty on the clock. Most eliminations wins. Five second redeploy. Watch the container lanes and fight for the twin halls. Good luck, operator.');
      return;
    }
    const first = mission.phases[0];
    const narration = `Operation ${mission.name}. ${mission.brief} First objective: ${first.title.toLowerCase()}, at the ${first.location.toLowerCase()}. ${mission.phases.length} objectives stand between you and extraction. Good luck, operator.`;
    voice.briefing(narration);
    // No cancel on unmount: builds are fast, so the narration is allowed to
    // finish over the first seconds in-game (mission radio interrupts it anyway).
  }, [mission]);
  return (
    <div className="boot-root boot-cine" aria-busy="true">
      <div className="boot-cine-art" style={{ backgroundImage: `url(${MAP_ART[map ?? 'alrasul']})` }} aria-hidden="true" />
      <div className="boot-cine-shade" aria-hidden="true" />
      <div className="boot-cine-grid" aria-hidden="true" />

      <div className="boot-cine-top">
        <span className="boot-kicker">Insertion — {mapName}</span>
        <h2 className="boot-cine-title">{mission ? `Operation ${mission.name}` : 'Warehouse TDM'}</h2>
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
            <span>{mission ? `${mission.phases[0].title} · ${mission.phases[0].location}` : '5v5 · 2:30 · most kills wins'}</span>
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

export function PauseMenu({ mission, streaks, kit, tdm, mapName, onResume, onRestart, onSettings, onQuit }: {
  mission?: MissionHud; streaks?: StreakHud; kit?: KitHud; tdm?: TdmHud; mapName?: string;
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
    { id: 'quit', label: armed === 'quit' ? 'Confirm quit' : 'Quit to menu', sub: armed === 'quit' ? 'Ends the game · change kits in KITS' : 'End the game', run: () => (armed === 'quit' ? onQuit() : setArmed('quit')) },
  ];
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { btns.current[0]?.focus(); }, []);
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
            <div className="pz-panel-head mono"><span>FIELD KIT</span><span>{kit ? <span className="keycap">{kit.key}</span> : 'NONE'}</span></div>
            <KitPauseCard kit={kit} />
          </div>

          {streaks && (
            <div className="pz-panel pz-streaks" style={{ animationDelay: '200ms' }} aria-label="Scorestreaks">
              <div className="pz-panel-head mono"><span>SCORESTREAKS</span><span className="tabular">{streaks.points} PTS THIS LIFE</span></div>
              <div className="pz-streak-grid">
                {streaks.ladder.map(l => (
                  <div key={l.id} className={`pz-streak ${l.ready ? 'ready' : ''} ${l.active ? 'live' : ''} ${l.claimed && !l.ready ? 'used' : ''}`}>
                    <span className="keycap">{l.key}</span>
                    <b>{l.name}</b>
                    <span className="pz-streak-cost tabular">{l.cost}</span>
                    <i style={{ width: `${Math.min(100, Math.round(streaks.points / l.cost * 100))}%` }} />
                  </div>
                ))}
              </div>
              <p className="pz-foot">Kills 100 · headshots 150 · objectives 250. Progress resets on death; armed streaks are kept.</p>
            </div>
          )}
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
  streak: 'Streak bonuses', shutdown: 'Momentum stopped', draw: 'Match draw', phase: 'Phases secured', extraction: 'Extraction',
};

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
  return (
    <main className={`results-root ${isDraw ? 'draw' : hasWon ? '' : 'lose'}`}>
      <div className="results-wrap">
        <div className="results-header">
          <div className="stamp"><span className="stamp-grade" style={{ color: isDraw ? '#C9A15A' : tint }}>{isDraw ? '=' : grade}</span></div>
          <div className="results-titleblock">
            <div className="stamp-label">{isDraw ? 'Match draw' : `Grade ${grade}`}</div>
            <h2 className="results-title">{tdm
              ? (tdm.outcome === 'draw' ? 'Draw' : tdm.outcome === 'win' ? 'Victory — Alpha squad' : 'Defeat — Bravo squad')
              : (r.win ? 'Extraction complete' : 'Mission failed')}</h2>
            <p className="results-sub">{tdm
              ? `Warehouse TDM — final score ALPHA ${tdm.alphaScore} : ${tdm.bravoScore} BRAVO. You dropped ${tdm.playerKills} of Alpha's ${tdm.alphaScore}.`
              : `${r.mission.name} — ${r.win
                ? 'You completed the operation and reached the pickup.'
                : `Operation ended during ${r.mission.phases.find(p => !p.complete)?.title.toLowerCase() ?? 'extraction'}.`}`}</p>
          </div>
        </div>
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
          {!tdm && (
            <div className="stat-cell">
              <span className="stat-label">Objectives</span>
              <div className="stat-value tabular"><CountUp to={completed} /><small> / {r.mission.phases.length}</small></div>
            </div>
          )}
          <div className="stat-cell">
            <span className="stat-label">{tdm ? 'Match time' : 'Mission time'}</span>
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

        {!tdm && <section className="timeline" aria-label="Mission timeline">
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
          {tdm
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
