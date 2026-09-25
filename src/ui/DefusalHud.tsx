// Recoil FPS — Bomb Defusal HUD layer (CS2-style, in RECOIL's print-room language).
// Pure render from the polled engine HudState: top bar (score · alive pips · clock or
// the planted C4), round banners with MVP, money, plant/defuse progress, prompts,
// spectator strip, smoke white-out and the Tab scoreboard with round history.
import type { DefusalHud, DefusalRosterEntry } from '../game/defusal/mode';
import type { HudState } from '../game/engine';
import { missionClock } from './MissionObjective';

const SIDE_NAME = { attack: 'Attack', defend: 'Defend' } as const;
const REASON_ICON: Record<string, string> = { elimination: '☠', bomb: '✹', defuse: '✂', time: '◷' };
const REASON_TITLE: Record<string, string> = { elimination: 'Elimination', bomb: 'Bomb detonated', defuse: 'Bomb defused', time: 'Time expired' };

export const C4Glyph = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="8" width="20" height="11" rx="1.5" fill="currentColor" opacity="0.9" />
    <rect x="5" y="5" width="9" height="4" rx="1" fill="currentColor" />
    <rect x="4" y="10.5" width="3" height="7" fill="rgba(0,0,0,.35)" />
    <rect x="8.5" y="10.5" width="3" height="7" fill="rgba(0,0,0,.35)" />
    <rect x="13" y="10.5" width="3" height="7" fill="rgba(0,0,0,.35)" />
    <circle cx="19" cy="12" r="1.4" fill="#FF3A22" />
  </svg>
);
const ArmorGlyph = ({ tier }: { tier: number }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 2.5l8 3v6c0 5-3.5 8.6-8 10-4.5-1.4-8-5-8-10v-6z" fill={tier ? 'currentColor' : 'none'} fillOpacity={tier ? 0.25 : 0} />
    {tier >= 2 && <path d="M7 9.5c1.4-2 3-3 5-3s3.6 1 5 3" />}
  </svg>
);
const KitGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="4" y="7" width="16" height="12" rx="1.5" /><path d="M9 7V5h6v2M8 13h8M12 9v8" />
  </svg>
);

function Pips({ roster, team, side }: { roster: DefusalRosterEntry[]; team: 'alpha' | 'bravo'; side: 'attack' | 'defend' }) {
  const list = roster.filter(r => r.team === team);
  const ordered = team === 'alpha' ? list : [...list].reverse();
  return (
    <span className={`df-pips ${side}`}>
      {ordered.map(r => (
        <i key={r.id} className={`${r.alive ? 'on' : 'off'} ${r.you ? 'you' : ''}`} title={`${r.name}${r.alive ? (team === 'alpha' ? ` · ${r.hp} HP` : '') : ' · dead'}`}>
          {r.bomb && <em className="df-pip-bomb"><C4Glyph size={9} /></em>}
          {/* your squad shows health; enemies only show alive/dead, exactly like CS */}
          {r.alive && <b style={{ height: `${team === 'alpha' ? Math.max(8, r.hp) : 100}%` }} />}
        </i>
      ))}
    </span>
  );
}

function History({ df, compact = false }: { df: DefusalHud; compact?: boolean }) {
  const cells = Array.from({ length: df.maxRounds }, (_, i) => df.history[i] ?? null);
  return (
    <div className={`df-history ${compact ? 'compact' : ''}`} aria-label="Round history">
      {cells.map((h, i) => (
        <span key={i} className={`df-hcell ${h ? (h.winner === 'alpha' ? 'win' : 'loss') : 'empty'} ${i === df.halftimeAfter ? 'half' : ''} ${i + 1 === df.round && !h ? 'now' : ''}`} title={h ? `Round ${h.round}: ${h.winner === 'alpha' ? 'won' : 'lost'} — ${REASON_TITLE[h.reason]}` : `Round ${i + 1}`}>
          {h ? REASON_ICON[h.reason] : ''}
        </span>
      ))}
    </div>
  );
}

/** Hold-Tab scoreboard: CS-style table per team + the round strip. */
export function DefusalBoard({ df }: { df: DefusalHud }) {
  const played = Math.max(1, df.history.length);
  const Row = ({ r }: { r: DefusalRosterEntry }) => (
    <div className={`df-row ${r.you ? 'you' : ''} ${r.alive ? '' : 'dead'}`}>
      <span className="df-row-name">
        {r.bomb && <em className="df-row-bomb"><C4Glyph size={12} /></em>}
        {r.name}
        {r.weapon && <i className="df-row-gun mono">{r.weapon}</i>}
        {r.kit && <i className="df-row-kit" title="Defuse kit"><KitGlyph /></i>}
      </span>
      <span className="mono tabular money">{r.money !== null ? `$${r.money.toLocaleString('en-US')}` : ''}</span>
      <span className="tabular">{r.kills}</span>
      <span className="tabular dim">{r.assists}</span>
      <span className="tabular dim">{r.deaths}</span>
      <span className="tabular dim">{Math.round(r.damage / played)}</span>
      <span className="tabular dim">{r.kills ? Math.round((r.headshots / r.kills) * 100) : 0}%</span>
      <span className="tabular mvp">{r.mvps ? `★${r.mvps > 1 ? r.mvps : ''}` : ''}</span>
      <span className="tabular score">{r.score}</span>
    </div>
  );
  const team = (t: 'alpha' | 'bravo') => df.roster.filter(r => r.team === t).sort((a, b) => b.score - a.score || b.kills - a.kills);
  const Head = ({ side, label, score }: { side: 'attack' | 'defend'; label: string; score: number }) => (
    <div className={`df-team-head ${side}`}>
      <b className="tabular">{score}</b>
      <span>{label}<em>{SIDE_NAME[side]}</em></span>
    </div>
  );
  const Cols = () => (
    <div className="df-row head">
      <span className="df-row-name">Player</span><span>$</span><span>K</span><span>A</span><span>D</span><span>ADR</span><span>HS</span><span>MVP</span><span>Score</span>
    </div>
  );
  const bravoSide = df.alphaSide === 'attack' ? 'defend' : 'attack';
  return (
    <div className="df-board" role="dialog" aria-label="Match scoreboard">
      <div className="df-board-top">
        <span className="df-board-map">Sirocco · bomb defusal</span>
        <span className="df-board-round mono">Round {df.round} of {df.maxRounds} · first to {df.roundsToWin}</span>
      </div>
      <History df={df} />
      <div className="df-board-teams">
        <div className="df-board-team">
          <Head side={df.alphaSide} label="Your squad" score={df.alphaScore} />
          <Cols />
          {team('alpha').map(r => <Row key={r.id} r={r} />)}
        </div>
        <div className="df-board-team">
          <Head side={bravoSide} label="Hostiles" score={df.bravoScore} />
          <Cols />
          {team('bravo').map(r => <Row key={r.id} r={r} />)}
        </div>
      </div>
      <span className="df-board-hint mono">Hold Tab · ☠ elimination · ✹ bomb · ✂ defuse · ◷ time</span>
    </div>
  );
}

export default function DefusalHudLayer({ hud, showBoard }: { hud: HudState; showBoard: boolean }) {
  const df = hud.defusal;
  if (!df) return null;
  const bravoSide = df.alphaSide === 'attack' ? 'defend' : 'attack';
  const planted = df.bombState === 'planted';
  const urgent = planted && df.bombTimeLeft < 10;
  const clockLow = df.phase === 'live' && df.clock < 15;
  const banner = df.banner;
  const mp = df.matchPoint.length > 0;
  return (
    <>
      {/* smoke white-out when your eyes are inside a cloud */}
      {df.smokeDensity > 0.02 && <div className="df-smoke" style={{ opacity: Math.min(0.97, df.smokeDensity) }} aria-hidden="true" />}

      {/* ============ TOP BAR ============ */}
      <div className="df-top" aria-label="Round status">
        <div className={`df-team alpha ${df.alphaSide}`}>
          <span className="df-side">{SIDE_NAME[df.alphaSide]}</span>
          <b className="df-score tabular">{df.alphaScore}</b>
        </div>
        <Pips roster={df.roster} team="alpha" side={df.alphaSide} />
        <div className={`df-clock ${planted ? 'planted' : ''} ${urgent ? 'urgent' : ''} ${clockLow ? 'low' : ''} ${df.phase}`}>
          {planted ? (
            <>
              <span className="df-c4" style={{ animationDuration: `${Math.max(0.18, df.bombTimeLeft / 40)}s` }}><C4Glyph size={26} /></span>
              <i className="mono tabular">{df.bombTimeLeft.toFixed(df.bombTimeLeft < 10 ? 1 : 0)}</i>
            </>
          ) : (
            <>
              <b className="tabular">{df.phase === 'halftime' || df.phase === 'ended' ? '—' : missionClock(df.clock)}</b>
              <i>{df.phase === 'freeze' ? 'Buy phase' : df.phase === 'over' ? 'Round over' : df.phase === 'halftime' ? 'Halftime' : `Round ${df.round}`}</i>
            </>
          )}
        </div>
        <Pips roster={df.roster} team="bravo" side={bravoSide} />
        <div className={`df-team bravo ${bravoSide}`}>
          <b className="df-score tabular">{df.bravoScore}</b>
          <span className="df-side">{SIDE_NAME[bravoSide]}</span>
        </div>
      </div>
      <div className="df-subtop mono">
        {mp ? <span className="df-mp">Match point</span> : df.lastOfHalf ? <span className="df-mp">Last round of the half</span> : <span>First to {df.roundsToWin}</span>}
        <History df={df} compact />
      </div>

      {/* ============ TEAM PLAN / ORDERS ============ */}
      {df.plan && !df.playerDead && (df.phase === 'freeze' || df.phase === 'live') && <div className="df-plan mono">{df.plan}</div>}

      {/* ============ BANNERS ============ */}
      {banner && (
        <div key={banner.id} className={`df-banner ${banner.kind} ${banner.team ?? ''} ${banner.side ?? ''}`} role="status">
          <b>{banner.title}</b>
          {banner.sub && <span>{banner.sub}</span>}
          {banner.mvp && <em><i>★ MVP</i> {banner.mvp}</em>}
        </div>
      )}
      {df.bombZone && df.phase === 'live' && <div className="df-bomb-drop mono"><C4Glyph size={14} /> Bomb dropped — {df.bombZone}</div>}

      {/* ============ PLANT / DEFUSE PROGRESS ============ */}
      {(df.plantProgress > 0 || (df.defuseProgress > 0 && (df.defuserIsPlayer || df.side === 'defend' || df.playerDead))) && (
        <div className={`df-progress ${df.plantProgress > 0 ? 'plant' : 'defuse'}`}>
          <span>{df.plantProgress > 0 ? 'Arming the bomb' : df.defuserIsPlayer ? `Defusing${df.defuseTotal <= 5 ? ' · kit' : ''}` : 'Teammate defusing'}</span>
          <div className="df-progress-bar"><i style={{ width: `${Math.round((df.plantProgress || df.defuseProgress) * 100)}%` }} /></div>
          {df.defuseProgress > 0 && planted && <em className="mono tabular">{(df.defuseTotal * (1 - df.defuseProgress)).toFixed(1)}s / {df.bombTimeLeft.toFixed(1)}s</em>}
        </div>
      )}
      {df.prompt && !df.playerDead && <div className="df-prompt mono">{df.prompt}</div>}

      {/* ============ MONEY + KIT (left, above vitals) ============ */}
      {!df.playerDead && (
        <div className="df-wallet">
          <span className="df-money mono tabular">${df.money.toLocaleString('en-US')}</span>
          {df.buyOpen && df.inBuyZone && <span className="df-buyhint mono"><b className="keycap">B</b> Buy · {Math.ceil(df.buyTimeLeft)}s</span>}
          <span className="df-kit">
            <span className={df.armor ? 'on' : ''} title={df.armor === 2 ? 'Kevlar + helmet' : df.armor ? 'Kevlar' : 'No armor'}><ArmorGlyph tier={df.armor} /></span>
            {df.kit && <span className="on" title="Defuse kit"><KitGlyph /></span>}
            {df.hasBomb && <span className="on bomb" title="You carry the bomb — 5 to drop"><C4Glyph size={18} /><em className="mono">5</em></span>}
          </span>
        </div>
      )}

      {/* ============ DEAD / SPECTATING ============ */}
      {df.playerDead && df.phase !== 'ended' && (
        <div className="df-spec" role="status">
          {hud.spectating ? (
            <>
              <span className="df-spec-k mono">Spectating</span>
              <b className={hud.spectating.team}>{hud.spectating.name}</b>
              <span className="mono tabular">{hud.spectating.hp} HP · {hud.spectating.weapon}</span>
              <span className="df-spec-hint mono">Left click next · right click previous</span>
            </>
          ) : (
            <>
              <span className="df-spec-k mono">Eliminated</span>
              <b>You are out this round</b>
              <span className="df-spec-hint mono">{df.phase === 'over' ? 'Next round soon' : 'Click to spectate a teammate'}</span>
            </>
          )}
        </div>
      )}

      {/* first rounds: the mode's controls, while you shop */}
      {df.round <= 2 && df.phase === 'freeze' && !df.playerDead && (
        <div className="onboard-strip hud-chip df-onboard" role="status">
          <span className="keycap">B</span> Buy
          <i /><span className="keycap">X</span> {df.side === 'attack' ? 'Hold to plant' : 'Hold to defuse'} · tap to pick up
          <i /><span className="keycap">Z</span> Smoke
          <i /><span className="keycap">5</span> Drop bomb
          <i /><span className="keycap">6·7</span> Call A · B
          <i /><span className="keycap">8</span> Follow me
          <i /><span className="keycap">Tab</span> Scores
        </div>
      )}

      {showBoard && <DefusalBoard df={df} />}
    </>
  );
}
