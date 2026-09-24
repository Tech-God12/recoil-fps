// Recoil FPS — in-game HUD (VOLT PROTOCOL)
import { useEffect, useState } from 'react';
import type { GameSettings, HudState, TdmRosterEntry } from '../game/engine';
import { Reticle } from './Settings';
import MissionObjective, { missionClock } from './MissionObjective';
import ScopeView, { type ScopeControls } from './ScopeView';
import { NukeCountdown, StreakActive, StreakMessage, StreakRail, StrikeDesignator } from './Streaks';

export interface HudFx {
  hitmark: { id: number; kill: boolean } | null;
  feed: { id: number; text: string; headshot: boolean; tdm?: { killer: string; weapon: string; victim: string; killerTeam: 'alpha' | 'bravo'; zone?: string } }[];
  dmgArcs: { id: number; dir: number; opacity: number }[];
  scorePops: { id: number; text: string; headshot: boolean; cash?: boolean }[];
  banner: { id: number; label: string } | null;
  callout: { id: number; text: string } | null;
  flashPow: number;
  missionBanner: { id: number; title: string; index: number } | null;
  streakMsg: { id: number; text: string } | null;
  nukeFlash: number | null;
}

/* ================================================================
   TAB SCOREBOARD — full match table, held open with Tab.
   Rows sorted by kills (headshots break ties); the match MVP gets a star.
   ================================================================ */
function TdmFullBoard({ tdm }: { tdm: NonNullable<HudState['tdm']> }) {
  const sorted = (team: 'alpha' | 'bravo') =>
    tdm.roster.filter(r => r.team === team)
      .sort((a, b) => b.kills - a.kills || b.headshots - a.headshots || a.deaths - b.deaths);
  const mvpKills = Math.max(...tdm.roster.map(r => r.kills));
  const Row = ({ r }: { r: TdmRosterEntry }) => (
    <div className={`tdm-board-row ${r.you ? 'you' : ''} ${r.dead ? 'dead' : ''} ${r.onFire ? 'fire' : ''}`}>
      <span className="tdm-board-name">
        {mvpKills > 0 && r.kills === mvpKills && <i className="mvp" title="Match leader">★</i>}
        <em aria-hidden="true">{r.armorIcon}</em>{r.name}{r.onFire ? ' 🔥' : ''}{r.you ? ' (YOU)' : ''}
      </span>
      <span className="tabular">{r.kills}</span>
      <span className="tabular">{r.deaths}</span>
      <span className="tabular">{r.headshots}</span>
      <span className="tabular kd">{r.deaths ? (r.kills / r.deaths).toFixed(1) : r.kills.toFixed(1)}</span>
    </div>
  );
  const Head = () => (
    <div className="tdm-board-row head">
      <span className="tdm-board-name">OPERATOR</span><span>K</span><span>D</span><span>HS</span><span>K/D</span>
    </div>
  );
  return (
    <div className="tdm-board" role="dialog" aria-label="Match scoreboard">
      <div className="tdm-board-title">
        <span className="alpha">ALPHA <b className="tabular">{tdm.alphaScore}</b></span>
        <span className="mid">WAREHOUSE TDM · {missionClock(tdm.timeLeft)}</span>
        <span className="bravo"><b className="tabular">{tdm.bravoScore}</b> BRAVO</span>
      </div>
      <div className="tdm-board-cols">
        <div className="tdm-board-team alpha">
          <Head />
          {sorted('alpha').map(r => <Row key={r.name} r={r} />)}
        </div>
        <div className="tdm-board-team bravo">
          <Head />
          {sorted('bravo').map(r => <Row key={r.name} r={r} />)}
        </div>
      </div>
      <span className="tdm-board-hint mono">HOLD TAB · ★ MATCH LEADER</span>
    </div>
  );
}

export default function Hud({ hud, s, fx, active, ...scopeControls }: { hud: HudState; s: GameSettings; fx: HudFx; active?: boolean } & ScopeControls) {
  // Hold-Tab scoreboard (TDM only). Listens on window so it works regardless
  // of pointer lock; Tab's default focus-move is suppressed while playing.
  const [showBoard, setShowBoard] = useState(false);
  const isTdm = !!hud.tdm && active !== false;
  useEffect(() => {
    if (!isTdm) { setShowBoard(false); return; }
    const down = (e: KeyboardEvent) => { if (e.code === 'Tab') { e.preventDefault(); setShowBoard(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Tab') { e.preventDefault(); setShowBoard(false); } };
    const blur = () => setShowBoard(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [isTdm]);

  const maxHp = hud.tdm?.maxHp ?? 100;
  const lowHp = hud.hp < maxHp * 0.35;
  const vig = hud.hp < maxHp * 0.6 ? 1 - hud.hp / (maxHp * 0.6) : 0;
  const magPct = hud.magSize ? hud.mag / hud.magSize : 0;
  const segs = Math.min(hud.magSize || 30, 30);
  const filled = Math.round(magPct * segs);
  const displayedMag = hud.reloading && hud.reloadStage === 'magOut' ? 0 : hud.mag;
  const fpsColor = hud.fps >= 55 ? 'var(--olive)' : hud.fps >= 35 ? 'var(--brass)' : 'var(--blood)';
  const hpSegs = 10;
  const hpFilled = Math.min(hpSegs, Math.max(0, Math.ceil(hud.hp / maxHp * hpSegs)));

  return (
    <div className="hud-root pointer-events-none select-none">
      {/* HUD frame corners */}
      <span className="hud-corner tl" /><span className="hud-corner tr" />
      <span className="hud-corner bl" /><span className="hud-corner br" />

      {/* damage vignette */}
      {vig > 0 && (
        <div className={`absolute inset-0 ${lowHp ? 'hp-pulse' : ''}`}
          style={{ boxShadow: `inset 0 0 ${120 + vig * 200}px rgba(200,50,30,${0.22 + vig * 0.5})` }} />
      )}
      {/* flashbang */}
      <div className="absolute inset-0 bg-white" style={{ opacity: fx.flashPow, transition: fx.flashPow > 0 ? 'opacity 30ms' : 'opacity 2400ms' }} />
      {/* tactical nuke whiteout */}
      {fx.nukeFlash !== null && <div key={fx.nukeFlash} className="sk-nuke-flash" />}
      {hud.mission && <MissionObjective mission={hud.mission} />}

      {/* ============ SCORESTREAKS ============ */}
      {hud.streaks && active !== false && !hud.tdm?.playerDead && <StreakRail st={hud.streaks} />}
      {hud.streaks && <StreakActive st={hud.streaks} />}
      {hud.streaks?.designating && !hud.tdm?.playerDead && <StrikeDesignator />}
      {hud.streaks?.nukeCountdown !== null && hud.streaks?.nukeCountdown !== undefined && <NukeCountdown t={hud.streaks.nukeCountdown} />}
      {fx.streakMsg && <StreakMessage key={fx.streakMsg.id} text={fx.streakMsg.text} tdm={!!hud.tdm} />}

      {/* ============ FULL SCOREBOARD (hold Tab) ============ */}
      {hud.tdm && showBoard && <TdmFullBoard tdm={hud.tdm} />}

      {/* ============ WAREHOUSE TDM SCOREBOARD ============ */}
      {hud.tdm && (
        <div className="tdm-scoreboard" aria-label="Match score">
          <div className="tdm-score-row">
            <div className="tdm-score-team alpha"><span className="lbl">ALPHA</span><span className="num">{hud.tdm.alphaScore}</span></div>
            <div className="tdm-score-clock">
              <b className={hud.tdm.timeLeft < 30 ? 'low' : ''}>{missionClock(hud.tdm.timeLeft)}</b>
              <i>WAREHOUSE TDM</i>
            </div>
            <div className="tdm-score-team bravo"><span className="num">{hud.tdm.bravoScore}</span><span className="lbl">BRAVO</span></div>
          </div>
          <div className="tdm-roster" aria-hidden="true">
            <span className="rteam">
              {hud.tdm.roster.filter(r => r.team === 'alpha').map(r => (
                <span key={r.name} className={`rname a ${r.dead ? 'dead' : ''} ${r.you ? 'you' : ''} ${r.onFire ? 'fire' : ''}`}>{r.armorIcon}{r.name}{r.onFire ? ' 🔥' : ''}{r.you ? '*' : ''}</span>
              ))}
            </span>
            <span className="rteam">
              {hud.tdm.roster.filter(r => r.team === 'bravo').map(r => (
                <span key={r.name} className={`rname b ${r.dead ? 'dead' : ''} ${r.onFire ? 'fire' : ''}`}>{r.armorIcon}{r.name}{r.onFire ? ' 🔥' : ''}</span>
              ))}
            </span>
          </div>
        </div>
      )}

      {/* ============ ON FIRE MOMENTUM BANNER ============ */}
      {hud.tdm?.onFire && (
        <div className="tdm-fire-banner" role="status">🔥 ON FIRE — {Math.ceil(hud.tdm.onFireLeft)}s</div>
      )}

      {/* ============ TDM RESPAWN OVERLAY ============ */}
      {hud.tdm?.playerDead && (
        <div className="tdm-respawn" role="status">
          <span className="tdm-respawn-title">ELIMINATED</span>
          <span className="tdm-respawn-count">{Math.ceil(hud.tdm.respawnIn)}</span>
          <div className="tdm-respawn-bar"><span style={{ width: `${(1 - hud.tdm.respawnIn / 5) * 100}%` }} /></div>
          <span className="tdm-respawn-sub">REDEPLOYING TO ALPHA YARD</span>
          <span className="tdm-respawn-score">ALPHA {hud.tdm.alphaScore} — {hud.tdm.bravoScore} BRAVO · YOUR KILLS {hud.tdm.playerKills}</span>
        </div>
      )}

      {/* ============ THREAT READOUT (slim — no centre ring clutter) ============ */}
      {hud.ads < .3 && hud.nearest && hud.nearest.dist < 30 && (() => {
        const n = hud.nearest;
        const hot = n.dist < 12;
        const color = hot ? 'var(--blood)' : 'var(--brass)';
        return (
          <div className="absolute left-1/2 top-1/2 flex flex-col items-center" style={{ opacity: hud.ads > 0.6 ? 0.35 : 1, transition: 'opacity .2s' }}>
            <span className="threat-dot" style={{ background: color }} />
            <span className="threat-range" style={{ color }}>
              {n.dist < 10 ? n.dist.toFixed(1) : Math.round(n.dist)}m{n.above > 1.8 ? ' ▲' : n.above < -1.8 ? ' ▼' : ''}
            </span>
          </div>
        );
      })()}

      {/* ============ COMPASS ============ */}
      <div className="compass">
        <div className="compass-strip">
          {Array.from({ length: 73 }, (_, i) => i * 5).map(deg => {
            let rel = deg - hud.bearing;
            while (rel > 180) rel -= 360; while (rel < -180) rel += 360;
            if (Math.abs(rel) > 58) return null;
            const card = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[deg % 360];
            const inter = ({ 45: 'NE', 135: 'SE', 225: 'SW', 315: 'NW' } as Record<number, string>)[deg % 360];
            return (
              <div key={deg} className="compass-tick" style={{ left: 230 + rel * 3.75 - 12 }}>
                <i style={{ width: 1, height: card ? 9 : inter ? 6 : 3, background: card ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.45)', boxShadow: 'none' }} />
                {(card || inter) && <div className={`compass-card ${card ? 'text-white' : 'text-white/40'}`}>{card || inter}</div>}
              </div>
            );
          })}
          {hud.mission && (() => {
            const rel = hud.mission.relativeBearing;
            if (Math.abs(rel) > 58) return null;
            return <span className="compass-obj" style={{ left: 230 + rel * 3.75 - 4 }} aria-label="Objective bearing" />;
          })()}
          {hud.pings.map((p, i) => {
            let rel = p.dir - hud.bearing;
            while (rel > 180) rel -= 360; while (rel < -180) rel += 360;
            if (Math.abs(rel) > 58) return null;
            return <span key={i} className="ping-diamond" style={{ left: 230 + rel * 3.75, opacity: 1 - p.age / 3.2 }} />;
          })}
          <span className="compass-notch" />
        </div>
        <div className="compass-bear hud-chip">{Math.round(hud.bearing).toString().padStart(3, '0')}<span> DEG</span></div>
      </div>

      {/* ============ CASH ============ */}
      <div className="hud-cash mono" aria-label={`Cash ${hud.cash}`}>
        <span>$</span>{hud.cash.toLocaleString('en-US')}
      </div>

      {/* ============ KILL FEED + FPS ============ */}
      <div className="absolute top-14 right-5 flex flex-col items-end gap-1.5">
        {fx.feed.map(f => f.tdm ? (
          <div key={f.id} className="feed-row text-right">
            <span className={`font-black ${f.tdm.killer === 'YOU' ? 'text-[var(--brass)]' : f.tdm.killerTeam === 'alpha' ? 'text-[#7FC4D4]' : 'text-[#E08A7E]'}`}>{f.tdm.killer || '—'}</span>
            <span className="mono text-[var(--steel)] text-[9px] mx-1.5">[{f.tdm.weapon}]</span>
            {f.headshot && <span className="text-[var(--blood)] font-black mr-1 text-[10px] tracking-wider">HS</span>}
            <span className={f.tdm.victim === 'YOU' ? 'text-[var(--blood)] font-black' : 'text-white/90'}>{f.tdm.victim}</span>
            {f.tdm.zone && <span className="feed-zone mono">— {f.tdm.zone}</span>}
          </div>
        ) : (
          <div key={f.id} className="feed-row text-right">
            <span className="text-[var(--brass)] font-black">YOU</span>
            <span className="mono text-[var(--steel)] text-[9px] mx-1.5">{f.text.split('  ')[1]}</span>
            {f.headshot && <span className="text-[var(--blood)] font-black mr-1 text-[10px] tracking-wider">HS</span>}
            <span className="text-white/90">{f.text.split('  ')[2]}</span>
          </div>
        ))}
      </div>
      {s.showFps && (
        <span className="fps-chip hud-chip absolute bottom-3 left-1/2 -translate-x-1/2" style={{ color: fpsColor }}>{hud.fps} FPS</span>
      )}

      {/* ============ CENTER STACK ============ */}
      {hud.ads < 0.3 && !hud.sprinting && !hud.streaks?.designating && (
        <div className="absolute left-1/2 top-1/2" style={{ opacity: 1 - hud.ads / 0.3 }}>
          <Reticle s={s} spread={(hud.spread || 0) * 520} />
        </div>
      )}
      <ScopeView hud={hud} active={active} {...scopeControls} />

      {fx.hitmark && (
        <div key={fx.hitmark.id} className={`absolute left-1/2 top-1/2 ${fx.hitmark.kill ? 'hm-kill' : 'hm'}`}>
          {[45, -45, 135, -135].map(r => (
            <span key={r} style={{
              position: 'absolute', width: 2, height: fx.hitmark!.kill ? 14 : 10, left: -1, top: fx.hitmark!.kill ? -7 : -5,
              background: fx.hitmark!.kill ? '#C8321E' : '#fff',
              boxShadow: fx.hitmark!.kill ? '0 0 10px #C8321E' : '0 0 4px rgba(255,255,255,.8)',
              transform: `rotate(${r}deg) translateY(${fx.hitmark!.kill ? -13 : -11}px)`,
            }} />
          ))}
        </div>
      )}

      {/* ============ DAMAGE ARCS (directional, subtle) ============ */}
      {fx.dmgArcs.map(a => (
        <div key={a.id} className="absolute inset-0 grid place-items-center dmg-arc" style={{ transform: `rotate(${a.dir}deg)` }}>
          <div style={{
            width: '56vmin', height: '56vmin', borderRadius: '50%',
            border: '2px solid transparent', borderTopColor: '#C8321E',
            filter: `drop-shadow(0 -3px 10px rgba(200,50,30,${a.opacity * 0.8}))`, opacity: a.opacity * 0.85,
            clipPath: 'polygon(20% 0%, 80% 0%, 50% 50%)',
          }} />
        </div>
      ))}

      {/* ============ GRENADE WARNING ============ */}
      {hud.grenadeAngle !== undefined && (
        <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center nade-warn">
          <span className="text-[15px] font-black tracking-[0.3em] text-[var(--blood)] ">GRENADE</span>
          <div style={{ transform: `rotate(${hud.grenadeAngle}deg)` }}>
            <svg width="46" height="46" viewBox="0 0 40 40"><path d="M20 2L34 30L20 23L6 30L20 2Z" fill="#C8321E" stroke="#D8B07A" strokeWidth="2" /></svg>
          </div>
          <span className="mono text-[10px] text-white/85">{hud.grenadeDist?.toFixed(1)}m</span>
        </div>
      )}

      {/* ============ STREAK BANNER + CALLOUT + SCORE POPS ============ */}
      {fx.banner && !fx.missionBanner && (
        <div key={fx.banner.id} className="absolute left-1/2 top-[30%] -translate-x-1/2 text-center streak">
          <div className="relative px-8">
            <span className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-[var(--brass)] to-transparent streak-line" />
            <div className="text-4xl font-black text-[var(--brass)] ">{fx.banner.label}</div>
          </div>
        </div>
      )}
      {fx.callout && (
        <div key={fx.callout.id} className="mission-radio">
          <span>RADIO</span> {fx.callout.text}
        </div>
      )}
      <div className="absolute left-1/2 top-[57%] -translate-x-1/2 flex flex-col items-center gap-1">
        {fx.scorePops.map(p => (
          <div key={p.id} className={`score-pop font-black tracking-[0.22em] ${p.cash ? 'cash-pop' : p.headshot ? 'text-[var(--blood)] text-base ' : 'text-[var(--brass)] text-sm '}`}>{p.text}</div>
        ))}
      </div>

      {fx.missionBanner && (
        <div key={fx.missionBanner.id} className="mission-phase-banner" role="status">
          <span>{String(fx.missionBanner.index + 1).padStart(2, '0')}</span>{fx.missionBanner.title}
        </div>
      )}

      {/* ============ TACTICAL RADAR (bottom-left, 60m zoom) ============ */}
      {hud.mapImage && (() => {
        // 60m radius fills the dish; scale the full-map image so 120m spans the 168px diameter.
        const zoom = (hud.worldHalf * 2) / 170;
        const ox = (0.5 - hud.playerMap.nx) * 100 * zoom;
        const oz = (0.5 - hud.playerMap.nz) * 100 * zoom;
        const hot = hud.enemiesMap.filter(e => e.hot).length;
        // Objective bearing chevron on the dish rim + straight-line distance readout.
        let objChip: { deg: number; dist: number; extract: boolean } | null = null;
        if (hud.missionMap) {
          const dx = (hud.missionMap.nx - hud.playerMap.nx) * hud.worldHalf * 2;
          const dz = (hud.missionMap.nz - hud.playerMap.nz) * hud.worldHalf * 2;
          objChip = {
            deg: Math.atan2(dx, -dz) * 180 / Math.PI - hud.bearing,
            dist: Math.hypot(dx, dz),
            extract: hud.missionMap.extract,
          };
        }
        return (
          <div className="radar-pos">
            <div className={`radar ${hot > 0 ? 'contact' : ''}`} style={{ opacity: hud.ads > 0.6 ? 0.35 : 1, transition: 'opacity .2s' }}>
              <div className="radar-world" style={{ transform: `rotate(${-hud.bearing}deg)` }}>
                <div className="radar-zoom" style={{ transform: `translate(${ox}%, ${oz}%) scale(${zoom})` }}>
                  <img src={hud.mapImage} alt="" draggable={false} className="radar-map" />
                  {hud.enemiesMap.map((e, i) => (
                    <span
                      key={i}
                      className={`radar-enemy ${e.hot ? 'hot' : ''}`}
                      style={{ left: `${e.nx * 100}%`, top: `${e.nz * 100}%`, transform: `rotate(${e.yaw}deg)` }}
                    />
                  ))}
                  {hud.missionMap && (
                    <>
                      <span className={`radar-obj-ring ${hud.missionMap.extract ? 'extract' : ''}`} style={{ left: `${hud.missionMap.nx * 100}%`, top: `${hud.missionMap.nz * 100}%`, width: `${hud.missionMap.ringPct * 2}%`, height: `${hud.missionMap.ringPct * 2}%` }} />
                      <span className={`radar-obj-dot ${hud.missionMap.extract ? 'extract' : ''}`} style={{ left: `${hud.missionMap.nx * 100}%`, top: `${hud.missionMap.nz * 100}%` }} />
                    </>
                  )}
                </div>
              </div>
              {/* Objective bearing chevron rides the rim even when the marker is off-dish */}
              {objChip && objChip.dist > 12 && (
                <span className={`radar-obj-chevron ${objChip.extract ? 'extract' : ''}`} style={{ transform: `rotate(${objChip.deg}deg)` }} aria-hidden="true" />
              )}
              <div className="radar-spin" style={{ transform: `rotate(${-hud.bearing}deg)` }} aria-hidden="true">
                <span className="radar-card n" style={{ top: 2, left: '50%', marginLeft: -3 }}>N</span>
                <span className="radar-card" style={{ bottom: 2, left: '50%', marginLeft: -3 }}>S</span>
                <span className="radar-card" style={{ left: 4, top: '50%', marginTop: -4 }}>W</span>
                <span className="radar-card" style={{ right: 4, top: '50%', marginTop: -4 }}>E</span>
              </div>
              <span className="radar-rings" /><span className="radar-rings r2" /><span className="radar-rings r3" />
              <span className="radar-grid" aria-hidden="true" />
              <span className="radar-sweep" />
              <span className="radar-player" />
              <span className="radar-frame" />
              {hud.streaks?.uav && <><span className="radar-uav-sweep" aria-hidden="true" /><span className="radar-uav-tag">UAV</span></>}
              <span className="radar-tick t0" /><span className="radar-tick t45" /><span className="radar-tick t90" /><span className="radar-tick t135" />
            </div>
            {/* Instrument footer: live bearing, objective range, contact count */}
            <div className="radar-meta mono" aria-hidden="true">
              <span className="radar-meta-brg tabular">{String(Math.round(hud.bearing)).padStart(3, '0')}°</span>
              {objChip && <span className={`radar-meta-obj ${objChip.extract ? 'extract' : ''}`}>{objChip.extract ? 'EXFIL' : 'OBJ'} {Math.round(objChip.dist)}m</span>}
              <span className={`radar-meta-hostiles ${hot > 0 ? 'hot' : ''} ${hud.streaks?.uav ? 'uav' : ''}`}>{hud.enemiesMap.length > 0 ? `${hud.enemiesMap.length} ${hud.streaks?.uav ? 'PAINTED' : 'CONTACT' + (hud.enemiesMap.length > 1 ? 'S' : '')}` : 'NO CONTACT'}</span>
            </div>
          </div>
        );
      })()}

      {/* ============ AMMO ============ */}
      <div className="absolute bottom-7 right-8 text-right">
        <div className="weapon-name">{hud.weapon}</div>
        <div className="weapon-card mono" aria-label="Loadout">
          <span className={hud.heldSlot === 'primary' ? 'held' : ''}>1 · {hud.heldSlot === 'primary' ? hud.weapon : hud.secondaryWeapon}</span>
          {hud.secondaryWeapon && (
            <span className={hud.heldSlot === 'secondary' ? 'held' : ''}>2 · {hud.heldSlot === 'secondary' ? hud.weapon : hud.secondaryWeapon}</span>
          )}
        </div>
        <div className="flex items-end justify-end gap-2.5">
          <span key={displayedMag} className={`ammo-num tabnum ${displayedMag === 0 ? 'ammo-empty' : displayedMag <= 5 ? 'ammo-warn' : ''}`}>
            {displayedMag}
          </span>
          <span className="reserve-chip mb-1">∞</span>
        </div>
        <div className="flex gap-[2px] justify-end mt-2">
          {Array.from({ length: segs }, (_, i) => (
            <span key={i} className="mag-seg" style={{
              background: i < filled ? (displayedMag <= 5 ? 'var(--blood)' : 'var(--brass)') : 'rgba(255,255,255,0.12)',
              boxShadow: i < filled ? `0 0 5px ${displayedMag <= 5 ? 'var(--blood)' : 'var(--brass)'}` : 'none',
              transitionDelay: hud.reloading ? `${i * 8}ms` : '0ms',
            }} />
          ))}
        </div>
        {(hud.masterkey || hud.bipodDeployed) && (
          <div className="hud-tags mono">
            {hud.masterkey && (
              <span className={hud.masterkey.shells > 0 ? '' : 'dry'}>
                MK {hud.masterkey.reloading ? '···' : `${'●'.repeat(hud.masterkey.shells)}${'○'.repeat(Math.max(0, 3 - hud.masterkey.shells))}`} [B]
              </span>
            )}
            {hud.bipodDeployed && <span className="bipod">BIPOD DEPLOYED</span>}
          </div>
        )}
        <div className="flex justify-end gap-3 mt-2.5 nade-row">
          <span className={hud.frags > 0 ? 'text-white/75' : 'text-white/20'}><span className="keycap mr-1">G</span>FRAG ×{hud.frags}</span>
          <span className={hud.flashes > 0 ? 'text-white/75' : 'text-white/20'}><span className="keycap mr-1">F</span>FLASH ×{hud.flashes}</span>
        </div>
        {hud.cooking && <div className="mt-1.5 cook-warn">◉ COOKING — RELEASE G</div>}
        {!hud.reloading && hud.mag <= 5 && <div className="mt-1.5 text-[10px] tracking-[0.3em] font-black text-[var(--brass)] blink">RELOAD</div>}
      </div>

      {/* ============ ONBOARDING STRIP (first seconds of a mission) ============ */}
      {hud.mission && hud.mission.elapsed < 12 && (
        <div className="onboard-strip hud-chip" role="status">
          <span className="onboard-fade" style={{ animationDelay: '7.5s' }}>
            <span className="keycap">WASD</span> MOVE
            <i /><span className="keycap">RMB</span> SCOPE
            <i /><span className="keycap">G</span> HOLD FRAG
            <i /><span className="keycap">1/2</span> SWAP
            <i /><span className="keycap">Q</span> LAST
            <i /><span className="keycap">Q·E</span> HOLD LEAN
            <i /><span className="keycap">SPACE</span> VAULT
            <i /><span className="keycap">X</span> ATTACH / BLAST
            <i /><span className="keycap">3-7</span> STREAKS
          </span>
        </div>
      )}

      {/* ============ VITALS ============ */}
      <div className="absolute bottom-7 left-8">
        <div className="vitals hud-chip">
          <div className="vitals-head"><span className="live-dot" />VITALS</div>
          <div className="flex items-end gap-3 mt-1">
            <span className={`hp-num ${lowHp ? 'low' : ''}`}>{hud.hp}</span>
            <svg width="76" height="22" viewBox="0 0 76 22" className="overflow-visible mb-1">
              <polyline points="0,11 14,11 19,4 24,18 29,11 44,11 49,7 54,15 59,11 76,11" fill="none"
                stroke={lowHp ? '#C8321E' : '#7A7A52'} strokeWidth="1.6"
                className="ekg" style={{ animationDuration: lowHp ? '0.7s' : '1.6s' }} />
            </svg>
          </div>
          <div className="hp-bar">
            {Array.from({ length: hpSegs }, (_, i) => (
              <span key={i} className={`${i < hpFilled ? 'on' : ''} ${lowHp && i < hpFilled ? 'low' : ''}`} />
            ))}
          </div>
          <div className="vitals-stats mt-2">
            <div>ELIMINATIONS <b className="text-white">{hud.kills}</b></div>
            <div>HOSTILES <b className="h">{hud.enemiesLeft}</b></div>
            <div>SCORE <b className="cy">{hud.score.toLocaleString('en-US')}</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}
