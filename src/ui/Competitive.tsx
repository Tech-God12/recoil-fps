// ============================================================================
// OPERATION BLACKOUT — the competitive front end.
//
// Everything the ranked mode puts on screen lives here so the mission HUD and
// the TDM board stay untouched:
//   * RankBadge      — ladder glyph, label and progress, reused by menu + debrief
//   * RankedSetup    — the mode's front door (rules, ladder, loadout, deploy)
//   * CompHudLayer   — in-match overlay: score, clock, charge, buy rack, spectate
//   * CompScoreboard — hold-Tab table with plants/defuses/ADR
//   * CompDebrief    — the after-action report with the rating change
// ============================================================================
import type { CompHudView, CompRackView, CompDebrief } from '../game/engine';
import type { RankView } from '../game/economy/rank';
import { RANK_GLYPH, rankFor } from '../game/economy/rank';

/** mm:ss for the round clock. */
export function compClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const SIDE_LABEL: Record<string, string> = { attack: 'ATTACK', defend: 'DEFEND' };

/* ================================================================
   RANK BADGE — one component, used by the menu, the HUD and the debrief.
   ================================================================ */
export function RankBadge({ rank, compact, delta }: { rank: RankView; compact?: boolean; delta?: number }) {
  const tier = rank.tier;
  const pct = Math.round(rank.divisionProgress * 100);
  return (
    <div className={`rank-badge tier-${tier.id} ${compact ? 'compact' : ''}`}>
      <span className="rank-glyph" aria-hidden="true">{RANK_GLYPH[tier.id]}</span>
      <span className="rank-body">
        <span className="rank-label">
          {rank.placed ? rank.label : 'PLACEMENTS'}
          {rank.placementsLeft > 0 && <em className="rank-placements">{rank.placementsLeft} LEFT</em>}
        </span>
        <span className="rank-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
        <span className="rank-rating mono">
          {rank.tier.id === 'grandmaster' ? 'MAX' : `${rank.ratingToNext} TO NEXT`}
          {typeof delta === 'number' && delta !== 0 && (
            <b className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? `+${delta}` : delta}</b>
          )}
        </span>
      </span>
    </div>
  );
}

/* ================================================================
   RANKED SETUP — the front door for OPERATION BLACKOUT.
   ================================================================ */
export function RankedSetup({ rank, rating, record, onDeploy, onBack }: {
  rank: RankView;
  rating: number;
  record: { wins: number; losses: number; draws: number; streak: number };
  onDeploy: () => void;
  onBack: () => void;
}) {
  const played = record.wins + record.losses + record.draws;
  const winRate = played ? Math.round(((record.wins + record.draws * 0.5) / played) * 100) : 0;
  return (
    <main className="blackout-root">
      <div className="blackout-scan" aria-hidden="true" />
      <header className="blackout-head">
        <div>
          <span className="map2-kicker">COMPETITIVE · RANKED</span>
          <h1 className="blackout-title">OPERATION<span>BLACKOUT</span></h1>
          <p className="blackout-sub">
            SEARCH &amp; DESTROY · 5v5 · WAREHOUSE COMPLEX<br />
            Seven rounds to take the match. One life per round. Money carries.
          </p>
        </div>
        <RankBadge rank={rank} />
      </header>

      <div className="blackout-grid">
        <section className="blackout-card">
          <h2>MATCH FORMAT</h2>
          <ul className="blackout-list">
            <li><b>7</b><span>Rounds to win the match, 12 in regulation, overtime on a tie.</span></li>
            <li><b>6</b><span>Sides swap at the half — economy and loss streaks reset.</span></li>
            <li><b>40s</b><span>Charge fuse once planted. It is the only clock that matters.</span></li>
            <li><b>3.2/10s</b><span>Plant / defuse. A defuse kit cuts the wire in five.</span></li>
          </ul>
        </section>

        <section className="blackout-card">
          <h2>ECONOMY</h2>
          <ul className="blackout-list">
            <li><b>$800</b><span>Starting money. Win rounds, plant, defuse — bank the rest.</span></li>
            <li><b>$3250</b><span>Round win. Losing pays 1400 up to 3400 on a streak.</span></li>
            <li><b>$16000</b><span>Cap. Full buys run 2700–5200 for a rifle, plus armour and utility.</span></li>
          </ul>
        </section>

        <section className="blackout-card">
          <h2>YOUR RECORD</h2>
          <div className="blackout-record">
            <span><b>{record.wins}</b>WINS</span>
            <span><b>{record.losses}</b>LOSSES</span>
            <span><b>{record.draws}</b>DRAWS</span>
            <span><b>{winRate}%</b>WIN RATE</span>
            <span className={record.streak >= 0 ? 'up' : 'down'}>
              <b>{record.streak > 0 ? `${record.streak}W` : record.streak < 0 ? `${Math.abs(record.streak)}L` : '—'}</b>STREAK
            </span>
            <span><b>{rating}</b>RATING</span>
          </div>
          <p className="blackout-note">
            Rating moves with the result, your K/D, objectives and the round margin —
            winning ugly still pays, but a clean sweep pays more.
          </p>
        </section>

        <section className="blackout-card wide">
          <h2>HOW IT PLAYS</h2>
          <div className="blackout-how">
            <div><i>1</i><span><b>BUY PHASE</b>Frozen at spawn for 15 seconds. Mouse steers the rack, number keys buy instantly, B re-opens it.</span></div>
            <div><i>2</i><span><b>EXECUTE</b>The charge is carried to site A or B. Hold the plant; the site is marked on your radar the moment it goes down.</span></div>
            <div><i>3</i><span><b>HOLD OR RETAKE</b>Defenders hear the charge beep and rotate. Attackers watch the entrances. Nobody respawns until the round is decided.</span></div>
            <div><i>4</i><span><b>THE CLOCK</b>Every kill, plant and defuse pays the person who did it. The team that manages its wallet wins the long game.</span></div>
          </div>
        </section>
      </div>

      <div className="blackout-cta">
        <button className="deploy-btn" onClick={onDeploy}>DEPLOY TO BLACKOUT</button>
        <button className="menu-secondary-btn" onClick={onBack}>BACK</button>
      </div>
    </main>
  );
}

/* ================================================================
   BUY RACK — the phase's shopping panel. Driven by the engine cursor.
   ================================================================ */
function BuyRack({ comp }: { comp: CompHudView }) {
  const cols = 5;
  const rows: CompRackView[][] = [];
  for (let i = 0; i < comp.rack.length; i += cols) rows.push(comp.rack.slice(i, i + cols));
  return (
    <div className="comp-buy" role="dialog" aria-label="Buy menu">
      <div className="comp-buy-head">
        <span className="mono">// LOADOUT</span>
        <b className="comp-buy-money tabular">${comp.money}</b>
        <span className="mono comp-buy-hint">MOUSE AIM · CLICK / 1–9 BUY · B CLOSE</span>
      </div>
      <div className="comp-buy-grid">
        {rows.map((row, r) => (
          <div className="comp-buy-row" key={r}>
            {row.map((item, c) => {
              const index = r * cols + c;
              const armed = index === comp.buyCursor;
              const state = !item.legal ? 'illegal' : !item.affordable ? 'poor' : 'ok';
              return (
                <div key={item.id} className={`comp-buy-card tier${item.tier} ${state} ${armed ? 'armed' : ''}`}>
                  <span className="comp-buy-key mono">{item.key}</span>
                  <span className="comp-buy-name">{item.name}</span>
                  <span className="comp-buy-stat mono">{item.stat}</span>
                  <span className="comp-buy-price mono">${item.price}</span>
                  {armed && <span className="comp-buy-blurb">{item.blurb}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================
   MATCH SCOREBOARD — hold Tab.
   ================================================================ */
export function CompScoreboard({ comp }: { comp: CompHudView }) {
  const rows = [...comp.roster].sort((a, b) =>
    (a.team === b.team ? 0 : a.team === comp.playerTeam ? -1 : 1)
    || b.kills - a.kills || b.adr - a.adr);
  const leader = rows.reduce((best, r) => (r.mvps > (best?.mvps ?? -1) ? r : best), rows[0]);
  const Row = ({ r }: { r: typeof rows[number] }) => (
    <div className={`tdm-board-row ${r.you ? 'you' : ''} ${r.alive ? '' : 'dead'}`}>
      <span className="tdm-board-name">
        {r === leader && <i className="mvp" title="Round MVP">★</i>}
        {r.name}{r.you ? ' (YOU)' : ''}{!r.alive && <em className="comp-dead">DOWN</em>}
      </span>
      <span className="tabular">{r.kills}</span>
      <span className="tabular">{r.deaths}</span>
      <span className="tabular">{r.headshots}</span>
      <span className="tabular">{r.plants}</span>
      <span className="tabular">{r.defuses}</span>
      <span className="tabular">{r.adr}</span>
      <span className="tabular comp-money">${r.money}</span>
    </div>
  );
  return (
    <div className="tdm-board comp-board" role="dialog" aria-label="Competitive scoreboard">
      <div className="tdm-board-title">
        <span className={`alpha ${comp.playerTeam === 'alpha' ? 'mine' : ''}`}>ALPHA <b className="tabular">{comp.score.alpha}</b></span>
        <span className="mid">OPERATION BLACKOUT · ROUND {comp.round}</span>
        <span className={`bravo ${comp.playerTeam === 'bravo' ? 'mine' : ''}`}><b className="tabular">{comp.score.bravo}</b> BRAVO</span>
      </div>
      <div className="comp-pips" aria-hidden="true">
        {Array.from({ length: Math.max(comp.history.length, comp.round) }, (_, i) => (
          <span key={i} className={`pip ${comp.history[i] ?? 'pending'}`} />
        ))}
      </div>
      <div className="tdm-board-cols">
        <div className="comp-board-full">
          <div className="tdm-board-row head">
            <span className="tdm-board-name">OPERATOR</span><span>K</span><span>D</span><span>HS</span>
            <span>P</span><span>D</span><span>ADR</span><span>$</span>
          </div>
          {rows.map(r => <Row key={r.id} r={r} />)}
        </div>
      </div>
      <span className="tdm-board-hint mono">HOLD TAB · P PLANTS · D DEFUSES · ADR AVERAGE DAMAGE PER ROUND</span>
    </div>
  );
}

/* ================================================================
   IN-MATCH OVERLAY
   ================================================================ */
export function CompHudLayer({ comp }: { comp: CompHudView }) {
  const attacking = comp.playerSide === 'attack';
  const bomb = comp.bomb;
  const action = comp.action;
  const roundOver = comp.phase === 'roundEnd' || comp.phase === 'matchEnd';
  const fuseLow = bomb.fuse <= 10;
  const clock = comp.phase === 'buy' ? comp.timeLeft : bomb.state === 'planted' ? bomb.fuse : comp.timeLeft;

  return (
    <div className="comp-layer pointer-events-none select-none">
      {/* ---------- top bar: round, score pips, clock ---------- */}
      <div className="comp-topbar">
        <span className={`comp-side ${comp.playerSide}`}>{SIDE_LABEL[comp.playerSide]}</span>
        <div className="comp-score">
          <span className={`side alpha ${comp.playerTeam === 'alpha' ? 'mine' : ''}`}>
            <b className="tabular">{comp.score.alpha}</b>ALPHA
          </span>
          <div className="comp-pips" aria-hidden="true">
            {Array.from({ length: Math.max(12, comp.history.length) }, (_, i) => (
              <span key={i} className={`pip ${comp.history[i] ?? 'pending'}`} />
            ))}
          </div>
          <span className={`side bravo ${comp.playerTeam === 'bravo' ? 'mine' : ''}`}>
            BRAVO<b className="tabular">{comp.score.bravo}</b>
          </span>
        </div>
        <div className={`comp-clock ${fuseLow && bomb.state === 'planted' ? 'hot' : ''} ${comp.phase === 'buy' ? 'buy' : ''}`}>
          <b className="tabular">{compClock(clock)}</b>
          <i>{comp.phase === 'buy' ? 'BUY PHASE' : bomb.state === 'planted' ? 'CHARGE ARMED' : `ROUND ${comp.round}`}</i>
        </div>
      </div>

      {/* ---------- alive / wallet strip ---------- */}
      <div className="comp-strip">
        <span className="comp-alive alpha">{comp.alive.alpha}<i>UP</i></span>
        <span className="comp-vs">VS</span>
        <span className="comp-alive bravo">{comp.alive.bravo}<i>UP</i></span>
        <span className="comp-wallet mono">${comp.money}</span>
        {comp.armor > 0 && <span className="comp-kit mono">🛡 {Math.round(comp.armor)}{comp.helmet ? '+' : ''}</span>}
        {comp.kit && <span className="comp-kit mono">✂ KIT</span>}
        {attacking
          ? <span className="comp-call mono">TARGET SITE {comp.siteCall}</span>
          : <span className="comp-call mono">DEFEND · ROTATE ON CALL</span>}
      </div>

      {/* ---------- the charge ---------- */}
      {bomb.state === 'planted' && (
        <div className={`comp-charge ${fuseLow ? 'hot' : ''}`}>
          <span className="comp-charge-label">CHARGE ARMED · SITE {bomb.site ?? '—'}</span>
          <span className="comp-charge-fuse tabular">{bomb.fuse.toFixed(1)}s</span>
          <span className="comp-charge-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(0, Math.min(100, (bomb.fuse / 40) * 100))}%` }} />
          </span>
        </div>
      )}
      {bomb.state === 'dropped' && (
        <div className="comp-charge dropped"><span className="comp-charge-label">CHARGE IS DOWN — RECOVER IT</span></div>
      )}

      {/* ---------- objective prompt / action progress ---------- */}
      {action && (
        <div className="comp-action">
          <span className="comp-action-label">
            {action.kind === 'plant' ? 'PLANTING' : 'DEFUSING'} · {action.actorId === 'YOU' ? 'YOU' : action.actorId}
          </span>
          <span className="comp-action-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (action.progress / action.duration) * 100)}%` }} />
          </span>
        </div>
      )}
      {!action && comp.prompt && !roundOver && !comp.buyOpen && (
        <div className={`comp-prompt ${comp.prompt.ok ? 'ok' : 'wait'}`}>
          <span>{comp.prompt.text}</span>
        </div>
      )}

      {/* ---------- spectate ---------- */}
      {comp.spectate && (
        <div className="comp-spectate">
          <span className="mono">ELIMINATED — WATCHING</span>
          <b>{comp.spectate.name}</b>
          <span className="mono">CLICK TO CYCLE</span>
        </div>
      )}

      {/* ---------- round banner ---------- */}
      {roundOver && comp.roundResult && (
        <div className={`comp-banner ${comp.roundResult.winner === comp.playerTeam ? 'win' : 'loss'}`}>
          <b>{comp.roundResult.winner === comp.playerTeam ? 'ROUND WON' : 'ROUND LOST'}</b>
          <span>{comp.roundResult.reason.replace('-', ' ').toUpperCase()}</span>
        </div>
      )}
      {comp.matchResult && (
        <div className={`comp-banner match ${comp.matchResult.draw ? 'draw' : comp.matchResult.winner === comp.playerTeam ? 'win' : 'loss'}`}>
          <b>{comp.matchResult.draw ? 'DRAW' : comp.matchResult.winner === comp.playerTeam ? 'VICTORY' : 'DEFEAT'}</b>
          <span>{comp.score.alpha} — {comp.score.bravo}</span>
        </div>
      )}

      {/* ---------- buy rack ---------- */}
      {comp.buyOpen && comp.phase === 'buy' && <BuyRack comp={comp} />}
    </div>
  );
}

/* ================================================================
   DEBRIEF — the after-action report, including the ladder maths.
   ================================================================ */
export function CompDebriefPanel({ report }: { report: CompDebrief }) {
  const after = rankFor(report.ratingAfter);
  return (
    <div className="comp-debrief">
      <div className="comp-debrief-head">
        <b className={report.draw ? 'draw' : report.win ? 'win' : 'loss'}>
          {report.draw ? 'DRAW' : report.win ? 'OPERATION SUCCESSFUL' : 'OPERATION FAILED'}
        </b>
        <span className="mono">SITE {report.score.alpha} — {report.score.bravo} · {report.rounds} ROUNDS</span>
      </div>
      <div className="comp-debrief-grid">
        <div><b className="tabular">{report.kills}</b><span>KILLS</span></div>
        <div><b className="tabular">{report.deaths}</b><span>DEATHS</span></div>
        <div><b className="tabular">{report.adr}</b><span>ADR</span></div>
        <div><b className="tabular">{report.plants}</b><span>PLANTS</span></div>
        <div><b className="tabular">{report.defuses}</b><span>DEFUSES</span></div>
        <div><b className="tabular">{report.mvps}</b><span>ROUND MVPS</span></div>
      </div>
      <div className="comp-debrief-rank">
        <span className="mono">{report.rankBefore} → {report.rankAfter}</span>
        <RankBadge rank={after} compact delta={report.delta} />
        <span className="comp-debrief-math mono">
          OUTCOME {report.breakdown.outcome > 0 ? '+' : ''}{report.breakdown.outcome} · PERFORMANCE {report.breakdown.performance > 0 ? '+' : ''}{report.breakdown.performance} · MARGIN {report.breakdown.margin > 0 ? '+' : ''}{report.breakdown.margin}
          {report.placement && ' · PLACEMENT ×1.75'}
        </span>
      </div>
    </div>
  );
}
