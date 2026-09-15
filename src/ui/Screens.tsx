import { useEffect, useState, useRef } from 'react';
import type { CashLogEntry, GameSettings } from '../game/engine';
import { weaponById } from '../game/economy/catalog';
import { DEFAULT_PROFILE, type PlayerProfile } from '../game/economy/profile';
import { MAPS } from '../game/world';
import { getMission, type MissionReport } from '../game/systems/mission';
import type { MissionHud } from '../game/systems/mission-runtime';
import type { PressureStats } from '../game/systems/reinforcements';
import { missionClock, objectiveReadout } from './MissionObjective';
import { CountUp } from './components';
import CashCounter from './armory/CashCounter';
import { gradeFor } from '../game/economy/rewards';

export interface Results {
  win: boolean; kills: number; score: number; shots: number; hits: number; headshots: number; timeSec: number;
  mission: MissionReport; pressure: PressureStats;
  cash: number; cashLog: CashLogEntry[]; difficultyMul: number;
}

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="square" /></svg>
);

/* ================================================================
   MAIN MENU — NO SCROLL, SIDE-BY-SIDE MAP PREVIEWS CENTER, HOVER OVERHEAD
   ================================================================ */
export function MainMenu({ s, onDeploy, onSettings, onMap, onArmory, profile }: {
  s: GameSettings; onDeploy: () => void; onSettings: () => void; onMap: (map: GameSettings['map']) => void;
  onArmory?: () => void; profile?: PlayerProfile;
}) {
  const mission = getMission(s.map);
  const prof = profile ?? DEFAULT_PROFILE;
  const primaryName = weaponById(prof.loadout.primary.weapon)?.short ?? '—';
  const secondaryName = weaponById(prof.loadout.secondary.weapon)?.short ?? '—';
  const selectedMap = MAPS.find(map => map.id === s.map) ?? MAPS[0];
  const [hoverMap, setHoverMap] = useState<GameSettings['map'] | null>(null);
  const [showRoute, setShowRoute] = useState(false);
  const displayMission = hoverMap ? getMission(hoverMap) : mission;

  return (
    <main className="menu-root no-scroll">
      <div className="menu-bg" aria-hidden="true" />
      <div className="paper-grain" aria-hidden="true" />

      <header className="menu-header">
        <a href="#" onClick={e => e.preventDefault()} className="wordmark" aria-label="Recoil home">
          RECOIL
        </a>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="util-btn" onClick={onArmory}>Armory</button>
          <button className="util-btn" onClick={onSettings}>Settings</button>
        </div>
      </header>

      <div className="menu-layout no-scroll-layout">
        <section className="menu-left">
          <span className="menu-eyebrow seq" style={{ animationDelay: '.06s' }}>Operation brief</span>
          <h1 className="menu-title seq" style={{ animationDelay: '.12s' }}>
            {displayMission.name}
            <small>{displayMission.brief.split(' — ')[0] ?? 'Field operations'}</small>
          </h1>
          <div className="op-chip seq" style={{ animationDelay: '.18s' }}>
            <span>Op</span>
            <strong>{displayMission.name}</strong>
          </div>
          <p className="menu-brief seq" style={{ animationDelay: '.24s' }}>{displayMission.brief}</p>

          <div className="seq" style={{ animationDelay: '.30s' }}>
            <button className="deploy-btn" onClick={onDeploy}>
              <span>Start mission</span>
              <span className="hint">Deploy</span>
              <Arrow />
            </button>

            <button className="menu-secondary-btn" onClick={onArmory}>
              Armory <span>Loadout · ${prof.cash.toLocaleString('en-US')}</span>
            </button>

            <div className="menu-loadout" aria-label="Equipped loadout">
              <span><b>1</b> {primaryName}</span>
              <span><b>2</b> {secondaryName}</span>
            </div>
          </div>

          <div className="input-legend seq" style={{ animationDelay: '.36s' }}>
            <span className="keycap">WASD</span><span>Move</span>
            <span className="keycap">RMB</span><span>Aim</span>
            <span className="keycap">1/2</span><span>Swap</span>
            <span className="keycap">Q</span><span>Last</span>
            <span className="keycap">G</span><span>Frag</span>
            <span className="keycap">Esc</span><span>Pause</span>
          </div>
        </section>

        <section className="menu-center anim-slide" style={{ animationDelay: '.18s' }} aria-label="Choose a mission">
          <div className="sec-label"><span>Area of operations</span><span>{s.map === 'kasbah' ? '02' : '01'} / 02 — hover for overhead</span></div>
          <div className="map-previews">
            {MAPS.map((map, index) => {
              const opt = getMission(map.id);
              const active = map.id === s.map;
              const isHovered = hoverMap === map.id;
              return (
                <button
                  key={map.id}
                  onClick={() => { onMap(map.id); setShowRoute(true); }}
                  onMouseEnter={() => setHoverMap(map.id)}
                  onMouseLeave={() => setHoverMap(null)}
                  aria-pressed={active}
                  className={`map-preview-card ${active ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
                >
                  <div className="map-preview-top">
                    <span className="map-num">0{index + 1}</span>
                    <span className="map-tag">{opt.phases.length} phases</span>
                  </div>
                  <div className="map-preview-visual" data-map={map.id}>
                    <div className="map-overhead" aria-hidden="true">
                      <span className="overhead-grid" />
                      {map.id === 'alrasul' && <span className="overhead-river" />}
                      {map.id === 'kasbah' && <span className="overhead-kasbah" />}
                      {opt.phases.map((p, pi) => (
                        <span key={p.id} className="overhead-node" style={{ left: `${18 + pi * 16}%`, top: `${30 + (pi % 3) * 18}%` }}>{pi+1}</span>
                      ))}
                    </div>
                    <div className="map-preview-overlay">
                      <span className="map-name">{map.name}</span>
                      <span className="map-type">{map.id === 'alrasul' ? 'Desert river valley' : 'Fortified market town'}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {showRoute ? (
            <div className="route route-visible">
              <div className="sec-label"><span>Mission route — {displayMission.name}</span><span>{displayMission.phases.length} objectives</span></div>
              <ol>
                {displayMission.phases.map((p, i) => (
                  <li key={p.id}>
                    <span className="route-node">0{i + 1}</span>
                    <div>
                      <span className="route-title">{p.title}</span>
                      <span className="route-loc">{p.location}</span>
                    </div>
                    {(p.type === 'hold' || p.type === 'defend') && <span className="route-timing">{p.seconds}s · {p.type === 'defend' ? 'relay' : 'hold'}</span>}
                    {p.type === 'destroy' && <span className="route-timing">{p.fuse}s fuse</span>}
                  </li>
                ))}
              </ol>
              <button className="util-btn" style={{ marginTop: 8 }} onClick={() => setShowRoute(false)}>Hide route</button>
            </div>
          ) : (
            <div className="route-placeholder">
              <p className="menu-rules">Select a sector to view its route. Hover for overhead recon.</p>
              <button className="util-btn" onClick={() => setShowRoute(true)}>Show route: {mission.name}</button>
            </div>
          )}
        </section>
      </div>

      <footer className="menu-footer">
        <span>Active sector — <b>{selectedMap.name}</b></span>
        <span>{s.difficulty} difficulty<i />Infinite funds<i />Render · WebGL</span>
      </footer>
    </main>
  );
}

/* ================================================================
   DEPLOY SEQUENCE — WITH OBJECTIVES + VOICEOVER
   ================================================================ */
const BOOT_LINES = [
  'Zeroing optics',
  'Mustering squad',
  'Uplink handshake',
  'Grid sync',
  'Arming weapons',
];

const BOOT_OBJECTIVES: Record<string, string[]> = {
  alrasul: [
    'Infiltrate river valley',
    'Secure forward OP',
    'Hold comms relay',
    'Destroy enemy cache',
    'Extract at river bend',
  ],
  kasbah: [
    'Breach market perimeter',
    'Clear fortified stalls',
    'Defend intel pickup',
    'Plant charges on gate',
    'Exfil via kasbah alley',
  ],
};

export function BootScreen({ map, difficulty }: { map?: GameSettings['map']; difficulty?: string } = {}) {
  const [line, setLine] = useState(0);
  const [pct, setPct] = useState(0);
  const [voiced, setVoiced] = useState(false);
  const mission = getMission(map ?? 'alrasul');
  const objectives = BOOT_OBJECTIVES[map ?? 'alrasul'] ?? BOOT_OBJECTIVES.alrasul;

  useEffect(() => {
    const l = window.setInterval(() => setLine(i => (i + 1) % BOOT_LINES.length), 840);
    const p = window.setInterval(() => setPct(v => Math.min(96, v + 2 + Math.floor(Math.random() * 5))), 125);
    return () => { window.clearInterval(l); window.clearInterval(p); };
  }, []);

  useEffect(() => {
    if (voiced) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const utter = new SpeechSynthesisUtterance(
        `Operation ${mission.name}. ${mission.brief}. Objectives: ${objectives.join(', ')}. Difficulty ${difficulty ?? 'normal'}. Good luck.`
      );
      utter.rate = 0.95;
      utter.volume = 0.7;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
      setVoiced(true);
    } catch {
      // Voiceover is optional
    }
  }, [mission, objectives, difficulty, voiced]);

  return (
    <div className="boot-root" role="status" aria-live="polite">
      <div className="boot-plate anim-rise">
        <div className="boot-kicker">Deploying — {map?.toUpperCase() ?? 'ALRASUL'} · {difficulty?.toUpperCase() ?? 'NORMAL'}</div>
        <div className="boot-title">{mission.name}</div>
        <div className="boot-status"><em>{BOOT_LINES[line]}</em><span className="boot-ellipsis" aria-hidden="true" /></div>

        <div className="boot-objectives">
          <div className="sec-label"><span>Objectives</span><span className="mono">{objectives.length} phases</span></div>
          <ol>
            {objectives.map((o, i) => (
              <li key={i}><span className="route-node">0{i+1}</span><span>{o}</span></li>
            ))}
          </ol>
          <p className="boot-brief">{mission.brief}</p>
        </div>

        <div className="boot-bar" aria-hidden="true"><span className="boot-bar__fill" style={{ width: `${pct}%` }} /></div>
        <div className="boot-pct tabular">{String(pct).padStart(3, '0')}% — voiceover active</div>
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
