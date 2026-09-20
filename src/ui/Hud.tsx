// Recoil FPS — in-game HUD (VOLT PROTOCOL)
import type { GameSettings, HudState } from '../game/engine';
import { ARMOR_ICON } from '../game/tdm';
import { Reticle } from './Settings';
import MissionObjective from './MissionObjective';

export interface HudFx {
  hitmark: { id: number; kill: boolean } | null;
  feed: { id: number; text: string; headshot: boolean }[];
  dmgArcs: { id: number; dir: number; opacity: number }[];
  scorePops: { id: number; text: string; headshot: boolean; cash?: boolean }[];
  banner: { id: number; label: string } | null;
  callout: { id: number; text: string } | null;
  flashPow: number;
  missionBanner: { id: number; title: string; index: number } | null;
}

type TdmHud = NonNullable<HudState['tdm']>;

const tdmClock = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Top-centre scoreboard: ALPHA vs BRAVO, match clock, mini roster with armor icons. */
function TdmScoreboard({ tdm }: { tdm: TdmHud }) {
  const timeLow = tdm.timeLeft < 30;
  const alpha = tdm.roster.filter(r => r.team === 'alpha');
  const bravo = tdm.roster.filter(r => r.team === 'bravo');
  const chip = (r: TdmHud['roster'][number]) => (
    <span key={`${r.team}-${r.name}`} className={`tdm-roster-chip ${r.team} ${r.dead ? 'dead' : ''} ${r.you ? 'you' : ''}`}>
      <i className="tdm-roster-armor" aria-hidden="true">{ARMOR_ICON[r.armor]}</i>
      <b>{r.name}{r.you ? '*' : ''}</b>
      <em className="tabular">{r.kills}</em>
    </span>
  );
  return (
    <div className="tdm-scoreboard" role="status" aria-label="Team deathmatch scoreboard">
      <div className="tdm-scoreboard-label mono">WAREHOUSE TDM</div>
      <div className="tdm-scoreboard-main">
        <span className="tdm-score alpha tabular">{tdm.alpha}</span>
        <span className="tdm-score-sep" aria-hidden="true">:</span>
        <span className="tdm-score bravo tabular">{tdm.bravo}</span>
      </div>
      <div className={`tdm-clock mono tabular ${timeLow ? 'low' : ''}`}>{tdmClock(tdm.timeLeft)}</div>
      <div className="tdm-roster">
        <span className="tdm-roster-col">{alpha.map(chip)}</span>
        <span className="tdm-roster-col">{bravo.map(chip)}</span>
      </div>
    </div>
  );
}

/** Full-screen-ish centre overlay while waiting out the 10s respawn. */
function TdmRespawn({ tdm, score }: { tdm: TdmHud; score: number }) {
  const pct = (1 - tdm.respawnIn / 10) * 100;
  return (
    <div className="tdm-respawn" role="alert">
      <span className="tdm-respawn-title">ELIMINATED</span>
      <span className="tdm-respawn-sub mono">RESPAWNING IN {tdm.respawnIn.toFixed(1)}s</span>
      <span className="tdm-respawn-bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>
      <span className="tdm-respawn-stats mono">
        <span>SCORE <b className="tabular">{score.toLocaleString('en-US')}</b></span>
        <span>FRAGS <b className="tabular">{tdm.playerKills}</b></span>
        <span>ALPHA <b className="tabular">{tdm.alpha}</b> · BRAVO <b className="tabular">{tdm.bravo}</b></span>
      </span>
    </div>
  );
}

export default function Hud({ hud, s, fx }: { hud: HudState; s: GameSettings; fx: HudFx }) {
  const lowHp = hud.hp < 35;
  const vig = hud.hp < 60 ? 1 - hud.hp / 60 : 0;
  const magPct = hud.magSize ? hud.mag / hud.magSize : 0;
  const segs = Math.min(hud.magSize || 30, 30);
  const filled = Math.round(magPct * segs);
  const displayedMag = hud.reloading && hud.reloadStage === 'magOut' ? 0 : hud.mag;
  const fpsColor = hud.fps >= 55 ? 'var(--olive)' : hud.fps >= 35 ? 'var(--brass)' : 'var(--blood)';
  const hpSegs = 10;
  const hpFilled = Math.min(hpSegs, Math.max(0, Math.ceil(hud.hp / 100 * hpSegs)));

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
      {hud.mission && <MissionObjective mission={hud.mission} />}

      {/* ============ WAREHOUSE TDM: scoreboard + respawn ============ */}
      {hud.tdm && <TdmScoreboard tdm={hud.tdm} />}
      {hud.tdm?.dead && <TdmRespawn tdm={hud.tdm} score={hud.score} />}

      {/* ============ THREAT READOUT (slim — no centre ring clutter) ============ */}
      {hud.nearest && hud.nearest.dist < 30 && (() => {
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
        {fx.feed.map(f => (
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
      {hud.ads < 0.3 && !hud.sprinting && (
        <div className="absolute left-1/2 top-1/2" style={{ opacity: 1 - hud.ads / 0.3 }}>
          <Reticle s={s} spread={(hud.spread || 0) * 520} />
        </div>
      )}
      {/* Magnified scope views — each zoom tier renders a DIFFERENT sight picture:
          3x = compact prism w/ chevron, 4x = telescopic tube w/ BDC crosshair,
          6x/AWM = full precision scope w/ fine mil-dot reticle + heavy tube mask. */}
      {(() => {
        if (hud.ads < 0.3) return null;
        const fov = hud.zoomFov || 60;
        const scoped = fov < 45; // 3x and tighter take over the screen
        if (!scoped) return null;
        const tier: '3x' | '4x' | '6x' = fov >= 34 ? '3x' : fov >= 25 ? '4x' : '6x';
        const op = Math.min(1, (hud.ads - 0.3) / 0.4);
        const r = tier === '3x' ? 230 : tier === '4x' ? 195 : 165; // visible circle radius px
        return (
          <>
            <div className={`scope-mask scope-mask-${tier}`} style={{ opacity: op, ['--scope-r' as string]: `${r}px` }} />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center" style={{ opacity: op }}>
              {tier === '3x' ? (
                /* 3x prism: thin ring, lit amber chevron + BDC ladder, open feel */
                <div className="relative flex flex-col items-center justify-center" style={{ width: r * 2, height: r * 2 }}>
                  <div className="absolute inset-0 rounded-full ring-2 ring-black/70" />
                  <div className="acog-chev" style={{ marginTop: -6 }} />
                  <div className="acog-bdc" />
                  <div className="acog-bdc short" />
                  <div className="acog-bdc short" />
                  <span className="scope-tag mono">3.0×</span>
                </div>
              ) : tier === '4x' ? (
                /* 4x telescopic: duplex crosshair, thick posts thinning to centre, BDC dots below */
                <div className="relative flex items-center justify-center" style={{ width: r * 2, height: r * 2 }}>
                  <div className="absolute inset-0 rounded-full ring-4 ring-black/80" />
                  <div className="absolute h-[3px] bg-black/85" style={{ width: r * 0.62, left: 6 }} />
                  <div className="absolute h-[3px] bg-black/85" style={{ width: r * 0.62, right: 6 }} />
                  <div className="absolute w-[3px] bg-black/85" style={{ height: r * 0.62, top: 6 }} />
                  <div className="absolute w-full h-px bg-black/80" />
                  <div className="absolute h-full w-px bg-black/80" />
                  {[10, 22, 36].map(offset => (
                    <div key={offset} className="absolute rounded-full bg-black/80" style={{ width: 4, height: 4, transform: `translateY(${offset}px)` }} />
                  ))}
                  <div className="absolute w-1 h-1 rounded-full bg-[var(--blood)] shadow-[0_0_6px_var(--blood)]" />
                  <span className="scope-tag mono">4.0×</span>
                </div>
              ) : (
                /* 6x / AWM precision glass: fine mil-dot cross, stadia ticks, parallax shading */
                <div className="relative flex items-center justify-center" style={{ width: r * 2, height: r * 2 }}>
                  <div className="absolute inset-0 rounded-full shadow-[inset_0_0_50px_rgba(0,0,0,0.75)] ring-8 ring-black/90" />
                  <div className="absolute rounded-full ring-1 ring-black/50" style={{ inset: 10 }} />
                  <div className="absolute w-full h-px bg-black/85" />
                  <div className="absolute h-full w-px bg-black/85" />
                  {[-48, -32, -16, 16, 32, 48].map(offset => (
                    <div key={`h${offset}`} className="absolute h-[5px] w-px bg-black/75" style={{ transform: `translateX(${offset}px)` }} />
                  ))}
                  {[-48, -32, -16, 16, 32, 48].map(offset => (
                    <div key={`v${offset}`} className="absolute w-[5px] h-px bg-black/75" style={{ transform: `translateY(${offset}px)` }} />
                  ))}
                  {[16, 32, 48].map(offset => (
                    <div key={`d${offset}`} className="absolute rounded-full bg-black/85" style={{ width: 3, height: 3, transform: `translateY(${offset}px)` }} />
                  ))}
                  <div className="absolute w-1.5 h-1.5 rounded-full bg-[var(--blood)] shadow-[0_0_9px_var(--blood)]" />
                  <span className="scope-tag mono">6.0×</span>
                </div>
              )}
            </div>
          </>
        );
      })()}
      {hud.ads >= 0.3 && !(hud.zoomFov && hud.zoomFov < 45) && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"
          style={{ opacity: Math.min(1, (hud.ads - 0.3) / 0.4) }}
        >
          {hud.reticle === 'dot' ? (
            <div className="absolute w-[2px] h-[2px] rounded-full bg-[var(--olive)] shadow-[0_0_4px_var(--olive)]" />
          ) : hud.reticle === 'holo' ? (
            <div className="relative w-16 h-16 flex items-center justify-center">
              <div className="absolute w-14 h-14 rounded-full border border-[var(--brass)]/90" />
              <div className="absolute w-[3px] h-[3px] rounded-full bg-[var(--brass)] shadow-[0_0_5px_var(--brass)]" />
            </div>
          ) : hud.reticle === 'acog' ? (
            <div className="relative w-10 h-20 flex flex-col items-center justify-start pt-2">
              <div className="acog-chev" />
              <div className="acog-bdc" />
              <div className="acog-bdc short" />
              <div className="acog-bdc short" />
            </div>
          ) : (
            /* iron sights: a faint post-tip marker, NOT a red dot — optics are Armory parts */
            <div className="relative w-9 h-9 flex items-center justify-center">
              <div className="absolute w-[2px] h-[2px] rounded-full bg-white/70" />
            </div>
          )}
        </div>
      )}
      {hud.canVault && (
        <div className="absolute left-1/2 top-[58%] -translate-x-1/2 vault-chip hud-chip">
          [SPACE] VAULT
        </div>
      )}
      {hud.reloading && (
        <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" width="64" height="64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--brass)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={163} className="reload-ring" transform="rotate(-90 32 32)"
            style={{ filter: 'drop-shadow(0 0 6px rgba(200,155,90,.8))' }} />
        </svg>
      )}
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
              <span className="radar-tick t0" /><span className="radar-tick t45" /><span className="radar-tick t90" /><span className="radar-tick t135" />
            </div>
            {/* Instrument footer: live bearing, objective range, contact count */}
            <div className="radar-meta mono" aria-hidden="true">
              <span className="radar-meta-brg tabular">{String(Math.round(hud.bearing)).padStart(3, '0')}°</span>
              {objChip && <span className={`radar-meta-obj ${objChip.extract ? 'extract' : ''}`}>{objChip.extract ? 'EXFIL' : 'OBJ'} {Math.round(objChip.dist)}m</span>}
              <span className={`radar-meta-hostiles ${hot > 0 ? 'hot' : ''}`}>{hud.enemiesMap.length > 0 ? `${hud.enemiesMap.length} HOSTILE${hud.enemiesMap.length > 1 ? 'S' : ''}` : 'CLEAR'}</span>
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
