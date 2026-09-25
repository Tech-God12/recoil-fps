import type { MissionHud } from '../game/systems/mission-runtime';

export const missionClock = (seconds: number) => {
  const whole = Math.ceil(Math.max(0, seconds));
  return `${Math.floor(whole / 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
};

export function objectiveReadout(mission: MissionHud) {
  switch (mission.type) {
    case 'clear': return { value: `${mission.completed} / ${mission.required}`, label: 'defenders neutralised' };
    case 'destroy': return mission.armed
      ? { value: missionClock(mission.remaining), label: mission.distance > mission.radius + 3 ? 'X detonate now / or wait for fuse' : 'charge armed / move clear to detonate' }
      : { value: mission.canPlant ? (mission.plantProgress > 0 ? 'Securing' : 'Tap X') : `${Math.ceil(mission.distance)} m`, label: mission.canPlant ? 'attach charge / progress is saved' : 'reach the weapons cache' };
    case 'defend': return { value: `${Math.ceil(mission.defense / mission.defenseMax * 100)}% / ${missionClock(mission.remaining)}`, label: mission.contested ? 'relay overrun / eliminate hostiles in the ring' : 'relay integrity / hold off the counterattack' };
    case 'hold': return { value: missionClock(mission.remaining), label: mission.inside ? 'until extraction is ready' : 'timer paused / return to perimeter' };
    case 'extract': return { value: `${Math.ceil(mission.distance)} m`, label: 'reach the pickup alive' };
    default: return { value: `${Math.ceil(mission.distance)} m`, label: 'to the marked approach' };
  }
}

export default function MissionObjective({ mission }: { mission: MissionHud }) {
  const readout = objectiveReadout(mission);
  const phaseLabel = {advance:'Secure the position',clear:'Clear the area',destroy:'Sabotage',defend:'Protect the relay',hold:'Hold the perimeter',extract:'Extraction'}[mission.type];
  const timed = mission.type === 'defend' || mission.type === 'hold' || (mission.type === 'destroy' && mission.armed);
  const progress = mission.type === 'destroy' && !mission.armed ? mission.plantProgress : mission.progress;
  const warning = (mission.type === 'defend' && mission.contested) || (mission.type === 'hold' && !mission.inside) || (mission.type === 'destroy' && mission.armed && mission.remaining < 8);

  return (
    <>
      <section className={`obj-tracker hud-chip ${warning ? 'objective-warning' : ''}`} aria-label="Current mission objective">
        <div className="obj-kicker"><span>{mission.name}</span><span>Objective {mission.index + 1} of {mission.phaseCount}</span></div>
        <div className="obj-pips" aria-hidden="true">
          {Array.from({ length: mission.phaseCount }, (_, i) => <span key={i} className={i < mission.index ? 'done' : i === mission.index ? 'current' : ''} />)}
        </div>
        <div className={`objective-kind kind-${mission.type}`}>{phaseLabel}</div>
        <h2>{mission.title}</h2>
        <p className="obj-brief">{mission.brief}</p>
        <div className="obj-readout">
          {timed && <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
            <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
            <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="113.097" strokeDashoffset={113.097 * (1 - progress)} transform="rotate(-90 22 22)" />
          </svg>}
          <div><strong className="tabular">{readout.value}</strong><span>{readout.label}</span></div>
        </div>
        {(mission.type === 'clear' || mission.type === 'destroy') && (
          <div className="obj-progress" role="progressbar" aria-label="Objective progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ width: `${progress * 100}%`, background: warning ? 'var(--blood)' : 'var(--brass)' }} />
          </div>
        )}
        <div className="obj-loc">
          <svg viewBox="0 0 20 20" width="15" height="15" style={{ transform: `rotate(${mission.relativeBearing}deg)` }} aria-hidden="true"><path d="M10 2 17 17 10 13 3 17Z" fill="currentColor" /></svg>
          <span>{mission.location}</span><span className="tabular">{Math.ceil(mission.distance)} m</span>
        </div>
      </section>

      {mission.waypoint.visible && mission.distance > mission.radius && (
        <div className="obj-waypoint" style={{ left: `${mission.waypoint.x}%`, top: `${mission.waypoint.y}%` }} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 22 12 12 22 2 12Z" stroke="currentColor" fill="none" strokeWidth="1.5" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>
          <span className="tabular">{Math.ceil(mission.distance)} m</span>
        </div>
      )}
      {mission.type === 'destroy' && mission.armed && mission.distance > mission.radius+3 && (
        <div className="mission-interact"><kbd>X</kbd><span>Detonate • collapse the route now, or wait for the fuse</span></div>
      )}
      {mission.canPlant && !mission.armed && (
        <div className="mission-interact"><kbd>X</kbd><span>{mission.plantProgress > 0 ? 'Securing charge — keep target in sight; you can fire' : 'Tap to attach • move clear, then X to detonate'}</span><span className="interact-progress" style={{ transform: `scaleX(${mission.plantProgress})`, background: 'var(--brass)' }} /></div>
      )}
    </>
  );
}
