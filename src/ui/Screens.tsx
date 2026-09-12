import type { GameSettings } from '../game/engine';
import { MAPS } from '../game/world';
import { getMission, type MissionReport } from '../game/systems/mission';
import type { MissionHud } from '../game/systems/mission-runtime';
import type { PressureStats } from '../game/systems/reinforcements';
import { missionClock, objectiveReadout } from './MissionObjective';

export interface Results {
  win: boolean; kills: number; shots: number; hits: number; headshots: number; timeSec: number;
  mission: MissionReport; pressure: PressureStats;
}

const Arrow = () => <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>;

export function MainMenu({ s, onDeploy, onSettings, onMap }: {
  s: GameSettings; onDeploy: () => void; onSettings: () => void; onMap: (map: GameSettings['map']) => void;
}) {
  const mission = getMission(s.map);
  const selectedMap = MAPS.find(map => map.id === s.map) ?? MAPS[0];
  return (
    <main className="operations-menu">
      <div className="operations-backdrop" />
      <header className="operations-header">
        <a href="#" onClick={event => event.preventDefault()} className="operations-wordmark" aria-label="Recoil FPS home"><span className="recoil-mark" aria-hidden="true">///</span> RECOIL</a>
        <span>SINGLE PLAYER / OPERATIONS</span>
      </header>
      <div className="operations-layout">
        <section className="operation-intro">
          <span className="mission-eyebrow">YOUR NEXT OPERATION</span>
          <h1>RECOIL<span>FPS</span></h1>
          <div className="operation-name"><span>OP.</span><strong>{mission.name}</strong></div>
          <p>{mission.brief}</p>
          <button className="mission-primary" onClick={onDeploy}>Start mission <Arrow /></button>
          <button className="mission-secondary" onClick={onSettings}>Settings <span>Controls, audio &amp; graphics</span></button>
          <div className="operation-input-note"><span>WASD</span> Move <span>RMB</span> Scope <span>1-5</span> Weapons <span>G</span> Frag (5×) <span>X</span> Plant <span>ESC</span> Pause</div>
        </section>
        <section className="operation-selection" aria-label="Choose a mission">
          <div className="mission-section-label"><span>AREA OF OPERATIONS</span><span>{s.map === 'kasbah' ? '02' : '01'} / 02</span></div>
          <div className="operation-options">
            {MAPS.map((map, index) => {
              const option = getMission(map.id);
              return <button key={map.id} onClick={() => onMap(map.id)} aria-pressed={map.id === s.map} className={`operation-option ${map.id === s.map ? 'is-selected' : ''}`}>
                <span className="operation-number">0{index + 1}</span>
                <span><strong>{option.name}</strong><small>{map.name}</small></span>
                <span className="selection-radio" aria-hidden="true" />
              </button>;
            })}
          </div>
          <div className="operation-route" key={mission.id}>
            <div className="mission-section-label"><span>MISSION ROUTE</span><span>{mission.phases.length} OBJECTIVES</span></div>
            <ol>
              {mission.phases.map((phase, index) => <li key={phase.id}>
                <span className="route-step">0{index + 1}</span>
                <div><strong>{phase.title}</strong><small>{phase.location}</small></div>
                {phase.type === 'hold' && <span className="route-timing">60 SEC</span>}
                {phase.type === 'destroy' && <span className="route-timing">25 SEC FUSE</span>}
              </li>)}
            </ol>
          </div>
          <p className="mission-rules">Reach the pickup to extract. Clearing the map is not the objective.</p>
        </section>
      </div>
      <footer className="operations-footer"><span>{selectedMap.name}</span><span>{s.difficulty.toUpperCase()} DIFFICULTY <i /> UNLIMITED AMMO</span></footer>
    </main>
  );
}

export function PauseMenu({ mission, onResume, onRestart, onSettings, onQuit }: {
  mission?: MissionHud; onResume: () => void; onRestart: () => void; onSettings: () => void; onQuit: () => void;
}) {
  const readout = mission ? objectiveReadout(mission) : undefined;
  return (
    <section className="mission-pause-layer" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="mission-pause">
        <div className="pause-actions">
          <span className="mission-eyebrow">RECOIL FPS</span>
          <h2 id="pause-title">Paused.</h2>
          <button className="mission-primary" onClick={onResume}>Resume <Arrow /></button>
          <button className="pause-menu-action" onClick={onSettings}>Settings <span>01</span></button>
          <button className="pause-menu-action" onClick={onRestart}>Restart mission <span>02</span></button>
          <button className="pause-menu-action pause-quit" onClick={onQuit}>Return to menu <span>03</span></button>
        </div>
        <div className="pause-objective">
          <div className="mission-section-label"><span>OPERATION {mission?.name ?? 'READY'}</span><span>{mission ? missionClock(mission.elapsed) : '00:00'}</span></div>
          <span className="pause-phase">{mission ? `0${mission.index + 1} / 0${mission.phaseCount}` : '--'}</span>
          <h3>{mission?.title ?? 'Ready to deploy'}</h3>
          <p>{mission?.brief ?? 'Select Resume to enter the mission.'}</p>
          {readout && <div className="pause-phase-progress"><strong>{readout.value}</strong><span>{readout.label}</span></div>}
          <span className="pause-clock-note">All mission timers are paused.</span>
        </div>
      </div>
    </section>
  );
}

export function ResultsScreen({ r, onRedeploy, onMenu }: { r: Results; onRedeploy: () => void; onMenu: () => void }) {
  const accuracy = r.shots ? Math.round(r.hits / r.shots * 100) : 0;
  const completed = r.mission.phases.filter(p => p.complete).length;
  return (
    <main className="mission-debrief">
      <div className="debrief-content">
        <header className="debrief-heading">
          <span className={`mission-eyebrow ${r.win ? 'extracted' : 'interrupted'}`}>{r.win ? 'EXTRACTION SUCCESSFUL' : 'MISSION INTERRUPTED'}</span>
          <h2>{r.mission.name}</h2>
          <p>{r.win ? 'You completed the operation and reached the pickup.' : `Operation ended during ${r.mission.phases.find(p => !p.complete)?.title.toLowerCase() ?? 'extraction'}.`}</p>
        </header>
        <div className="debrief-summary">
          <div><span>OBJECTIVES</span><strong>{completed} <small>/ {r.mission.phases.length}</small></strong></div>
          <div><span>MISSION TIME</span><strong>{missionClock(r.timeSec)}</strong></div>
          <div><span>ACCURACY</span><strong>{accuracy}<small>%</small></strong></div>
          <div><span>ELIMINATIONS</span><strong>{r.kills}</strong></div>
        </div>
        <section className="debrief-timeline" aria-label="Mission phase timings">
          <div className="mission-section-label"><span>AFTER-ACTION TIMELINE</span><span>ELAPSED</span></div>
          {r.mission.phases.map((phase, i) => <div className={`debrief-phase ${phase.complete ? 'complete' : ''}`} key={phase.id}>
            <span>0{i + 1}</span><strong>{phase.title}</strong><span className="debrief-phase-status">{phase.complete ? 'COMPLETE' : phase.seconds > 0 ? 'INTERRUPTED' : 'NOT REACHED'}</span><time>{missionClock(phase.seconds)}</time>
          </div>)}
        </section>
        <p className="debrief-footnote">{r.pressure.totalSpawned} hostiles entered the operation. Peak simultaneous pressure: {r.pressure.peakLive}. {r.headshots} headshots.</p>
        <div className="debrief-actions"><button className="mission-primary" onClick={onRedeploy}>Replay mission <Arrow /></button><button className="mission-secondary" onClick={onMenu}>Return to menu</button></div>
      </div>
    </main>
  );
}