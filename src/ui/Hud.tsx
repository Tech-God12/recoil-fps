// Recoil FPS — in-game HUD
import type { GameSettings, HudState } from '../game/engine';
import { Reticle } from './Settings';
import MissionObjective from './MissionObjective';

export interface HudFx {
  hitmark: { id: number; kill: boolean } | null;
  feed: { id: number; text: string; headshot: boolean }[];
  dmgArcs: { id: number; dir: number; opacity: number }[];
  scorePops: { id: number; text: string; headshot: boolean }[];
  banner: { id: number; label: string } | null;
  callout: { id: number; text: string } | null;
  flashPow: number;
  missionBanner: { id: number; title: string; index: number } | null;
}

export default function Hud({ hud, s, fx }: { hud: HudState; s: GameSettings; fx: HudFx }) {
  const lowHp = hud.hp < 35;
  const vig = hud.hp < 60 ? 1 - hud.hp / 60 : 0;
  const magPct = hud.magSize ? hud.mag / hud.magSize : 0;
  const segs = Math.min(hud.magSize || 30, 30);
  const filled = Math.round(magPct * segs);
  const displayedMag = hud.reloading && hud.reloadStage === 'magOut' ? 0 : hud.mag;
  const fpsColor = hud.fps >= 55 ? '#00FF88' : hud.fps >= 35 ? '#F2A93B' : '#FF3B30';

  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {/* damage vignette */}
      {vig > 0 && (
        <div className={`absolute inset-0 ${lowHp ? 'hp-pulse' : ''}`}
          style={{ boxShadow: `inset 0 0 ${120 + vig * 200}px rgba(190,10,10,${0.25 + vig * 0.6})` }} />
      )}
      {/* flashbang */}
      <div className="absolute inset-0 bg-white" style={{ opacity: fx.flashPow, transition: fx.flashPow > 0 ? 'opacity 30ms' : 'opacity 2400ms' }} />
      {hud.mission && <MissionObjective mission={hud.mission} />}

      {/* ============ THREAT PROXIMITY INDICATOR ============ */}
      {/* A ring around the crosshair: the arrow points at the closest hostile, the readout shows range. */}
      {hud.nearest && (() => {
        const n = hud.nearest;
        const hot = n.dist < 12, warm = n.dist < 30;
        const color = hot ? '#FF3B30' : warm ? '#F2A93B' : 'rgba(255,255,255,0.55)';
        const R = 92; // ring radius (px)
        const a = (n.angle - 90) * Math.PI / 180;
        const ax = Math.cos(a) * R, ay = Math.sin(a) * R;
        return (
          <div className="absolute left-1/2 top-1/2" style={{ opacity: hud.ads > 0.6 ? 0.35 : 1, transition: 'opacity .2s' }}>
            {/* faint ring */}
            <div className="absolute rounded-full border" style={{ width: R * 2, height: R * 2, left: -R, top: -R, borderColor: 'rgba(255,255,255,0.07)' }} />
            {/* arrow on the ring */}
            <div className={`absolute ${hot ? 'prox-hot' : ''}`} style={{ left: ax, top: ay, transform: `translate(-50%,-50%) rotate(${n.angle}deg)` }}>
              <svg width="26" height="26" viewBox="0 0 26 26"><path d="M13 2 L22 20 L13 15 L4 20 Z" fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} /></svg>
            </div>
            {/* range readout under the crosshair */}
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 chamfer-xs hud-chip px-2 py-0.5" style={{ top: 34 }}>
              <span className="w-1.5 h-1.5 rotate-45" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
              <span className="tabnum text-[11px] font-black" style={{ color }}>{n.dist < 10 ? n.dist.toFixed(1) : Math.round(n.dist)}m</span>
              {Math.abs(n.above) > 1.8 && <span className="text-[9px] text-white/60">{n.above > 0 ? '▲' : '▼'}</span>}
              <span className="text-[8px] tracking-[0.2em] text-white/40 ml-1">{hud.enemiesLeft} ACTIVE</span>
            </div>
          </div>
        );
      })()}

      {/* ============ COMPASS ============ */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2">
        <div className="relative w-[420px] h-9 overflow-hidden" style={{ maskImage: 'linear-gradient(90deg,transparent,#000 16%,#000 84%,transparent)' }}>
          <div className="absolute top-0 inset-x-0 h-px bg-white/25" />
          {Array.from({ length: 73 }, (_, i) => i * 5).map(deg => {
            let rel = deg - hud.bearing;
            while (rel > 180) rel -= 360; while (rel < -180) rel += 360;
            if (Math.abs(rel) > 56) return null;
            const card = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[deg % 360];
            const inter = ({ 45: 'NE', 135: 'SE', 225: 'SW', 315: 'NW' } as Record<number, string>)[deg % 360];
            return (
              <div key={deg} className="absolute text-center" style={{ left: 210 + rel * 3.7 - 12, top: 3, width: 24 }}>
                <div className="mx-auto bg-white/55" style={{ width: 1, height: card ? 8 : inter ? 6 : 3 }} />
                {(card || inter) && <div className={`text-[9px] tracking-widest font-bold ${card ? 'text-white' : 'text-white/45'}`}>{card || inter}</div>}
              </div>
            );
          })}
          {hud.mission && (() => {
            const rel = hud.mission.relativeBearing;
            if (Math.abs(rel) > 56) return null;
            return <span className="objective-compass" style={{ left: 210 + rel * 3.7 }} aria-label="Objective bearing" />;
          })()}
          {hud.pings.map((p, i) => {
            let rel = p.dir - hud.bearing;
            while (rel > 180) rel -= 360; while (rel < -180) rel += 360;
            if (Math.abs(rel) > 56) return null;
            return <span key={i} className="ping-diamond" style={{ left: 210 + rel * 3.7, opacity: 1 - p.age / 3.2 }} />;
          })}
          <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[2px] h-3.5 bg-[var(--acc)] shadow-[0_0_8px_var(--acc)]" />
        </div>
        <div className="mx-auto mt-0.5 w-14 text-center chamfer-xs hud-chip text-[10px] font-black tracking-widest text-[var(--acc)] py-0.5">
          {Math.round(hud.bearing).toString().padStart(3, '0')}°
        </div>
      </div>

      {/* ============ KILL FEED — starts below the utility button column so nothing overlaps ============ */}
      <div className="absolute top-[58px] right-6 space-y-1.5 text-right">
        {fx.feed.map(f => (
          <div key={f.id} className="feed-row chamfer-xs">
            <span className="text-[var(--acc)] font-black">YOU</span>
            <span className="text-white/35 mx-1.5">{f.text.split('  ')[1]}</span>
            {f.headshot && <span className="text-[#FF3B30] font-black mr-1">☠</span>}
            <span className="text-[#FF8A7A]">{f.text.split('  ')[2]}</span>
          </div>
        ))}
      </div>

      {/* ============ CROSSHAIR / ADS SIGHT — exactly one, no duplicates ============ */}
      {hud.ads < 0.3 && !hud.sprinting && (
        <div className="absolute left-1/2 top-1/2" style={{ opacity: 1 - hud.ads / 0.3 }}>
          <Reticle s={s} spread={(hud.spread || 0) * 520} />
        </div>
      )}
      {/* Sniper scope tube mask — only ever rendered for the AWM; everything outside the circle is dark. */}
      {hud.ads >= 0.3 && hud.weapon.includes('SNIPER') && (
        <div className="absolute inset-0" style={{ background: 'radial-gradient(circle 160px at 50% 50%, rgba(0,0,0,0) 96%, rgba(4,6,9,0.97) 99%)', opacity: Math.min(1, (hud.ads - 0.3) / 0.4) }} />
      )}
      {hud.ads >= 0.3 && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"
          style={{ opacity: Math.min(1, (hud.ads - 0.3) / 0.4) }}
        >
          {hud.weapon.includes('SNIPER') ? (
            /* Scope optics: tube mask is drawn at the HUD root; mil-dot reticle here. */
              <div className="relative w-[320px] h-[320px] rounded-full shadow-[0_0_60px_rgba(0,0,0,0.85)] flex items-center justify-center">
                <div className="absolute rounded-full ring-1 ring-black/50" style={{ inset: 6 }} />
                <div className="absolute w-full h-px bg-black/70" />
                <div className="absolute h-full w-px bg-black/70" />
                {[-16, -8, 8, 16].map(offset => (
                  <div key={offset} className="absolute h-px bg-black/60" style={{ width: 12, transform: `translateY(${offset}px)` }} />
                ))}
                {[-16, -8, 8, 16].map(offset => (
                  <div key={`v-${offset}`} className="absolute w-px bg-black/60" style={{ height: 12, transform: `translateX(${offset}px)` }} />
                ))}
                <div className="absolute w-1.5 h-1.5 rounded-full bg-[#FF2020]/90 shadow-[0_0_8px_#FF2020]" />
              </div>
          ) : (
            /* Clean red-dot reflex sight for all other weapons */
            <div className="relative w-9 h-9 flex items-center justify-center">
              <div className="absolute w-6 h-6 rounded-full border border-[#FF2020]/25" />
              <div className="absolute w-1.5 h-1.5 rounded-full bg-[#FF2020] shadow-[0_0_7px_#FF2020]" />
            </div>
          )}
        </div>
      )}
      {hud.canVault && (
        <div className="absolute left-1/2 top-[58%] -translate-x-1/2 chamfer-xs hud-chip px-3 py-1 text-[10px] tracking-[0.28em] font-black text-[var(--acc)]">
          [SPACE] VAULT
        </div>
      )}
      {hud.reloading && (
        <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" width="64" height="64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--acc)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={163} className="reload-ring" transform="rotate(-90 32 32)" />
        </svg>
      )}
      {fx.hitmark && (
        <div key={fx.hitmark.id} className={`absolute left-1/2 top-1/2 ${fx.hitmark.kill ? 'hm-kill' : 'hm'}`}>
          {[45, -45, 135, -135].map(r => (
            <span key={r} style={{
              position: 'absolute', width: 2, height: 10, left: -1, top: -5,
              background: fx.hitmark!.kill ? '#FF3B30' : '#fff',
              boxShadow: fx.hitmark!.kill ? '0 0 8px #FF3B30' : 'none',
              transform: `rotate(${r}deg) translateY(-11px)`,
            }} />
          ))}
        </div>
      )}

      {/* ============ DAMAGE ARCS ============ */}
      {fx.dmgArcs.map(a => (
        <div key={a.id} className="absolute inset-0 grid place-items-center dmg-arc" style={{ transform: `rotate(${a.dir}deg)` }}>
          <div style={{
            width: '74vmin', height: '74vmin', borderRadius: '50%',
            border: '3px solid transparent', borderTopColor: '#CC0000',
            filter: `drop-shadow(0 -4px 14px rgba(204,0,0,${a.opacity}))`, opacity: a.opacity,
            clipPath: 'polygon(18% 0%, 82% 0%, 50% 50%)',
          }} />
        </div>
      ))}

      {/* ============ GRENADE WARNING ============ */}
      {hud.grenadeAngle !== undefined && (
        <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center nade-warn">
          <span className="text-[13px] font-black tracking-[0.3em] text-[#FF3B30]" style={{ textShadow: '0 0 12px #FF3B30' }}>GRENADE</span>
          <div style={{ transform: `rotate(${hud.grenadeAngle}deg)` }}>
            <svg width="42" height="42" viewBox="0 0 40 40"><path d="M20 2L34 30L20 23L6 30L20 2Z" fill="#FF3B30" stroke="#FF8866" strokeWidth="2" /></svg>
          </div>
          <span className="text-[10px] text-white/80 font-bold">{hud.grenadeDist?.toFixed(1)}m</span>
        </div>
      )}

      {/* ============ STREAK BANNER + CALLOUT + SCORE POPS ============ */}
      {fx.banner && !fx.missionBanner && (
        <div key={fx.banner.id} className="absolute left-1/2 top-[30%] -translate-x-1/2 text-center streak">
          <div className="relative px-8">
            <span className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-[var(--acc)] to-transparent streak-line" />
            <div className="text-4xl font-black text-[var(--acc)]" style={{ textShadow: '0 0 24px rgba(242,169,59,0.8)' }}>{fx.banner.label}</div>
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
          <div key={p.id} className={`score-pop font-black tracking-[0.22em] ${p.headshot ? 'text-[#FF3B30] text-base' : 'text-[var(--acc)] text-sm'}`}
            style={{ textShadow: '0 0 12px currentColor' }}>{p.text}</div>
        ))}
      </div>

      {fx.missionBanner && (
        <div key={fx.missionBanner.id} className="mission-phase-banner" role="status">
          <span>{String(fx.missionBanner.index + 1).padStart(2, '0')}</span>{fx.missionBanner.title}
        </div>
      )}

      {/* ============ AMMO ============ */}
      <div className="absolute bottom-7 right-8 text-right">
        <div className="text-[9px] tracking-[0.3em] text-white/45 mb-1">{hud.weapon}</div>
        <div className="flex items-end justify-end gap-2.5">
          <span key={displayedMag} className={`ammo-num tabnum ${displayedMag === 0 ? 'ammo-empty' : displayedMag <= 5 ? 'ammo-warn' : 'text-white'}`}>
            {displayedMag}
          </span>
          <span className="mb-1.5 text-[11px] tracking-[0.2em] text-[#00FF88] chamfer-xs px-1.5 py-0.5 border border-[#00FF88]/35 bg-[#00FF88]/10">∞</span>
        </div>
        {/* segmented magazine bar */}
        <div className="flex gap-[2px] justify-end mt-2">
          {Array.from({ length: segs }, (_, i) => (
            <span key={i} className="mag-seg" style={{
              background: i < filled ? (displayedMag <= 5 ? '#FF3B30' : 'var(--acc)') : 'rgba(255,255,255,0.12)',
              boxShadow: i < filled ? '0 0 5px var(--acc)' : 'none',
              transitionDelay: hud.reloading ? `${i * 8}ms` : '0ms',
            }} />
          ))}
        </div>
        <div className="flex justify-end gap-3 mt-2.5 text-[10px] tracking-[0.18em] font-bold">
          <span className={hud.frags > 0 ? 'text-white/75' : 'text-white/20'}><span className="keycap mr-1">G</span>FRAG ×{hud.frags}</span>
          <span className={hud.flashes > 0 ? 'text-white/75' : 'text-white/20'}><span className="keycap mr-1">F</span>FLASH ×{hud.flashes}</span>
        </div>
        {hud.cooking && <div className="mt-1.5 text-[10px] tracking-[0.25em] font-black text-[#FF3B30] blink">◉ COOKING — RELEASE G</div>}
        {!hud.reloading && hud.mag <= 5 && <div className="mt-1.5 text-[10px] tracking-[0.3em] font-black text-[var(--acc)] blink">RELOAD</div>}
      </div>

      {/* ============ VITALS ============ */}
      <div className="absolute bottom-7 left-8">
        <div className="flex items-center gap-2.5 mb-2">
          <svg width="76" height="22" viewBox="0 0 76 22" className="overflow-visible">
            <polyline points="0,11 14,11 19,4 24,18 29,11 44,11 49,7 54,15 59,11 76,11" fill="none"
              stroke={lowHp ? '#FF3B30' : '#00FF88'} strokeWidth="1.6"
              className="ekg" style={{ animationDuration: lowHp ? '0.7s' : '1.6s' }} />
          </svg>
          <span className={`tabnum text-xl font-black ${lowHp ? 'text-[#FF3B30]' : 'text-white/85'}`}>{hud.hp}</span>
        </div>
        <div className="text-[9px] tracking-[0.24em] text-white/45 space-y-0.5">
          <div>ELIMINATIONS <span className="text-white font-black ml-1">{hud.kills}</span></div>
          {/* Pressure refills by design — this is the live roster, not a countdown. */}
          <div>ACTIVE HOSTILES <span className="text-[#FF5544] font-black ml-1">{hud.enemiesLeft}</span></div>
          <div>SCORE <span className="text-[var(--acc)] font-black tabnum ml-1">{hud.score.toLocaleString('en-US')}</span></div>
        </div>
      </div>

      {/* ============ LIVE TACTICAL MINIMAP (rendered from real collision geometry) ============ */}
      <MiniMap hud={hud} />

      {/* ============ FPS — bottom-center, out of the kill-feed column ============ */}
      {s.showFps && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <span className="chamfer-xs hud-chip px-2 py-1 text-[10px] font-black tabnum" style={{ color: fpsColor }}>{hud.fps} FPS</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Corner tactical map: reuses the pre-baked mapImage + live entity dots ---------- */
function MiniMap({ hud }: { hud: HudState }) {
  if (!hud.mapImage) return null;
  const mm = hud.missionMap;
  const objColor = mm?.extract ? '#8CDBC2' : 'var(--acc)';
  return (
    <div className="minimap absolute left-8 bottom-[172px]" aria-label="Tactical map" role="img">
      <div className="absolute inset-0 minimap-img" style={{ backgroundImage: `url(${hud.mapImage})` }} />
      {mm && (
        <>
          <span className="minimap-ring" style={{ left: `${mm.nx * 100}%`, top: `${mm.nz * 100}%`, width: `${mm.ringPct * 2}%`, height: `${mm.ringPct * 2}%`, borderColor: objColor }} />
          <span className="minimap-dot" style={{ left: `${mm.nx * 100}%`, top: `${mm.nz * 100}%`, width: 6, height: 6, background: objColor, boxShadow: `0 0 6px ${objColor}` }} />
        </>
      )}
      {hud.enemiesMap.map((e, i) => (
        <span key={i} className="minimap-dot minimap-enemy" style={{ left: `${e.nx * 100}%`, top: `${e.nz * 100}%` }} />
      ))}
      <span className="minimap-player" style={{ left: `${hud.playerMap.nx * 100}%`, top: `${hud.playerMap.nz * 100}%`, transform: `translate(-50%,-50%) rotate(${hud.bearing}deg)` }} />
      <span className="absolute top-1 left-2 text-[8px] font-black text-white/75" style={{ textShadow: '0 0 4px #000' }}>N</span>
      <span className="absolute bottom-1 right-2 text-[7px] tracking-[0.24em] font-bold text-white/50" style={{ textShadow: '0 0 4px #000' }}>TAC MAP</span>
    </div>
  );
}
