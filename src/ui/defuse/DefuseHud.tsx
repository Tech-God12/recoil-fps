// Recoil FPS — Bomb Defusal HUD: round scorebar, bomb state, plant/defuse
// progress, round banners, spectator strip and the Tab scoreboard.
import type { DefuseHud as DefuseHudState } from '../../game/engine';
import type { CombatantStat } from '../../game/defuse/director';
import type { RoundEndReason, RoundRecord } from '../../game/defuse/rules';

export interface DefuseFx {
  start: { id: number; round: number; side: 'attack' | 'defend'; pistol: boolean; matchPoint: 'alpha' | 'bravo' | null; suddenDeath: boolean; lastOfHalf: boolean; halftimeReset: boolean } | null;
  go: { id: number } | null;
  end: { id: number; won: boolean; reasonText: string; reason: RoundEndReason; mvp: string; mvpWhy: string; income: number; halftime: boolean; over: boolean; clutch: number; alpha: number; bravo: number; suddenDeath: boolean } | null;
  bomb: { id: number; text: string; tone: 'bad' | 'good' | 'info' } | null;
  clutch: { id: number; vs: number } | null;
  pops: { id: number; amount: number; reason: string }[];
}
export const emptyDefuseFx = (): DefuseFx => ({ start: null, go: null, end: null, bomb: null, clutch: null, pops: [] });

const clock = (t: number) => {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const money = (n: number) => `$${n.toLocaleString('en-US')}`;

/** Inline C4 glyph (keeps the HUD asset-free). */
export function BombGlyph({ size = 18, lit = false }: { size?: number; lit?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="c4-glyph">
      <rect x="2" y="7" width="20" height="12" rx="1.5" fill="#5E5B36" stroke="#1A1A12" strokeWidth="1" />
      <rect x="2" y="9.5" width="20" height="2.2" fill="#2E2C26" />
      <rect x="2" y="14.5" width="20" height="2.2" fill="#2E2C26" />
      <rect x="7" y="4.5" width="10" height="5" rx="0.8" fill="#161616" />
      <rect x="8.2" y="5.6" width="5.2" height="2" fill="#2D6E35" />
      <circle cx="15.6" cy="6.6" r="1.05" fill={lit ? '#FF4A32' : '#5A1510'} />
    </svg>
  );
}

const REASON_ICON: Record<RoundEndReason, string> = { elimination: '✕', bomb: '✹', defuse: '✂', time: '◷' };

function RoundHistory({ history, half, maxRounds }: { history: RoundRecord[]; half: number; maxRounds: number }) {
  const cells = Array.from({ length: Math.max(maxRounds, history.length) }, (_, i) => history[i] ?? null);
  return (
    <div className="df-history" aria-label="Round history">
      {cells.map((r, i) => (
        <span key={i} className={`df-hcell ${r ? (r.winner === 'alpha' ? 'a' : 'b') : 'empty'} ${i === half ? 'half' : ''}`} title={r ? `Round ${r.round}: ${r.winner.toUpperCase()} — ${r.reason} (MVP ${r.mvp})` : `Round ${i + 1}`}>
          {r ? REASON_ICON[r.reason] : i + 1}
        </span>
      ))}
    </div>
  );
}

export function DefuseBoard({ d }: { d: DefuseHudState }) {
  const half = Math.floor(d.maxRounds / 2);
  const rows = (team: 'alpha' | 'bravo') => d.roster.filter(r => r.team === team)
    .sort((a, b) => b.kills - a.kills || b.adr - a.adr || a.deaths - b.deaths);
  const Row = ({ r }: { r: CombatantStat }) => (
    <div className={`df-brow ${r.you ? 'you' : ''} ${r.alive ? '' : 'dead'}`}>
      <span className="nm">
        {r.hasBomb && <BombGlyph size={13} />}
        {r.kit && <i className="kit" title="Defuse kit">✂</i>}
        {r.you ? 'YOU' : r.name}
      </span>
      <span className="wp">{r.alive ? r.weapon : '—'}{r.alive && r.armor ? <em>{r.armor === 2 ? ' ⬢' : ' ◍'}</em> : null}</span>
      <span className="mn">{r.team === 'alpha' ? money(r.money) : '—'}</span>
      <span>{r.kills}</span><span>{r.assists}</span><span>{r.deaths}</span>
      <span>{r.adr}</span>
      <span>{r.kills ? Math.round(r.headshots / r.kills * 100) : 0}%</span>
      <span className="mvp">{r.mvps ? `★${r.mvps > 1 ? r.mvps : ''}` : ''}</span>
    </div>
  );
  const Head = () => (
    <div className="df-brow head"><span className="nm">OPERATOR</span><span className="wp">KIT</span><span className="mn">CASH</span><span>K</span><span>A</span><span>D</span><span>ADR</span><span>HS</span><span className="mvp">MVP</span></div>
  );
  const alphaSide = d.side === 'attack' ? 'ATTACK' : 'DEFEND';
  const bravoSide = d.side === 'attack' ? 'DEFEND' : 'ATTACK';
  return (
    <div className="df-board" role="dialog" aria-label="Match scoreboard">
      <div className="df-board-top">
        <span className="alpha">ALPHA <small>{alphaSide}</small><b className="tabular">{d.alphaScore}</b></span>
        <span className="mid mono">BOMB DEFUSAL · WAREHOUSE<br />ROUND {d.round} / {d.maxRounds} · FIRST TO {d.winTarget}</span>
        <span className="bravo"><b className="tabular">{d.bravoScore}</b><small>{bravoSide}</small> BRAVO</span>
      </div>
      <RoundHistory history={d.history} half={half} maxRounds={d.maxRounds} />
      <div className="df-board-team alpha"><Head />{rows('alpha').map(r => <Row key={r.name} r={r} />)}</div>
      <div className="df-board-team bravo"><Head />{rows('bravo').map(r => <Row key={r.name} r={r} />)}</div>
      <span className="df-board-hint mono">HOLD TAB · ✕ ELIMINATION · ✹ BOMB · ✂ DEFUSE · ◷ TIME · NEXT LOSS BONUS {money(d.nextLoss)}</span>
    </div>
  );
}

export default function DefuseHud({ d, fx }: { d: DefuseHudState; fx: DefuseFx }) {
  const alphaPips = d.roster.filter(r => r.team === 'alpha');
  const bravoPips = d.roster.filter(r => r.team === 'bravo');
  const planted = d.bomb.state === 'planted';
  const beepMs = Math.max(160, 1000 - d.bomb.urgency * 850);
  const lowTime = d.phase === 'live' && d.timer < 20;
  const alphaSide = d.side === 'attack' ? 'ATK' : 'DEF';
  const bravoSide = d.side === 'attack' ? 'DEF' : 'ATK';
  const me = d.roster.find(r => r.you);
  const dead = me ? !me.alive : false;

  return (
    <>
      {/* ============ ROUND SCOREBAR ============ */}
      <div className="df-top" aria-label="Round score">
        <div className="df-top-row">
          <div className="df-team alpha">
            <span className="side">{alphaSide}</span>
            <span className="lbl">ALPHA</span>
            <span className="num tabular">{d.alphaScore}</span>
          </div>
          <div className={`df-clock ${planted ? 'planted' : ''} ${d.phase === 'freeze' ? 'freeze' : ''} ${lowTime ? 'low' : ''}`}>
            {planted ? (
              <span className="df-bombclock" style={{ animationDuration: `${beepMs}ms` }}>
                <BombGlyph size={22} lit />
                <b>{d.bomb.site}</b>
              </span>
            ) : d.bomb.state === 'defused' ? (
              <span className="df-cstate good">DEFUSED</span>
            ) : d.bomb.state === 'exploded' ? (
              <span className="df-cstate bad">DETONATED</span>
            ) : (
              <b className="tabular">{d.phase === 'post' ? '0:00' : clock(d.timer)}</b>
            )}
            <i>{d.phase === 'freeze' ? 'BUY PHASE' : d.suddenDeath ? 'SUDDEN DEATH' : `ROUND ${d.round}/${d.maxRounds}`}</i>
          </div>
          <div className="df-team bravo">
            <span className="num tabular">{d.bravoScore}</span>
            <span className="lbl">BRAVO</span>
            <span className="side">{bravoSide}</span>
          </div>
        </div>
        <div className="df-pips" aria-hidden="true">
          <span className="grp a">
            {alphaPips.map(p => <i key={p.name} className={`${p.alive ? '' : 'dead'} ${p.you ? 'you' : ''} ${p.hasBomb ? 'bomb' : ''}`} title={p.name} />)}
          </span>
          <span className="vs mono">{d.alive.alpha} v {d.alive.bravo}</span>
          <span className="grp b">
            {bravoPips.map(p => <i key={p.name} className={p.alive ? '' : 'dead'} title={p.name} />)}
          </span>
        </div>
        {d.matchPoint && d.phase !== 'post' && <span className={`df-mp ${d.matchPoint === 'alpha' ? 'a' : 'b'}`}>MATCH POINT</span>}
      </div>

      {/* ============ BOMB MARKER (screen-projected) ============ */}
      {d.bombScreen && (
        <div className={`df-bombmark ${d.bombScreen.planted ? 'planted' : ''} ${d.bombScreen.behind ? 'behind' : ''}`}
          style={{ left: `${d.bombScreen.x * 100}%`, top: `${d.bombScreen.y * 100}%`, animationDuration: d.bombScreen.planted ? `${beepMs}ms` : undefined }}>
          <BombGlyph size={20} lit={d.bombScreen.planted} />
          <span className="mono">{Math.round(d.bombScreen.dist)}m</span>
        </div>
      )}

      {/* ============ PLANT / DEFUSE PROGRESS ============ */}
      {d.action && (
        <div className={`df-action ${d.action.kind}`} role="status">
          <span className="ttl">{d.action.kind === 'plant' ? 'ARMING C4' : d.kit.kit ? 'DEFUSING · KIT' : 'DEFUSING'}</span>
          <div className="bar"><span style={{ width: `${d.action.progress * 100}%` }} /></div>
          <span className="keys mono">{d.action.kind === 'plant' ? '7 3 5 5 6 0 8'.slice(0, 1 + Math.floor(d.action.progress * 13)) : `${Math.round(d.action.progress * 100)}%`}</span>
        </div>
      )}
      {!d.action && d.hint && <div className="df-hint" role="status"><span className="keycap">X</span>{d.hint.replace('HOLD [X] ', 'HOLD ')}</div>}

      {/* ============ BOMB CARRIER BADGE ============ */}
      {d.bomb.carrierYou && !dead && (
        <div className={`df-carrier ${d.inSite ? 'insite' : ''}`}>
          <BombGlyph size={20} />
          <span>{d.inSite ? `IN SITE ${d.inSite} — HOLD X TO PLANT` : 'YOU HAVE THE BOMB · PLANT ON A OR B'}</span>
          <span className="keycap">H</span><em className="drop">DROP</em>
        </div>
      )}

      {/* ============ BUY CHIP ============ */}
      {d.buyOpen && !dead && (
        <div className="df-buychip mono" role="status">
          <span className="keycap">B</span> BUY MENU <b>{money(d.money)}</b> <em>{clock(d.buyTime)}</em>
        </div>
      )}

      {/* ============ MONEY POPS ============ */}
      <div className="df-pops" aria-hidden="true">
        {fx.pops.map(p => <span key={p.id} className="df-pop mono">+{money(p.amount)} <em>{p.reason}</em></span>)}
      </div>

      {/* ============ SPECTATOR ============ */}
      {dead && d.phase !== 'post' && d.phase !== 'over' && (
        <div className="df-spec" role="status">
          <span className="ttl">ELIMINATED</span>
          {d.spectating
            ? <span className="who">SPECTATING <b>{d.spectating}</b><em><span className="keycap">LMB</span> NEXT · <span className="keycap">RMB</span> PREV</em></span>
            : <span className="who">WAITING FOR THE NEXT ROUND…</span>}
        </div>
      )}

      {/* ============ ROUND START ============ */}
      {fx.start && !fx.end && (
        <div key={fx.start.id} className="df-start">
          {fx.start.halftimeReset && <span className="pre">SIDES SWITCHED</span>}
          <b>ROUND {fx.start.round}</b>
          <span className={`side ${fx.start.side}`}>{fx.start.side === 'attack' ? 'ATTACK · PLANT THE BOMB' : 'DEFEND · PROTECT BOTH SITES'}</span>
          {(fx.start.pistol || fx.start.matchPoint || fx.start.suddenDeath || fx.start.lastOfHalf) && (
            <span className="tag">
              {fx.start.suddenDeath ? 'SUDDEN DEATH — $10,000 EACH' : fx.start.matchPoint ? (fx.start.matchPoint === 'alpha' ? 'MATCH POINT — CLOSE IT OUT' : 'THEIR MATCH POINT — MUST WIN') : fx.start.pistol ? 'PISTOL ROUND' : 'LAST ROUND OF THE HALF'}
            </span>
          )}
        </div>
      )}
      {fx.go && !fx.start && !fx.end && <div key={fx.go.id} className="df-go">{d.side === 'attack' ? 'GO GO GO' : 'HOLD'}</div>}

      {/* ============ BOMB EVENT BANNER ============ */}
      {fx.bomb && !fx.end && <div key={fx.bomb.id} className={`df-bombbanner ${fx.bomb.tone}`}><BombGlyph size={18} lit={fx.bomb.tone === 'bad' || fx.bomb.tone === 'info'} />{fx.bomb.text}</div>}

      {/* ============ CLUTCH ============ */}
      {fx.clutch && !fx.end && (
        <div key={fx.clutch.id} className="df-clutch"><b>1 v {fx.clutch.vs}</b><span>CLUTCH SITUATION</span></div>
      )}

      {/* ============ ROUND END ============ */}
      {fx.end && (
        <div key={fx.end.id} className={`df-end ${fx.end.won ? 'won' : 'lost'}`} role="status">
          <span className="rsn">{REASON_ICON[fx.end.reason]} {fx.end.reasonText.toUpperCase()}</span>
          <b>{fx.end.over ? (fx.end.won ? 'MATCH WON' : 'MATCH LOST') : fx.end.won ? 'ROUND WON' : 'ROUND LOST'}</b>
          <span className="score tabular"><i className="a">{fx.end.alpha}</i> — <i className="b">{fx.end.bravo}</i></span>
          {fx.end.clutch > 0 && <span className="clutch">CLUTCH 1v{fx.end.clutch}</span>}
          <span className="mvp">★ MVP <b>{fx.end.mvp}</b> <em>{fx.end.mvpWhy}</em></span>
          {!fx.end.over && <span className="inc mono">+{money(fx.end.income)} ROUND INCOME</span>}
          {fx.end.halftime && <span className="half">HALFTIME — SWITCHING SIDES · ECONOMY RESET</span>}
          {fx.end.suddenDeath && <span className="half">TIED — SUDDEN DEATH DECIDER</span>}
        </div>
      )}
    </>
  );
}
