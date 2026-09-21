// Recoil FPS — Warehouse TDM HUD layer: scoreboard, roster strip, respawn clock.
// Rendered on top of the standard HUD only while the arena mode is running.
import type { TdmHudState, TdmRosterRow } from '../game/tdm/manager';
import { TDM_RESPAWN_SECONDS } from '../game/tdm/armor';

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function RosterRow({ row, mine }: { row: TdmRosterRow; mine: boolean }) {
  return (
    <span className={`tdm-row ${row.dead ? 'dead' : ''} ${mine ? 'mine' : ''}`} title={`${row.name} · ${row.state}`}>
      <i className="tdm-armor" data-armor={row.armor} aria-label={`armor ${row.armor}`}>{row.icon}</i>
      <b>{mine ? `${row.name}*` : row.name}</b>
      <em className="mono">{row.kills}</em>
      {row.perch && <u className="tdm-perch" aria-label="overwatch">▲</u>}
    </span>
  );
}

export default function TdmHud({ tdm, hp, hpMax }: { tdm: TdmHudState; hp: number; hpMax: number }) {
  const urgent = tdm.timeLeft <= 30;
  const leadAlpha = tdm.alphaScore > tdm.bravoScore;
  const leadBravo = tdm.bravoScore > tdm.alphaScore;
  return (
    <>
      {/* ============ SCOREBOARD (top centre) ============ */}
      <div className="tdm-board" role="status" aria-label="Warehouse team deathmatch scoreboard">
        <span className="tdm-board-label mono">WAREHOUSE TDM · 5v5</span>
        <div className="tdm-board-line">
          <span className={`tdm-score alpha ${leadAlpha ? 'lead' : ''}`}>{tdm.alphaScore}</span>
          <span className={`tdm-clock tabular ${urgent ? 'urgent' : ''}`}>{clock(tdm.timeLeft)}</span>
          <span className={`tdm-score bravo ${leadBravo ? 'lead' : ''}`}>{tdm.bravoScore}</span>
        </div>
        <div className="tdm-board-teams mono"><span>ALPHA</span><span>BRAVO</span></div>
        <div className="tdm-roster">
          <div className="tdm-roster-col alpha">
            {tdm.alpha.map(row => <RosterRow key={row.name} row={row} mine />)}
          </div>
          <div className="tdm-roster-col bravo">
            {tdm.bravo.map(row => <RosterRow key={row.name} row={row} mine={false} />)}
          </div>
        </div>
      </div>

      {/* ============ RESPAWN OVERLAY ============ */}
      {tdm.respawnIn > 0 && (
        <div className="tdm-respawn" role="alert">
          <span className="tdm-respawn-kicker mono">ALPHA SPAWN — SOUTH YARD</span>
          <h2>ELIMINATED</h2>
          <p className="tdm-respawn-sub">
            Respawning in <b className="tabular">{Math.ceil(tdm.respawnIn)}s</b>
          </p>
          <div className="tdm-respawn-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, (1 - tdm.respawnIn / TDM_RESPAWN_SECONDS) * 100))}%` }} />
          </div>
          <div className="tdm-respawn-stats mono">
            <span>ALPHA <b>{tdm.alphaScore}</b></span>
            <span>BRAVO <b>{tdm.bravoScore}</b></span>
            <span>YOUR KILLS <b>{tdm.playerKills}</b></span>
            <span>YOUR DEATHS <b>{tdm.playerDeaths}</b></span>
          </div>
        </div>
      )}

      {/* Armor strip: which plate you are wearing and how much of it is left. */}
      <div className="tdm-armor-chip mono" aria-label="Equipped armor">
        <span>ARMOR</span>
        <b>{hpMax} HP</b>
        <span className="tdm-armor-bits" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} className={i < Math.ceil((hp / hpMax) * 10) ? 'on' : ''} />
          ))}
        </span>
      </div>
    </>
  );
}
