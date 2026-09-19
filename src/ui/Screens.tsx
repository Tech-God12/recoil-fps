import { useEffect, useState } from 'react';
import type { CashLogEntry, GameSettings } from '../game/engine';
import { weaponById } from '../game/economy/catalog';
import { DEFAULT_PROFILE, type PlayerProfile } from '../game/economy/profile';
import { MAPS, type MapId } from '../game/world';
import { getMission, type MissionReport } from '../game/systems/mission';
import type { MissionHud } from '../game/systems/mission-runtime';
import type { PressureStats } from '../game/systems/reinforcements';
import { missionClock, objectiveReadout } from './MissionObjective';
import { CountUp } from './components';
import CashCounter from './armory/CashCounter';
import { gradeFor } from '../game/economy/rewards';
import { voice } from '../game/voice';
import mapAlrasul from '../assets/map-alrasul.jpg';
import mapKasbah from '../assets/map-kasbah.jpg';
import operatorArt from '../assets/operator.jpg';
import MapFlyover from './MapFlyover';

export const MAP_ART: Record<MapId, string> = { alrasul: mapAlrasul, kasbah: mapKasbah };

export interface Results {
  win: boolean; kills: number; score: number; shots: number; hits: number; headshots: number; timeSec: number;
  mission: MissionReport; pressure: PressureStats;
  cash: number; cashLog: CashLogEntry[]; difficultyMul: number;
}

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="square" /></svg>
);

/* ================================================================
   MAIN MENU — three screens:
   HOME     · title left, stacked menu (Missions / Loadout / Settings),
              operator character art on the right.
   MAPS     · pick the AO — hovering a tile turns the WHOLE screen into a
              live 3D orbit of that arena.
   MISSIONS · the selected map's operation with its objective card list,
              then Deploy → loading screen → straight into the game.
   ================================================================ */
const PHASE_VERB: Record<string, string> = {
  advance: 'Advance', clear: 'Clear', destroy: 'Destroy', hold: 'Hold', defend: 'Defend', extract: 'Extract',
};


type OpsIconName = 'home' | 'mission' | 'rifle' | 'settings' | 'expand' | 'arrow' | 'chevron' | 'play';

function OpsIcon({ name, size = 17 }: { name: OpsIconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const, 'aria-hidden': true };
  if (name === 'home') return <svg {...common}><path d="M3.5 10.7 12 3.8l8.5 6.9v8.8a1 1 0 0 1-1 1h-5v-5.6h-5v5.6h-5a1 1 0 0 1-1-1z" /><path d="M8.4 7.8h7.2" /></svg>;
  if (name === 'mission') return <svg {...common}><circle cx="12" cy="12" r="7.7" /><circle cx="12" cy="12" r="2.1" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M17.5 6.5l2-2M4.5 19.5l2-2" /></svg>;
  if (name === 'rifle') return <svg {...common}><path d="m3 8 8.4 1.4 5.7-2.8 2.4 1.4-3.8 3.2 3.1 2.3-1.5 2-4.5-3-5.2 1.1-2.2-1.8 3.6-2.1L3 8Z" /><path d="m5.5 13.6-1.9 4.1M10.8 13.3l-1.1 5.1M18.1 8l2-2.2" /></svg>;
  if (name === 'settings') return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 1.3 1.3-2.1 2.1-1.3-1.3a8 8 0 0 1-2.1.9v1.8h-3v-1.8a8 8 0 0 1-2.1-.9l-1.3 1.3-2.1-2.1L8 15a8 8 0 0 1-.9-2.1H5.3v-3h1.8A8 8 0 0 1 8 7.8L6.7 6.5l2.1-2.1 1.3 1.3a8 8 0 0 1 2.1-.9V3h3v1.8a8 8 0 0 1 2.1.9l1.3-1.3 2.1 2.1-1.3 1.3a8 8 0 0 1 .9 2.1h1.8v3h-1.8a8 8 0 0 1-.9 2.1Z" /></svg>;
  if (name === 'expand') return <svg {...common}><path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6" /></svg>;
  if (name === 'arrow') return <svg {...common}><path d="M4 12h15M13 6l6 6-6 6" /></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m7 9 5 5 5-5" /></svg>;
  return <svg {...common}><path d="m8 5 8 7-8 7V5Z" fill="currentColor" stroke="none" /></svg>;
}

export function MainMenu({ s, onDeploy, onSettings, onMap, onArmory, onFullscreen: requestFullscreen, profile }: {
  s: GameSettings; onDeploy: () => void; onSettings: () => void; onMap: (map: GameSettings['map']) => void;
  onArmory?: () => void; onFullscreen?: () => void; profile?: PlayerProfile;
}) {
  const prof = profile ?? DEFAULT_PROFILE;
  const onFullscreen = requestFullscreen ?? (() => undefined);
  const primaryName = weaponById(prof.loadout.primary.weapon)?.short ?? '—';
  const secondaryName = weaponById(prof.loadout.secondary.weapon)?.short ?? '—';
  const [view, setView] = useState<'home' | 'maps' | 'missions'>('home');
  const [hovered, setHovered] = useState<MapId | null>(null);
  const homeMission = getMission(s.map);
  // The tile order follows the sketch: Town first, then Sandblast.
  const mapOrder = [...MAPS].sort(a => (a.id === 'kasbah' ? -1 : 1));

  /* ---------------- HOME ---------------- */
  if (view === 'home') {
    const selectedMap = MAPS.find(map => map.id === s.map) ?? MAPS[0];
    const alternateMap = s.map === 'alrasul' ? 'kasbah' : 'alrasul';
    return (
      <main className="menu-root ops-home">
        <div className="ops-home-backdrop" style={{ backgroundImage: `url(${MAP_ART[s.map]})` }} aria-hidden="true" />
        <div className="ops-home-light" aria-hidden="true" />
        <div className="ops-home-grid" aria-hidden="true" />
        <div className="paper-grain" aria-hidden="true" />

        <header className="ops-topbar">
          <div className="ops-brand-lockup">
            <span className="ops-wordmark">RECOIL</span>
            <span className="ops-brand-rule" aria-hidden="true" />
            <span className="ops-brand-copy">TACTICAL REALISM<br /><b>GLOBAL OPERATIONS</b></span>
          </div>
          <div className="ops-network"><span className="ops-status-dot" /> FIELD NETWORK <b>ONLINE</b></div>
          <div className="ops-top-actions">
            <div className="ops-cash"><span className="ops-coin">◆</span><span>${prof.cash.toLocaleString('en-US')}</span></div>
            <button className="ops-profile" type="button" aria-label="Open operator profile">
              <span className="ops-avatar"><img src={operatorArt} alt="" draggable={false} /></span>
              <span className="ops-profile-copy"><b>OPERATOR</b><em>LEVEL 12</em></span>
              <OpsIcon name="chevron" size={13} />
            </button>
            <button className="ops-utility" type="button" onClick={onFullscreen} title="Toggle fullscreen" aria-label="Toggle fullscreen"><OpsIcon name="expand" size={15} /></button>
            <button className="ops-utility" type="button" onClick={onSettings} title="Open settings" aria-label="Open settings"><OpsIcon name="settings" size={15} /></button>
          </div>
        </header>

        <div className="ops-layout">
          <aside className="ops-rail">
            <nav className="ops-rail-nav" aria-label="Main menu">
              <button type="button" className="ops-rail-item is-active" onClick={() => setView('home')} aria-current="page">
                <OpsIcon name="home" /> <span>Home</span>
              </button>
              <button type="button" className="ops-rail-item" onClick={() => setView('maps')}>
                <OpsIcon name="mission" /> <span>Missions</span>
              </button>
              <button type="button" className="ops-rail-item" onClick={onArmory}>
                <OpsIcon name="rifle" /> <span>Loadout</span>
              </button>
              <button type="button" className="ops-rail-item" onClick={onSettings}>
                <OpsIcon name="settings" /> <span>Settings</span>
              </button>
            </nav>
            <div className="ops-rail-motto"><span>PLAY</span><b>PREPARE</b><b>ADAPT</b><b>REPEAT</b></div>
          </aside>

          <section className="ops-workspace">
            <div className="ops-workspace-main">
              <div className="ops-hero">
                <div className="ops-eyebrow"><span /> SINGLE OPERATOR <i>·</i> {selectedMap.name.toUpperCase()} SECTOR</div>
                <h1>PREPARE<br /><span>FOR WHAT'S NEXT</span></h1>
                <div className="ops-hero-meta"><span>DEPLOY</span><i>•</i><span>CUSTOMIZE</span><i>•</i><span>STAY READY</span></div>
              </div>

              <div className="ops-console-head">
                <span><b>01</b> OPERATIONS CONSOLE</span>
                <span className="ops-console-status"><i /> LINK STABLE</span>
              </div>

              <div className="ops-card-grid">
                <button type="button" className="ops-card ops-card-missions" style={{ backgroundImage: `url(${MAP_ART[s.map]})` }} onClick={() => setView('maps')}>
                  <span className="ops-card-shade" aria-hidden="true" />
                  <span className="ops-card-top"><span>01 <i>—</i></span><span className="ops-card-arrow"><OpsIcon name="arrow" size={15} /></span></span>
                  <span className="ops-card-content"><b>MISSIONS</b><em>Choose your battlefield<br />and deploy</em><small><strong>{MAPS.length}</strong> AREAS OF OPERATIONS <i /> <strong>{homeMission.phases.length}</strong> OBJECTIVES</small></span>
                </button>
                <button type="button" className="ops-card ops-card-loadout" style={{ backgroundImage: `url(${operatorArt})` }} onClick={onArmory}>
                  <span className="ops-card-shade" aria-hidden="true" />
                  <span className="ops-card-top"><span>02 <i>—</i></span><span className="ops-card-arrow"><OpsIcon name="arrow" size={15} /></span></span>
                  <span className="ops-card-content"><b>LOADOUT</b><em>{primaryName} + {secondaryName}<br />and gear</em><small><strong>7</strong> PRIMARY WEAPONS <i /> <strong>40+</strong> ATTACHMENTS</small></span>
                </button>
                <button type="button" className="ops-card ops-card-settings" style={{ backgroundImage: `url(${MAP_ART[alternateMap]})` }} onClick={onSettings}>
                  <span className="ops-card-shade" aria-hidden="true" />
                  <span className="ops-card-top"><span>03 <i>—</i></span><span className="ops-card-arrow"><OpsIcon name="arrow" size={15} /></span></span>
                  <span className="ops-card-content"><b>SETTINGS</b><em>Video, audio and controls<br />for your operation</em><small><strong>READY</strong> OPTIMIZE YOUR EXPERIENCE</small></span>
                </button>
              </div>
            </div>

            <aside className="ops-operator-panel">
              <div className="ops-operator-head"><span>OPERATOR</span><b><i /> ACTIVE</b></div>
              <div className="ops-operator-copy">SAME PEOPLE<br />DIFFERENT<br />BATTLEGROUNDS</div>
              <div className="ops-operator-art"><img src={operatorArt} alt="Operator equipped with rifle" draggable={false} /></div>
              <div className="ops-operator-glass" aria-hidden="true" />
              <div className="ops-operator-bottom"><span>OPERATOR 01<small>FIELD READY</small></span><span>VER. 1.0.0</span></div>
            </aside>
          </section>
        </div>

        <footer className="ops-footer">
          <span><kbd>ESC</kbd> QUIT TO DESKTOP</span>
          <span className="ops-footer-center"><b>{s.difficulty.toUpperCase()}</b> DIFFICULTY <i /> UNLIMITED AMMO <i /> {profile?.missions ?? 0} MISSIONS COMPLETE</span>
          <span className="ops-controls"><kbd>WASD</kbd> NAVIGATE <kbd>ENTER</kbd> SELECT <kbd>TAB</kbd> OPTIONS</span>
        </footer>
      </main>
    );
  }

  /* ---------------- MAPS ---------------- */
  if (view === 'maps') {
    return (
      <main className="menu-root pick-root">
        <div className="menu-bg" aria-hidden="true" />
        {/* Hovering a map takes over the ENTIRE screen with a live 3D orbit. */}
        <div className={`pick-flyover ${hovered ? 'live' : ''}`} aria-hidden="true">
          {MAPS.map(map => (
            <div key={map.id} className="pick-flyover-slot" style={{ opacity: hovered === map.id ? 1 : 0 }}>
              <MapFlyover mapId={map.id} active={hovered === map.id} />
            </div>
          ))}
        </div>
        <div className="paper-grain" aria-hidden="true" />

        <header className="menu-header">
          <button className="cmd-back" onClick={() => setView('home')}><span aria-hidden="true">‹</span> Back</button>
          <span className="pick-heading">
            <span className="menu-eyebrow">Missions</span>
            <b>Select area of operations</b>
          </span>
          <span className="menu-header-actions">
            <span className="menu-loadout" aria-label="Equipped loadout">
              <span><b>1</b> {primaryName}</span>
              <span><b>2</b> {secondaryName}</span>
            </span>
            <button className="ops-utility" type="button" onClick={onFullscreen} title="Toggle fullscreen" aria-label="Toggle fullscreen"><OpsIcon name="expand" size={14} /></button>
          </span>
        </header>

        <div className={`pick-tiles ${hovered ? 'dimmed' : ''}`} role="radiogroup" aria-label="Choose a map">
          {mapOrder.map((map, index) => {
            const opt = getMission(map.id);
            return (
              <button
                key={map.id}
                onClick={() => { onMap(map.id); setHovered(null); setView('missions'); }}
                onMouseEnter={() => setHovered(map.id)}
                onMouseLeave={() => setHovered(cur => (cur === map.id ? null : cur))}
                className={`map-tile ${hovered === map.id ? 'selected' : ''}`}
              >
                <img src={MAP_ART[map.id]} alt="" draggable={false} className="map-tile-art" />
                <span className="map-tile-shade" aria-hidden="true" />
                <span className="map-tile-info">
                  <span className="map-tile-num">0{index + 1}</span>
                  <span className="map-tile-name">{map.name}</span>
                  <span className="map-tile-type">{map.id === 'alrasul' ? 'Desert river valley' : 'Fortified market town'}</span>
                  <span className="map-tile-tag">{opt.phases.length} objectives · {opt.name}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="pick-hint mono">Hover a sector for a live overview · click to view missions</p>
      </main>
    );
  }

  /* ---------------- MISSIONS ---------------- */
  const mission = getMission(s.map);
  const mapName = MAPS.find(m => m.id === s.map)?.name ?? '';
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
        <span className="menu-header-actions">
          <span className="menu-loadout" aria-label="Equipped loadout">
            <span><b>1</b> {primaryName}</span>
            <span><b>2</b> {secondaryName}</span>
          </span>
          <button className="ops-utility" type="button" onClick={onFullscreen} title="Toggle fullscreen" aria-label="Toggle fullscreen"><OpsIcon name="expand" size={14} /></button>
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
          <button className="deploy-btn" onClick={onDeploy}>
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
const BOOT_LINES = [
  'Uplink handshake',
  'Grid sync — satellites 3/3',
  'Zeroing optics',
  'Loading ballistics tables',
  'Arming weapons',
  'Insertion corridor clear',
];

export function BootScreen({ map }: { map?: MapId }) {
  const [line, setLine] = useState(0);
  const [pct, setPct] = useState(0);
  const mission = getMission(map ?? 'alrasul');
  const mapName = MAPS.find(m => m.id === (map ?? 'alrasul'))?.name ?? '';
  useEffect(() => {
    const l = window.setInterval(() => setLine(i => Math.min(BOOT_LINES.length - 1, i + 1)), 700);
    const p = window.setInterval(() => setPct(v => Math.min(94, v + 2 + Math.floor(Math.random() * 5))), 125);
    return () => { window.clearInterval(l); window.clearInterval(p); };
  }, []);
  // Voiceover: brief the operator while the world builds. The Deploy click is the
  // user gesture, so speech is already unlocked when this mounts.
  useEffect(() => {
    voice.unlock();
    const first = mission.phases[0];
    const narration = `Operation ${mission.name}. ${mission.brief} First objective: ${first.title.toLowerCase()}, at the ${first.location.toLowerCase()}. ${mission.phases.length} objectives stand between you and extraction. Good luck, operator.`;
    voice.briefing(narration);
    // No cancel on unmount: builds are fast, so the narration is allowed to
    // finish over the first seconds in-game (mission radio interrupts it anyway).
  }, [mission]);
  return (
    <div className="boot-root boot-cine" role="status" aria-live="polite">
      <div className="boot-cine-art" style={{ backgroundImage: `url(${MAP_ART[map ?? 'alrasul']})` }} aria-hidden="true" />
      <div className="boot-cine-shade" aria-hidden="true" />
      <div className="boot-cine-grid" aria-hidden="true" />

      <div className="boot-cine-top">
        <span className="boot-kicker">Insertion — {mapName}</span>
        <h2 className="boot-cine-title">Operation {mission.name}</h2>
      </div>

      <div className="boot-cine-bottom">
        <div className="boot-feed mono" aria-hidden="true">
          {BOOT_LINES.slice(0, line + 1).map((l, i) => (
            <span key={l} className={i === line ? 'cur' : ''}>▸ {l}</span>
          ))}
        </div>
        <div className="boot-cine-railwrap">
          <div className="boot-bar" aria-hidden="true"><span className="boot-bar__fill" style={{ width: `${pct}%` }} /></div>
          <div className="boot-cine-railmeta mono">
            <span>{mission.phases[0].title} · {mission.phases[0].location}</span>
            <span className="tabular">{String(pct).padStart(3, '0')}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   PAUSE — SUSPENDED
   ================================================================ */
export function PauseMenu({ mission, onResume, onRestart, onSettings, onQuit }: {
  mission?: MissionHud; onResume: () => void; onRestart: () => void; onSettings: () => void; onQuit: () => void;
}) {
  const readout = mission ? objectiveReadout(mission) : undefined;
  return (
    <section className="pause-layer" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="pause-wrap anim-rise">
        <div className="pause-left">
          <span className="stencil">System pause</span>
          <h2 id="pause-title" className="pause-title">Paused</h2>
          <div className="pause-actions">
            <button className="pause-action pause-action-primary" onClick={onResume}><span>Resume</span><span className="idx">01</span></button>
            <button className="pause-action" onClick={onSettings}><span>Settings</span><span className="idx">02</span></button>
            <button className="pause-action" onClick={onRestart}><span>Restart</span><span className="idx">03</span></button>
            <button className="pause-action" onClick={onQuit}><span>Quit to menu</span><span className="idx">04</span></button>
          </div>
          <p className="pause-hint"><span className="keycap">Esc</span> Resume anytime</p>
        </div>

        <div className="pause-card">
          <div className="pause-card-head">
            <span>Operation <b>{mission?.name ?? 'Ready'}</b></span>
            <span className="pause-clock tabular">{mission ? missionClock(mission.elapsed) : '00:00'}</span>
          </div>
          <span className="pause-phase">Phase {mission ? `0${mission.index + 1} / 0${mission.phaseCount}` : '—'}</span>
          <h3>{mission?.title ?? 'Ready to deploy'}</h3>
          <p>{mission?.brief ?? 'Select resume to continue.'}</p>
          <div className="pause-progress"><span style={{ width: `${Math.round((mission?.progress ?? 0) * 100)}%` }} /></div>
          {readout && (
            <div className="pause-readout">
              <strong className="tabular">{readout.value}</strong>
              <span>{readout.label}</span>
            </div>
          )}
          <p className="pause-note">All mission timers frozen</p>
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
  streak: 'Streak bonuses', phase: 'Phases secured', extraction: 'Extraction',
};

export function ResultsScreen({ r, wallet, onRedeploy, onMenu, onArmory }: {
  r: Results; wallet: ResultsWallet; onRedeploy: () => void; onMenu: () => void; onArmory: () => void;
}) {
  const accuracy = r.shots ? Math.round(r.hits / r.shots * 100) : 0;
  const completed = r.mission.phases.filter(p => p.complete).length;
  const { grade, tint } = gradeFor(r);
  const cashRows: { label: string; detail: string; total: number }[] = [];
  for (const reason of Object.keys(CASH_REASONS)) {
    const entries = r.cashLog.filter(e => e.reason === reason);
    if (!entries.length) continue;
    const total = entries.reduce((a, e) => a + e.amount, 0);
    cashRows.push({ label: CASH_REASONS[reason], detail: `×${entries.length}`, total });
  }
  return (
    <main className={`results-root ${r.win ? '' : 'lose'}`}>
      <div className="results-wrap">
        <div className="results-header">
          <div className="stamp"><span className="stamp-grade" style={{ color: tint }}>{grade}</span></div>
          <div className="stamp-label">Grade {grade}</div>
          <h2 className="results-title">{r.win ? 'Extraction complete' : 'Mission failed'}</h2>
          <p className="results-sub">{r.mission.name} — {r.win
            ? 'You completed the operation and reached the pickup.'
            : `Operation ended during ${r.mission.phases.find(p => !p.complete)?.title.toLowerCase() ?? 'extraction'}.`}</p>
        </div>

        <div className="stats-grid">
          <div className="stat-cell">
            <span className="stat-label">Objectives</span>
            <div className="stat-value tabular"><CountUp to={completed} /><small> / {r.mission.phases.length}</small></div>
          </div>
          <div className="stat-cell">
            <span className="stat-label">Mission time</span>
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

        <section className="timeline" aria-label="Mission timeline">
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
        </section>

        <p className="results-note">
          <b>{r.pressure.totalSpawned}</b> hostiles entered the operation · peak pressure <b>{r.pressure.peakLive}</b> · <b>{r.headshots}</b> headshots confirmed.
        </p>

        <div className="results-actions">
          {r.win ? (
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
