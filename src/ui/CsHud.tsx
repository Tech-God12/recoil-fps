// Recoil FPS — DUSTYARD TACTICAL HUD layer.
//
// Everything competitive reads here: the MR8 scoreboard with the phase clock,
// freeze-time banner, wallet + armor, the planted-bomb countdown, the death
// spectate bar, and round banners. Mounts on hud.cs, next to (not instead of)
// the standard combat HUD — same layering rule as the Warehouse TDM HUD.
import type { CsHudState } from '../game/cs/manager';

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const ARMOR_ICON: Record<number, string> = { 0: '○', 1: '◍', 2: '⬢' };

function RosterRow({ row, bomb }: { row: CsHudState['alpha'][number]; bomb: boolean }) {
  return (
    <span className={`cs-row ${row.alive ? '' : 'dead'} ${row.you ? 'mine' : ''}`} title={`${row.name} · $${row.money}`}>
      {bomb && <i className="cs-bomb-tag" aria-label="C4 carrier">▮</i>}
      <i className="cs-armor" data-armor={row.armor}>{ARMOR_ICON[row.armor] ?? '○'}</i>
      <b>{row.you ? `${row.name}*` : row.name}</b>
      <em className="mono">{row.kills}</em>
      <u className="cs-money-tag mono">${row.money >= 1000 ? `${(row.money / 1000).toFixed(1)}k` : row.money}</u>
    </span>
  );
}

export default function CsHud({ cs }: { cs: CsHudState }) {
  const carrier = cs.bravo.find(b => b.hasBomb && b.alive);
  // Phase clock: freeze counts down the buy window, planted counts the C4 fuse.
  const phaseClock = cs.phase === 'FREEZE' ? cs.freezeLeft
    : cs.phase === 'PLANTED' ? cs.bombTimeLeft
      : cs.phase === 'ROUND_END' ? cs.timeLeft : cs.roundTimeLeft;
  const urgent = cs.phase === 'PLANTED' ? cs.bombTimeLeft <= 10 : phaseClock <= 15;
  const result = cs.roundResult;
  return (
    <>
      {/* ============ SCOREBOARD (top centre) ============ */}
      <div className="cs-board" role="status" aria-label="Dustyard tactical scoreboard">
        <span className="cs-board-label mono">DUSTYARD TACTICAL · MR8</span>
        <div className="cs-board-line">
          <span className={`cs-score alpha ${cs.alphaRounds > cs.bravoRounds ? 'lead' : ''}`}>{cs.alphaRounds}</span>
          <span className={`cs-clock tabular ${urgent ? 'urgent' : ''} ${cs.phase === 'PLANTED' ? 'planted' : ''}`}>
            {cs.phase === 'PLANTED' ? phaseClock.toFixed(1) : clock(phaseClock)}
          </span>
          <span className={`cs-score bravo ${cs.bravoRounds > cs.alphaRounds ? 'lead' : ''}`}>{cs.bravoRounds}</span>
        </div>
        <div className="cs-board-teams mono">
          <span>ALPHA {cs.aliveAlpha}</span>
          <span>ROUND {cs.round}/{cs.maxRounds}</span>
          <span>{cs.aliveBravo} BRAVO</span>
        </div>
        <div className="cs-roster">
          <div className="cs-roster-col alpha">
            {cs.alpha.map(row => <RosterRow key={row.name} row={row} bomb={false} />)}
          </div>
          <div className="cs-roster-col bravo">
            {cs.bravo.map(row => <RosterRow key={row.name} row={row} bomb={row.hasBomb} />)}
          </div>
        </div>
      </div>

      {/* ============ FREEZE BANNER ============ */}
      {cs.phase === 'FREEZE' && (
        <div className="cs-freeze" role="status">
          <h2 className="mono">FREEZE TIME <b className="tabular">{clock(cs.freezeLeft)}</b></h2>
          <p className="mono">Press <span className="keycap">B</span> to buy · movement unlocked at 0:00</p>
        </div>
      )}

      {/* ============ PLANTED COUNTDOWN ============ */}
      {cs.phase === 'PLANTED' && (
        <div className={`cs-planted ${cs.bombTimeLeft <= 10 ? 'final' : ''}`} role="alert">
          <span className="cs-planted-dot" aria-hidden="true" />
          C4 PLANTED · SITE {cs.site} · <b className="tabular">{cs.bombTimeLeft.toFixed(1)}s</b>
        </div>
      )}

      {/* ============ ROUND RESULT BANNER ============ */}
      {cs.phase === 'ROUND_END' && result && (
        <div className={`cs-round-banner ${result.winner === 'alpha' ? 'win' : 'lose'}`} role="status">
          <h2 className="mono">{result.winner === 'alpha' ? 'ALPHA WINS THE ROUND' : 'BRAVO WINS THE ROUND'}</h2>
          <p className="mono">
            {result.reason === 'ELIMINATION' ? 'Enemy team eliminated'
              : result.reason === 'TIME' ? 'Round time expired — bomb never planted'
                : result.reason === 'BOMB_DEFUSED' ? 'The bomb has been defused'
                  : 'The bomb detonated'}
            {' · '}{result.winner === 'alpha' ? `+ win pays $3250` : `loss bonus next round`}
          </p>
        </div>
      )}

      {/* ============ HALFTIME ============ */}
      {cs.halftime && cs.round === 9 && cs.phase === 'FREEZE' && (
        <div className="cs-halftime mono" role="status">HALFTIME — SIDES SWAPPED · MONEY KEPT</div>
      )}

      {/* ============ WALLET + ARMOR (bottom left) ============ */}
      <div className="cs-wallet mono" aria-label="Wallet and armor">
        <span className="cs-wallet-money tabular">${cs.playerMoney.toLocaleString('en-US')}</span>
        <span className="cs-wallet-armor">
          {ARMOR_ICON[cs.playerArmor] ?? '○'} {cs.playerArmor === 2 ? 210 : cs.playerArmor === 1 ? 180 : 150}
          {cs.playerKit && <i className="cs-kit" aria-label="defuse kit">✂ KIT</i>}
        </span>
        <span className="cs-loss mono" title="Team loss bonus if this round is lost">
          NEXT LOSS ${cs.nextLossBonus}
        </span>
      </div>

      {/* ============ SPECTATE BAR (dead until round end) ============ */}
      {!cs.playerAlive && cs.phase !== 'ROUND_END' && (
        <div className="cs-spectate" role="alert">
          <h2 className="mono">YOU ARE DEAD</h2>
          <p className="mono">No respawn this round · ALPHA alive <b>{Math.max(0, cs.aliveAlpha - 0)}</b> · watching</p>
        </div>
      )}

      {/* ============ C4 RADAR HOOKS: carrier chip + planted flash ============ */}
      {cs.bombVisible && cs.phase !== 'PLANTED' && (
        <div className="cs-c4-chip mono" aria-label="C4 status">
          {cs.phase === 'LIVE' && carrier ? `C4 · ${carrier.name}` : 'C4 DROPPED'}
        </div>
      )}
    </>
  );
}
