import { useEffect, useState } from 'react';
import type { GameSettings } from '../game/engine';
import { MAPS } from '../game/world';
import { getMission, type MissionReport } from '../game/systems/mission';
import type { MissionHud } from '../game/systems/mission-runtime';
import type { PressureStats } from '../game/systems/reinforcements';
import { missionClock, objectiveReadout } from './MissionObjective';
import { CountUp, Key, Ticker } from './components';

export interface Results {
  win: boolean; kills: number; shots: number; hits: number; headshots: number; timeSec: number;
  mission: MissionReport; pressure: PressureStats;
}

const Arrow = () => <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" /></svg>;

/* ================================================================
   MAIN MENU — COMMAND DECK
   ================================================================ */
export function MainMenu({ s, onDeploy, onSettings, onMap }: {
  s: GameSettings; onDeploy: () => void; onSettings: () => void; onMap: (map: GameSettings['map']) => void;
}) {
  const mission = getMission(s.map);
  const selectedMap = MAPS.find(map => map.id === s.map) ?? MAPS[0];
  return (
    <main className="menu-root">
      <div className="menu-bg" aria-hidden="true">
        <div className="menu-bg-img" />
        <div className="menu-grid-overlay hex-grid" />
        <div className="menu-scan scanlines noise-flicker" />
        <div className="menu-vignette" />
      </div>
      <div className="shutter shutter-top shutter-open" />
      <div className="shutter shutter-bot shutter-open" />

      <Ticker aria-hidden="true">
        <span className="ticker-item"><b>RECOIL FPS</b></span>
        <span className="ticker-item">SECTOR <i>AL-RASUL CROSSING</i></span>
        <span className="ticker-item">SECTOR <i>KASBAH RIDGE</i></span>
        <span className="ticker-item">THREAT LEVEL <b>{s.difficulty.toUpperCase()}</b></span>
        <span className="ticker-item">SUPPLY <i>UNLIMITED AMMO</i></span>
        <span className="ticker-item">COMMAND LINK <i>STABLE</i></span>
        <span className="ticker-item">BUILD <b>2.1.0 // VOLT PROTOCOL</b></span>
      </Ticker>

      <header className="menu-header">
        <a href="#" onClick={event => event.preventDefault()} className="wordmark glitch" aria-label="Recoil FPS home">
          <span className="slash-mark" aria-hidden="true">///</span> RECOIL
        </a>
        <div className="flex items-center gap-2.5">
          <span className="sys-chip"><span className="live-dot" />SYS LINK</span>
          <button className="util-btn" onClick={onSettings}>SETTINGS</button>
        </div>
      </header>

      <div className="menu-layout">
        <section>
          <span className="menu-eyebrow seq" style={{ animationDelay: '.05s' }}>OPERATION BRIEF<span className="cursor-blink" /></span>
          <h1 className="menu-title seq" style={{ animationDelay: '.12s' }}>
            RECOIL
            <small>FIRST PERSON STRIKE</small>
          </h1>
          <div className="op-chip seq" style={{ animationDelay: '.2s' }}>
            <span>OP.</span>
            <strong>{mission.name}</strong>
          </div>
          <p className="menu-brief seq" style={{ animationDelay: '.26s' }}>{mission.brief}</p>
          <div className="seq" style={{ animationDelay: '.32s' }}>
            <button className="deploy-btn" onClick={onDeploy}>
              <span>START MISSION</span>
              <Arrow />
            </button>
            <button className="menu-secondary-btn" onClick={onSettings}>
              SETTINGS <span>CONTROLS · AUDIO · GRAPHICS</span>
            </button>
          </div>
          <div className="input-legend seq" style={{ animationDelay: '.4s' }}>
            <Key>WASD</Key><span>MOVE</span><Key>RMB</Key><span>SCOPE</span><Key>1-5</Key><span>WEAPONS</span><Key>G</Key><span>FRAG</span><Key>X</Key><span>PLANT</span><Key>ESC</Key><span>PAUSE</span>
          </div>
        </section>

        <section className="anim-slide-l" aria-label="Choose a mission" style={{ animationDelay: '.3s' }}>
          <div className="sec-label"><span>AREA OF OPERATIONS</span><span>{s.map === 'kasbah' ? '02' : '01'} / 02</span></div>
          {MAPS.map((map, index) => {
            const option = getMission(map.id);
            return (
              <button key={map.id} onClick={() => onMap(map.id)} aria-pressed={map.id === s.map}
                className={`map-card ${map.id === s.map ? 'selected' : ''}`}>
                <span className="map-num">0{index + 1}</span>
                <span className="min-w-0">
                  <span className="map-name">{option.name}</span>
                  <span className="map-type">{map.name}</span>
                </span>
                <span className="map-tag">{option.phases.length} PHASES</span>
                <span className="map-sel" aria-hidden="true" />
                <span className="map-scan" aria-hidden="true" />
              </button>
            );
          })}

          <div className="route" key={mission.id}>
            <div className="sec-label"><span>MISSION ROUTE</span><span>{mission.phases.length} OBJECTIVES</span></div>
            <ol>
              {mission.phases.map((phase, index) => (
                <li key={phase.id}>
                  <span className="route-node">0{index + 1}</span>
                  <div>
                    <span className="route-title">{phase.title}</span>
                    <span className="route-loc">{phase.location}</span>
                  </div>
                  {phase.type === 'hold' && <span className="route-timing">60 SEC</span>}
                  {phase.type === 'destroy' && <span className="route-timing">25 SEC FUSE</span>}
                </li>
              ))}
            </ol>
          </div>
          <p className="menu-rules">Reach the pickup to extract. Clearing the map is not the objective.</p>
        </section>
      </div>

      <footer className="menu-footer">
        <span>ACTIVE SECTOR — <b>{selectedMap.name}</b></span>
        <span>{s.difficulty.toUpperCase()} DIFFICULTY<i />UNLIMITED AMMO<i />RENDER: WEBGL</span>
      </footer>
    </main>
  );
}

/* ================================================================
   DEPLOY SEQUENCE — LOADING
   ================================================================ */
const BOOT_LINES = [
  'CALIBRATING OPTICS',
  'ARMING REINFORCEMENTS',
  'LINKING COMMAND SAT',
  'SYNCING SECTOR GRID',
  'SPOOLING WEAPON SYSTEMS',
];

export function BootScreen() {
  const [line, setLine] = useState(0);
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const l = window.setInterval(() => setLine(i => (i + 1) % BOOT_LINES.length), 900);
    const p = window.setInterval(() => setPct(v => Math.min(94, v + 2 + Math.floor(Math.random() * 6))), 120);
    return () => { window.clearInterval(l); window.clearInterval(p); };
  }, []);
  return (
    <div className="boot-root" role="status">
      <div className="boot-hex hex-grid" aria-hidden="true" />
      <div className="boot-radar" aria-hidden="true">
        <span className="ring1" /><span className="ring2" /><span className="sweep" /><span className="core" />
      </div>
      <div className="boot-title glitch">DEPLOYING</div>
      <div className="boot-status">{BOOT_LINES[line]}</div>
      <div className="boot-bar"><span className="load-bar hazard-fill" /></div>
      <div className="boot-pct">{String(pct).padStart(3, '0')}%</div>
      <div className="boot-note">DO NOT POWER OFF TERMINAL</div>
    </div>
  );
}

/* ================================================================
   PAUSE — OPERATION SUSPENDED
   ================================================================ */
export function PauseMenu({ mission, onResume, onRestart, onSettings, onQuit }: {
  mission?: MissionHud; onResume: () => void; onRestart: () => void; onSettings: () => void; onQuit: () => void;
}) {
  const readout = mission ? objectiveReadout(mission) : undefined;
  return (
    <section className="pause-layer" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="hex-grid" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />
      <div className="pause-wrap">
        <div className="pause-left">
          <span className="menu-eyebrow">SYSTEM PAUSE</span>
          <h2 id="pause-title" className="pause-title glitch-loop" data-text="PAUSED">PAUSED</h2>
          <button className="pause-action pause-resume cut-sm" onClick={onResume}><span>RESUME MISSION</span><span className="idx">01</span></button>
          <button className="pause-action" onClick={onSettings}><span>SETTINGS</span><span className="idx">02</span></button>
          <button className="pause-action" onClick={onRestart}><span>RESTART MISSION</span><span className="idx">03</span></button>
          <button className="pause-action pause-quit" onClick={onQuit}><span>ABORT TO MENU</span><span className="idx">04</span></button>
          <p className="pause-hint"><Key>ESC</Key>RESUME ANYTIME</p>
        </div>
        <div className="pause-card cut panel-bg">
          <span className="brk brk-tl" /><span className="brk brk-tr" /><span className="brk brk-bl" /><span className="brk brk-br" />
          <div className="pause-card-head">
            <span>OPERATION <b>{mission?.name ?? 'READY'}</b></span>
            <span className="pause-clock">{mission ? missionClock(mission.elapsed) : '00:00'}</span>
          </div>
          <span className="pause-phase">{mission ? `PHASE 0${mission.index + 1} / 0${mission.phaseCount}` : 'PHASE --'}</span>
          <h3>{mission?.title ?? 'Ready to deploy'}</h3>
          <p>{mission?.brief ?? 'Select Resume to enter the mission.'}</p>
          <div className="pause-progress">
            <span className="hazard-fill" style={{ width: `${Math.round((mission?.progress ?? 0) * 100)}%` }} />
          </div>
          {readout && (
            <div className="pause-readout">
              <strong>{readout.value}</strong>
              <span>{readout.label}</span>
            </div>
          )}
          <p className="pause-note">ALL MISSION TIMERS FROZEN</p>
        </div>
      </div>
    </section>
  );
}

/* ================================================================
   RESULTS — AFTER-ACTION REPORT
   ================================================================ */
function gradeFor(r: Results): { grade: string; tint: string } {
  const accuracy = r.shots ? Math.round(r.hits / r.shots * 100) : 0;
  const score = (r.win ? 60 : 0) + Math.min(20, r.kills * 2) + Math.min(20, accuracy / 5);
  const grade = score >= 95 ? 'S' : score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
  return { grade, tint: grade === 'S' || grade === 'A' ? '#38FF9B' : grade === 'B' ? '#FFC400' : '#FF2E4D' };
}

export function ResultsScreen({ r, onRedeploy, onMenu }: { r: Results; onRedeploy: () => void; onMenu: () => void }) {
  const accuracy = r.shots ? Math.round(r.hits / r.shots * 100) : 0;
  const completed = r.mission.phases.filter(p => p.complete).length;
  const { grade, tint } = gradeFor(r);
  return (
    <main className={`results-root ${r.win ? '' : 'lose'}`}>
      <div className="hex-grid" aria-hidden="true" />
      <div className="results-wrap">
        <div className="stamp" style={{ transform: 'rotate(-6deg)' }}>
          <span className="stamp-ring1" /><span className="stamp-ring2" />
          <span className="stamp-grade" style={{ color: tint, textShadow: `0 0 26px ${tint}` }}>{grade}</span>
        </div>
        <p className="stamp-label">/// GRADE <b>{grade}</b> — PERFORMANCE RATING ///</p>
        <h2 className={`results-title ${r.win ? 'glow-volt' : 'glow-red'} glitch`}
          style={{ color: r.win ? 'var(--volt)' : 'var(--danger)' }}>
          {r.win ? 'EXTRACTION COMPLETE' : 'MISSION FAILED'}
        </h2>
        <p className="results-sub">{r.mission.name} — {r.win
          ? 'You completed the operation and reached the pickup.'
          : `Operation ended during ${r.mission.phases.find(p => !p.complete)?.title.toLowerCase() ?? 'extraction'}.`}</p>

        <div className="stats-grid">
          <div className="stat-cell">
            <span className="stat-label">OBJECTIVES</span>
            <div className="stat-value cyber"><CountUp to={completed} /><small> / {r.mission.phases.length}</small></div>
          </div>
          <div className="stat-cell">
            <span className="stat-label">MISSION TIME</span>
            <div className="stat-value">{missionClock(r.timeSec)}</div>
          </div>
          <div className="stat-cell">
            <span className="stat-label">ACCURACY</span>
            <div className={`stat-value ${accuracy >= 50 ? 'volt' : accuracy >= 25 ? '' : 'red'}`}><CountUp to={accuracy} /><small>%</small></div>
          </div>
          <div className="stat-cell">
            <span className="stat-label">ELIMINATIONS</span>
            <div className="stat-value red"><CountUp to={r.kills} /></div>
          </div>
        </div>

        <section className="timeline" aria-label="Mission phase timings">
          <div className="sec-label" style={{ paddingBottom: 10 }}><span>AFTER-ACTION TIMELINE</span><span>ELAPSED</span></div>
          {r.mission.phases.map((phase, i) => {
            const fill = phase.complete ? 100 : phase.seconds > 0 ? 45 : 0;
            return (
              <div className={`tl-row ${phase.complete ? 'done' : ''}`} key={phase.id}>
                <span className="tl-idx">0{i + 1}</span>
                <div className="tl-body">
                  <div className="tl-title"><strong>{phase.title}</strong><time>{missionClock(phase.seconds)}</time></div>
                  <div className="tl-bar">
                    <span className={phase.complete ? 'hazard-fill' : 'bg-[var(--warn)]/60'}
                      style={{ width: `${fill}%`, animationDelay: `${0.15 + i * 0.1}s` }} />
                  </div>
                </div>
                <span className={`tl-status ${phase.complete ? 'done' : phase.seconds > 0 ? 'fail' : ''}`}>
                  {phase.complete ? 'COMPLETE' : phase.seconds > 0 ? 'INTERRUPTED' : 'NOT REACHED'}
                </span>
              </div>
            );
          })}
        </section>

        <p className="results-note">
          <b>{r.pressure.totalSpawned}</b> hostiles entered the operation · peak simultaneous pressure <b>{r.pressure.peakLive}</b> · <b>{r.headshots}</b> headshots confirmed.
        </p>
        <div className="results-actions">
          <button className="deploy-btn" style={{ maxWidth: 300 }} onClick={onRedeploy}><span>REDEPLOY</span><Arrow /></button>
          <button className="menu-secondary-btn" onClick={onMenu}>RETURN TO BASE</button>
        </div>
      </div>
    </main>
  );
}
