import { useEffect } from 'react';
import type { CashLogEntry, GameSettings } from '../game/engine';
import { weaponById } from '../game/economy/catalog';
import { DEFAULT_PROFILE, type PlayerProfile } from '../game/economy/profile';
import { MAPS } from '../game/world';
import { getMission, type MissionReport } from '../game/systems/mission';
import type { MissionHud } from '../game/systems/mission-runtime';
import type { PressureStats } from '../game/systems/reinforcements';
import { missionClock, objectiveReadout } from './MissionObjective';
import { CountUp, Key, Ticker } from './components';
import CashCounter from './armory/CashCounter';
import { gradeFor } from '../game/economy/rewards';

export interface Results {
  win: boolean; kills: number; score: number; shots: number; hits: number; headshots: number; timeSec: number;
  mission: MissionReport; pressure: PressureStats;
  cash: number; cashLog: CashLogEntry[]; difficultyMul: number;
}

const Arrow = () => <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" /></svg>;

/* ================================================================
   MAIN MENU — COMMAND DECK (fits one viewport, no scrolling)
   ================================================================ */
export function MainMenu({ s, onStart, onSettings, onMap, onArmory, profile }: {
  s: GameSettings; onStart: () => void; onSettings: () => void; onMap: (map: GameSettings['map']) => void;
  onArmory?: () => void; profile?: PlayerProfile;
}) {
  const mission = getMission(s.map);
  const prof = profile ?? DEFAULT_PROFILE;
  const primaryName = weaponById(prof.loadout.primary.weapon)?.short ?? '—';
  const secondaryName = weaponById(prof.loadout.secondary.weapon)?.short ?? '—';
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
        <span className="ticker-item">SECTOR <i>Sandblast</i></span>
        <span className="ticker-item">SECTOR <i>Town</i></span>
        <span className="ticker-item">THREAT LEVEL <b>{s.difficulty.toUpperCase()}</b></span>
        <span className="ticker-item">SUPPLY <i>UNLIMITED AMMO</i></span>
        <span className="ticker-item">BUILD <b>3.0.0 // GROUND ZERO</b></span>
      </Ticker>

      <header className="menu-header">
        <a href="#" onClick={event => event.preventDefault()} className="wordmark glitch" aria-label="Recoil FPS home">
          <span className="slash-mark" aria-hidden="true">///</span> RECOIL
        </a>
        <div className="flex items-center gap-2.5">
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
            <button className="deploy-btn" onClick={onStart}>
              <span>START MISSION</span>
              <Arrow />
            </button>
            <button className="menu-secondary-btn armory-cta" onClick={onArmory}>
              ARMORY <span>LOADOUT · WALLET {prof.devFunds ? '∞' : `$${prof.cash.toLocaleString('en-US')}`}</span>
            </button>
            <div className="menu-loadout seq" style={{ animationDelay: '.36s' }} aria-label="Equipped loadout">
              <span className="mono"><b>1</b> {primaryName}</span>
              <span className="mono"><b>2</b> {secondaryName}</span>
            </div>
            <button className="menu-secondary-btn" onClick={onSettings}>
              SETTINGS <span>CONTROLS · AUDIO · GRAPHICS</span>
            </button>
          </div>
          <div className="input-legend seq" style={{ animationDelay: '.4s' }}>
            <Key>WASD</Key><span>MOVE</span><Key>RMB</Key><span>SCOPE</span><Key>1/2</Key><span>SWAP</span><Key>Q</Key><span>LAST</span><Key>Q·E</Key><span>LEAN</span><Key>G</Key><span>FRAG</span><Key>X</Key><span>PLANT</span><Key>ESC</Key><span>PAUSE</span>
          </div>
        </section>

        <section className="anim-slide-l" aria-label="Choose a mission" style={{ animationDelay: '.3s' }}>
          <div className="sec-label"><span>AREA OF OPERATIONS</span><span>{s.map === 'kasbah' ? '02' : '01'} / 02</span></div>
          {MAPS.map((map, index) => {
            const option = getMission(map.id);
            return (
              <button key={map.id} title={map.desc} onClick={() => onMap(map.id)} aria-pressed={map.id === s.map}
                className={`map-card ${map.id === s.map ? 'selected' : ''}`}>
                <span className="map-num">0{index + 1}</span>
                <span className="min-w-0">
                  <span className="map-name">{map.name}</span>
                  <span className="map-type">{map.id === 'alrasul' ? 'Desert river valley' : 'Fortified market town'}</span>
                </span>
                <span className="map-tag">{option.phases.length} PHASES</span>
                <span className="map-sel" aria-hidden="true" />
                <span className="map-scan" aria-hidden="true" />
              </button>
            );
          })}
          <p className="menu-rules">{selectedMap.desc} Pick your drop zone on the next screen — the camera takes you there.</p>
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
   MAP SELECT — two arenas side by side, live camera flyover behind
   ================================================================ */
export function MapSelect({ selected, ready, loadingMap, previewImage, onHover, onSelect, onDeploy, onBack }: {
  selected: GameSettings['map'];
  /** True once the engine for `selected` is built and the flyover camera is live. */
  ready: boolean;
  /** The map currently being built (if any). */
  loadingMap: GameSettings['map'] | null;
  /** Top-down arena scan for the built map, straight from the engine. */
  previewImage: string;
  onHover: (map: GameSettings['map']) => void;
  onSelect: (map: GameSettings['map']) => void;
  onDeploy: () => void;
  onBack: () => void;
}) {
  return (
    <main className="mapselect-root" role="dialog" aria-label="Select deployment zone">
      <div className="hex-grid" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />
      <header className="mapselect-head">
        <span className="menu-eyebrow">DEPLOYMENT ZONE<span className="cursor-blink" /></span>
        <h2 className="mapselect-title">CHOOSE YOUR ARENA</h2>
        <p className="mapselect-sub mono">HOVER A LOADED ARENA TO LOOK AT IT · CLICK TO BRING ITS CAMERA ONLINE</p>
      </header>

      <div className="mapselect-cards">
        {MAPS.map((map, index) => {
          const option = getMission(map.id);
          const isSel = map.id === selected;
          const isReady = isSel && ready;
          const isLoading = loadingMap === map.id;
          return (
            <button
              key={map.id}
              className={`arena-card ${isSel ? 'selected' : ''} ${isReady ? 'live' : ''}`}
              onMouseEnter={() => onHover(map.id)}
              onFocus={() => onHover(map.id)}
              onClick={() => onSelect(map.id)}
              aria-pressed={isSel}
            >
              <span className="arena-view" aria-hidden="true">
                {isReady && previewImage
                  ? <img src={previewImage} alt="" draggable={false} />
                  : <span className={`arena-placeholder ph-${map.id}`} />}
                <span className="arena-view-vignette" />
                <span className={`arena-status mono ${isLoading ? 'busy' : isReady ? 'ok' : ''}`}>
                  {isLoading ? 'CAMERA LINK LOADING…' : isReady ? 'CAMERA LINK LIVE' : 'CAMERA OFFLINE — CLICK TO LOAD'}
                </span>
              </span>
              <span className="arena-body">
                <span className="arena-num mono">0{index + 1}</span>
                <span className="arena-name">{map.name}</span>
                <span className="arena-type mono">{map.id === 'alrasul' ? 'DESERT RIVER VALLEY' : 'FORTIFIED MARKET TOWN'}</span>
                <span className="arena-desc">{map.desc}</span>
                <span className="arena-meta mono">{option.phases.length} OBJECTIVES · {option.phases[0]?.location.toUpperCase()}</span>
              </span>
              {isSel && <span className="arena-sel" aria-hidden="true">SELECTED</span>}
            </button>
          );
        })}
      </div>

      <div className="mapselect-actions">
        <button className="menu-secondary-btn" onClick={onBack}>‹ BACK</button>
        <button className="deploy-btn" onClick={onDeploy} disabled={!ready} title={ready ? 'Begin the operation' : 'Arena camera still loading'}>
          <span>PLAY{ready ? '' : ' — LOADING'}</span>
          <Arrow />
        </button>
      </div>
    </main>
  );
}

/* ================================================================
   MISSION BRIEFING — objectives on the loading screen, with narration
   ================================================================ */
export function MissionBriefing({ map, onDeploy, onBack }: { map: GameSettings['map']; onDeploy?: () => void; onBack?: () => void }) {
  const mission = getMission(map);
  const sector = MAPS.find(m => m.id === map)?.name.toUpperCase() ?? 'SECTOR';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Escape') onBack?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  return (
    <section className="briefing-root" role="status" aria-label="Mission briefing">
      <div className="hex-grid" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />
      <div className="briefing-wrap">
        <span className="menu-eyebrow">INSERTION IN PROGRESS · {sector}</span>
        <h2 className="briefing-title glitch" data-text={`OP. ${mission.name.toUpperCase()}`}>OP. {mission.name.toUpperCase()}</h2>
        <p className="briefing-copy">{mission.brief}</p>
        <ol className="briefing-objectives" aria-label="Mission objectives">
          {mission.phases.map((phase, index) => (
            <li key={phase.id} className="seq" style={{ animationDelay: `${0.25 + index * 0.14}s` }}>
              <span className="bo-num mono">{String(index + 1).padStart(2, '0')}</span>
              <span className="bo-body">
                <b>{phase.title}</b>
                <small className="mono">{phase.location.toUpperCase()}{phase.seconds ? ` · HOLD ${phase.seconds}S` : ''}{phase.fuse ? ` · FUSE ${phase.fuse}S` : ''}</small>
              </span>
            </li>
          ))}
        </ol>
        <div className="briefing-actions">
          {onDeploy && (
            <button type="button" className="btn primary deploy-btn" autoFocus onClick={onDeploy}>DEPLOY ▸</button>
          )}
          {onBack && (
            <button type="button" className="btn ghost menu-back-btn" onClick={onBack}>◂ BACK TO ARENAS</button>
          )}
        </div>
        <div className="briefing-note mono">
          <span className="briefing-wave" aria-hidden="true"><i /><i /><i /></span>
          COMMAND VOICE — BRIEFING IN PROGRESS
          <span className="briefing-bar"><span className="load-bar hazard-fill" /></span>
        </div>
      </div>
    </section>
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


export type ResultsWallet = { before: number; after: number; gradeBonus: number; earned: number; devFunds: boolean };

const CASH_REASONS: Record<string, string> = {
  kill: 'ELIMINATIONS', headshot: 'HEADSHOTS', grenade: 'GRENADE KILLS',
  streak: 'STREAK BONUSES', phase: 'PHASES SECURED', extraction: 'EXTRACTION',
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
          <div className="stat-cell">
            <span className="stat-label">SCORE</span>
            <div className="stat-value volt"><CountUp to={r.score} format={v => v.toLocaleString('en-US')} /><small>{r.win ? ' +1000 BK' : ''}</small></div>
          </div>
        </div>

        <section className="cash-card" aria-label="Cash earned">
          <div className="sec-label"><span>CASH EARNED</span><CashCounter value={r.cash} /></div>
          {cashRows.map((row, i) => (
            <div className="cash-row seq" style={{ animationDelay: `${0.1 + i * 0.08}s` }} key={row.label}>
              <span className="cash-row-label">{row.label} <small>{row.detail}</small></span>
              <span className="cash-row-val mono">+${row.total.toLocaleString('en-US')}</span>
            </div>
          ))}
          <div className="cash-row seq" style={{ animationDelay: `${0.1 + cashRows.length * 0.08}s` }}>
            <span className="cash-row-label">DIFFICULTY <small>×{r.difficultyMul}</small></span>
            <span className="cash-row-val mono">+${Math.round(r.cash * r.difficultyMul).toLocaleString('en-US')}</span>
          </div>
          {wallet.gradeBonus > 0 && (
            <div className="cash-row seq" style={{ animationDelay: `${0.18 + cashRows.length * 0.08}s` }}>
              <span className="cash-row-label">GRADE BONUS <small>{grade}</small></span>
              <span className="cash-row-val mono">+${wallet.gradeBonus.toLocaleString('en-US')}</span>
            </div>
          )}
          <div className="cash-wallet mono seq" style={{ animationDelay: `${0.26 + cashRows.length * 0.08}s` }}>
            <span>WALLET</span>
            <span>{wallet.devFunds ? '∞' : `$${wallet.before.toLocaleString('en-US')}`} → <CashCounter value={wallet.after} infinite={wallet.devFunds} /></span>
          </div>
        </section>

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
          <button className="deploy-btn" style={{ maxWidth: 300 }} onClick={onArmory}><span>OPEN ARMORY</span><Arrow /></button>
          <button className="menu-secondary-btn" onClick={onRedeploy}>REDEPLOY</button>
          <button className="menu-secondary-btn" onClick={onMenu}>RETURN TO BASE</button>
        </div>
      </div>
    </main>
  );
}
