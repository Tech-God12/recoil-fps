// Recoil FPS — Scorestreak HUD: bottom rail, live-streak chips, strike designation
// overlay, nuke countdown and the message ticker.
import type { StreakHud } from '../game/streaks';

/* ------------------------------------------------------------------ */
/* Bottom rail: five slots, progress to the next threshold             */
/* ------------------------------------------------------------------ */
export function StreakRail({ st }: { st: StreakHud }) {
  const anyReady = st.ladder.some(l => l.ready);
  return (
    <div className={`sk-rail ${anyReady ? 'has-ready' : ''}`} aria-label="Scorestreaks">
      <div className="sk-slots">
        {st.ladder.map(l => {
          const state = l.active ? 'active' : l.ready ? 'ready' : l.claimed ? 'claimed' : 'locked';
          return (
            <div key={l.id} className={`sk-slot ${state} sk-${l.id}`} title={`${l.name} — ${l.cost}`}>
              <span className="sk-key">{l.key}</span>
              <span className="sk-icon" aria-hidden="true">{l.icon}</span>
              <span className="sk-name">{l.short}</span>
              <span className="sk-cost tabular">{l.cost}</span>
              {state === 'ready' && <span className="sk-ready-tag">Ready</span>}
              {state === 'active' && <span className="sk-ready-tag live">Live</span>}
            </div>
          );
        })}
      </div>
      <div className="sk-progress">
        <span className="sk-bar"><i style={{ width: `${(st.next ? st.next.pct : 1) * 100}%` }} /></span>
        <span className="sk-next mono">
          {st.next
            ? <><b className="tabular">{st.points}</b> / {st.next.cost} · next <em>{st.next.name}</em></>
            : <><b className="tabular">{st.points}</b> · ladder complete</>}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live streak chips (under the radar): timers + kill tallies           */
/* ------------------------------------------------------------------ */
export function StreakActive({ st }: { st: StreakHud }) {
  if (!st.active.length) return null;
  return (
    <div className="sk-active" aria-label="Active streaks">
      {st.active.map((a, i) => (
        <div key={`${a.id}-${i}`} className={`sk-chip sk-${a.id}`}>
          <span className="sk-chip-name">{a.name}</span>
          {a.detail && <span className="sk-chip-detail mono">{a.detail}</span>}
          {a.id !== 'airstrike' && <span className="sk-chip-time tabular">{Math.ceil(a.timeLeft)}s</span>}
          <span className="sk-chip-bar"><i style={{ width: `${Math.max(0, Math.min(1, a.timeLeft / a.total)) * 100}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Strike designation: bracketed reticle + instructions + red wash     */
/* ------------------------------------------------------------------ */
export function StrikeDesignator() {
  return (
    <div className="sk-designate" role="status" aria-label="Designating airstrike">
      <div className="sk-designate-wash" />
      <div className="sk-designate-reticle">
        <span className="c tl" /><span className="c tr" /><span className="c bl" /><span className="c br" />
        <span className="line h" /><span className="line v" />
        <span className="ring" />
      </div>
      <div className="sk-designate-title">Precision airstrike</div>
      <div className="sk-designate-sub mono">
        <span><span className="keycap">LMB</span> Confirm target</span>
        <i />
        <span><span className="keycap">RMB</span> Abort</span>
      </div>
      <div className="sk-designate-foot mono">Fast movers holding · 7 × Mk82 · 30 m line · danger close 16 m</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tactical nuke countdown                                              */
/* ------------------------------------------------------------------ */
export function NukeCountdown({ t }: { t: number }) {
  const urgent = t <= 3;
  return (
    <div className={`sk-nuke ${urgent ? 'urgent' : ''}`} role="alert">
      <span className="sk-nuke-icon" aria-hidden="true">☢</span>
      <span className="sk-nuke-title">Tactical nuke inbound</span>
      <span className="sk-nuke-count tabular">{Math.ceil(t)}</span>
      <span className="sk-nuke-sub mono">All units — seek cover</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Message ticker (UAV ONLINE, SENTRY DEPLOYED, ...)                    */
/* ------------------------------------------------------------------ */
export function StreakMessage({ text, tdm }: { text: string; tdm?: boolean }) {
  return (
    <div className={`sk-msg ${tdm ? 'tdm' : ''}`} role="status">
      <span className="sk-msg-tag">Streak</span>
      <span className="sk-msg-text">{text}</span>
    </div>
  );
}
