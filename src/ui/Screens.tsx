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

export const MAP_ART: Record<MapId, string> = { alrasul: mapAlrasul, kasbah: mapKasbah, arena: mapKasbah };

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

export function MainMenu({ s, onDeploy, onSettings, onMap, onArmory, profile }: {
  s: GameSettings; onDeploy: () => void; onSettings: () => void; onMap: (map: GameSettings['map']) => void;
  onArmory?: () => void; profile?: PlayerProfile;
}) {
  const prof = profile ?? DEFAULT_PROFILE;
  const primaryName = weaponById(prof.loadout.primary.weapon)?.short ?? '—';
  const secondaryName = weaponById(prof.loadout.secondary.weapon)?.short ?? '—';
  const [view, setView] = useState<'home' | 'maps' | 'missions'>('home');
  const [hovered, setHovered] = useState<MapId | null>(null);
  // The tile order follows the sketch: Town first, then Sandblast.
  const mapOrder = [...MAPS].sort(a => (a.id === 'kasbah' ? -1 : 1));

  /* ---------------- HOME ---------------- */
  if (view === 'home') {
    return (
      <main className="menu-root home-root">
        <div className="menu-bg" aria-hidden="true" />
        <div className="paper-grain" aria-hidden="true" />
        <img src={operatorArt} alt="" draggable={false} className="home-operator seq" style={{ animationDelay: '.1s' }} aria-hidden="true" />
        <div className="home-operator-fade" aria-hidden="true" />

        <div className="home-left">
          <div className="home-title-block seq" style={{ animationDelay: '.04s' }}>
            <span className="home-eyebrow">Desert operations · single operator</span>
            <h1 className="home-title">RECOIL</h1>
            <span className="home-rule" aria-hidden="true" />
          </div>

          <nav className="home-nav" aria-label="Main menu">
            <button className="home-item seq" style={{ animationDelay: '.12s' }} onClick={() => setView('maps')}>
              <span className="home-item-idx mono">01</span>
              <span className="home-item-body">
                <b>Missions</b>
                <em>Choose your battlefield and deploy</em>
              </span>
              <Arrow />
            </button>
            <button className="home-item seq" style={{ animationDelay: '.18s' }} onClick={onArmory}>
              <span className="home-item-idx mono">02</span>
              <span className="home-item-body">
                <b>Loadout</b>
                <em>{primaryName} + {secondaryName} · ${prof.cash.toLocaleString('en-US')}</em>
              </span>
              <Arrow />
            </button>
            <button className="home-item seq" style={{ animationDelay: '.24s' }} onClick={onSettings}>
              <span className="home-item-idx mono">03</span>
              <span className="home-item-body">
                <b>Settings</b>
                <em>Video, audio and controls</em>
              </span>
              <Arrow />
            </button>
          </nav>
        </div>

        <footer className="menu-footer">
          <span>{s.difficulty} difficulty<i />Unlimited ammo<i />Render · WebGL</span>
          <span className="menu-keys">
            <span className="keycap">WASD</span> Move <i /> <span className="keycap">RMB</span> Aim <i /> <span className="keycap">G</span> Frag <i /> <span className="keycap">Esc</span> Pause
          </span>
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
          <span className="menu-loadout" aria-label="Equipped loadout">
            <span><b>1</b> {primaryName}</span>
            <span><b>2</b> {secondaryName}</span>
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
                  <span className="map-tile-type">{map.id === 'alrasul' ? 'Desert river valley' : map.id === 'arena' ? '5v5 warehouse TDM' : 'Fortified market town'}</span>
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
