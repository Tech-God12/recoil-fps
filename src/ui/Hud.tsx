// Recoil FPS — in-game HUD (de-cluttered, onboarding, clarity pass)
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
  const lowHp = hud.hp < 30;
  const vig = hud.hp < 40 ? (1 - hud.hp / 40) * 0.55 : 0;
  const magPct = hud.magSize ? hud.mag / hud.magSize : 0;
  const segs = Math.min(hud.magSize || 30, 30);
  const filled = Math.round(magPct * segs);
  const displayedMag = hud.reloading && hud.reloadStage === 'magOut' ? 0 : hud.mag;
  const fpsColor = hud.fps >= 55 ? '#00FF88' : hud.fps >= 35 ? '#F2A93B' : '#FF3B30';
  const elapsed = hud.mission?.elapsed ?? 0;
  const showTutorial = elapsed < 35;

  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {/* damage vignette — softer, only below 40 */}
      {vig > 0 && (
        <div className={`absolute inset-0 ${lowHp ? 'hp-pulse' : ''}`}
          style={{ boxShadow: `inset 0 0 ${80 + vig * 140}px rgba(190,10,10,${0.18 + vig * 0.45})` }} />
      )}
      {/* flashbang */}
      <div className="absolute inset-0 bg-white" style={{ opacity: fx.flashPow, transition: fx.flashPow > 0 ? 'opacity 30ms' : 'opacity 2400ms' }} />
      {hud.mission && <MissionObjective mission={hud.mission} />}

      {/* ============ TUTORIAL — first 30s must teach core verbs ============ */}
      {showTutorial && (
        <div className="absolute bottom-[88px] left-1/2 -translate-x-1/2 flex gap-2 flex-wrap justify-center max-w-[560px]">
          {elapsed < 8 && (
            <span className="hud-chip chamfer-xs px-2.5 py-1 text-[10px] tracking-[0.18em] font-bold text-white/80"><span className="keycap mr-1">WASD</span> MOVE <span className="keycap ml-2 mr-1">SHIFT</span> SPRINT</span>
          )}
          {elapsed >= 5 && elapsed < 15 && (
            <span className="hud-chip chamfer-xs px-2.5 py-1 text-[10px] tracking-[0.18em] font-bold text-white/80"><span className="keycap mr-1">RMB</span> SCOPE <span className="keycap ml-2 mr-1">LMB</span> FIRE <span className="keycap ml-2 mr-1">R</span> RELOAD</span>
          )}
          {elapsed >= 12 && elapsed < 22 && (
            <span className="hud-chip chamfer-xs px-2.5 py-1 text-[10px] tracking-[0.18em] font-bold text-white/80"><span className="keycap mr-1">Q/E</span> LEAN <span className="keycap ml-2 mr-1">SPACE</span> VAULT <span className="keycap ml-2 mr-1">C</span> CROUCH <span className="text-white/40 ml-1">+ SPRINT = SLIDE</span></span>
          )}
          {elapsed >= 20 && elapsed < 35 && (
            <span className="hud-chip chamfer-xs px-2.5 py-1 text-[10px] tracking-[0.18em] font-bold text-white/80"><span className="keycap mr-1">G HOLD</span> FRAG <span className="keycap ml-2 mr-1">F</span> FLASH <span className="keycap ml-2 mr-1">X HOLD</span> PLANT</span>
          )}
        </div>
      )}

      {/* ============ THREAT PROXIMITY INDICATOR — only when close, less clutter ============ */}
      {hud.nearest && hud.nearest.dist < 38 && (() => {
        const n = hud.nearest!;
        const hot = n.dist < 12, warm = n.dist < 24;
        const color = hot ? '#FF3B30' : warm ? '#F2A93B' : 'rgba(255,255,255,0.65)';
        const R = 68; // smaller ring
        const a = (n.angle - 90) * Math.PI / 180;
        const ax = Math.cos(a) * R, ay = Math.sin(a) * R;
        // hide when ADS to reduce clutter
        const adsOpacity = hud.ads > 0.5 ? 0.18 : 1;
        return (
          <div className="absolute left-1/2 top-1/2" style={{ opacity: adsOpacity, transition: 'opacity .2s' }}>
            <div className="absolute rounded-full border" style={{ width: R * 2, height: R * 2, left: -R, top: -R, borderColor: 'rgba(255,255,255,0.06)' }} />
            <div className={`absolute ${hot ? 'prox-hot' : ''}`} style={{ left: ax, top: ay, transform: `translate(-50%,-50%) rotate(${n.angle}deg)` }}>
              <svg width="20" height="20" viewBox="0 0 26 26"><path d="M13 2 L22 20 L13 15 L4 20 Z" fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }} /></svg>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 chamfer-xs hud-chip px-2 py-0.5" style={{ top: 28 }}>
              <span className="w-1.5 h-1.5 rotate-45" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
              <span className="tabnum text-[10px] font-black" style={{ color }}>{n.dist < 10 ? n.dist.toFixed(1) : Math.round(n.dist)}m</span>
              {Math.abs(n.above) > 1.8 && <span className="text-[8px] text-white/60">{n.above > 0 ? '▲' : '▼'}</span>}
            </div>
          </div>
        );
      })()}

      {/* ============ COMPASS — compact, hides in ADS ============ */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2" style={{ opacity: hud.ads > 0.6 ? 0.22 : 1, transition: 'opacity .2s' }}>
        <div className="relative w-[320px] h-8 overflow-hidden" style={{ maskImage: 'linear-gradient(90deg,transparent,#000 14%,#000 86%,transparent)' }}>
          <div className="absolute top-0 inset-x-0 h-px bg-white/20" />
          {Array.from({ length: 49 }, (_, i) => i * 5 + Math.floor(hud.bearing / 5) * 5 - 120).map(deg => {
            const norm = ((deg % 360) + 360) % 360;
            let rel = deg - hud.bearing;
            while (rel > 180) rel -= 360; while (rel < -180) rel += 360;
            if (Math.abs(rel) > 44) return null;
            const card = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[norm];
            return (
              <div key={deg} className="absolute text-center" style={{ left: 160 + rel * 3.2 - 10, top: 2, width: 20 }}>
                <div className="mx-auto bg-white/50" style={{ width: 1, height: card ? 7 : 2.5 }} />
                {card && <div className="text-[8px] tracking-widest font-bold text-white/80">{card}</div>}
              </div>
            );
          })}
          {hud.mission && (() => {
            const rel = hud.mission.relativeBearing;
            if (Math.abs(rel) > 44) return null;
            return <span className="objective-compass" style={{ left: 160 + rel * 3.2 }} aria-label="Objective bearing" />;
          })()}
          {hud.pings.map((p, i) => {
            let rel = p.dir - hud.bearing;
            while (rel > 180) rel -= 360; while (rel < -180) rel += 360;
            if (Math.abs(rel) > 44) return null;
            return <span key={i} className="ping-diamond" style={{ left: 160 + rel * 3.2, opacity: 1 - p.age / 3.2 }} />;
          })}
          <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[2px] h-3 bg-[var(--acc)] shadow-[0_0_6px_var(--acc)]" />
        </div>
        <div className="mx-auto mt-0.5 w-12 text-center chamfer-xs hud-chip text-[9px] font-black tracking-widest text-[var(--acc)] py-0.5">
          {Math.round(hud.bearing).toString().padStart(3, '0')}°
        </div>
      </div>

      {/* ============ KILL FEED — compact, max 3 ============ */}
      <div className="absolute top-4 right-4 space-y-1 text-right">
        {fx.feed.slice(-3).map(f => (
          <div key={f.id} className="feed-row chamfer-xs text-[10px] px-2 py-1">
            <span className="text-[var(--acc)] font-black">YOU</span>
            <span className="text-white/30 mx-1">{f.text.split('  ')[1]}</span>
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
      {hud.ads >= 0.3 && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"
          style={{ opacity: Math.min(1, (hud.ads - 0.3) / 0.35) }}
        >
          {hud.weapon.includes('SNIPER') ? (
            <div className="relative w-[420px] h-[420px] flex items-center justify-center">
              {/* sniper vignette */}
              <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle, transparent 62%, rgba(0,0,0,0.92) 78%)', boxShadow: 'inset 0 0 80px rgba(0,0,0,0.9)' }} />
              <div className="absolute rounded-full border border-black/60" style={{ width: 320, height: 320 }} />
              <div className="absolute w-full h-px bg-black/60" style={{ width: 320 }} />
              <div className="absolute h-full w-px bg-black/60" style={{ height: 320 }} />
              {[-48, -32, -16, 16, 32, 48].map(off => (
                <div key={off} className="absolute h-px bg-black/50" style={{ width: off % 32 === 0 ? 14 : 8, transform: `translateY(${off}px)` }} />
              ))}
              {[-48, -32, -16, 16, 32, 48].map(off => (
                <div key={`v-${off}`} className="absolute w-px bg-black/50" style={{ height: off % 32 === 0 ? 14 : 8, transform: `translateX(${off}px)` }} />
              ))}
              <div className="absolute w-1 h-1 rounded-full bg-[#FF2020] shadow-[0_0_6px_#FF2020]" />
              <div className="absolute text-[7px] tracking-widest text-white/25 bottom-[22%]">MIL-DOT  .338 LM  100m</div>
            </div>
          ) : (
            <div className="relative w-8 h-8 flex items-center justify-center">
              <div className="absolute w-5 h-5 rounded-full border border-[#FF2020]/20" />
              <div className="absolute w-1.5 h-1.5 rounded-full bg-[#FF2020] shadow-[0_0_6px_#FF2020]" />
            </div>
          )}
        </div>
      )}
      {hud.canVault && (
        <div className="absolute left-1/2 top-[60%] -translate-x-1/2 chamfer-xs hud-chip px-3 py-1 text-[10px] tracking-[0.24em] font-black text-[var(--acc)]">
          [SPACE] VAULT
        </div>
      )}
      {hud.reloading && (
        <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" width="52" height="52">
          <circle cx="26" cy="26" r="20" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="2.5" />
          <circle cx="26" cy="26" r="20" fill="none" stroke="var(--acc)" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={126} className="reload-ring" transform="rotate(-90 26 26)" />
        </svg>
      )}
      {fx.hitmark && (
        <div key={fx.hitmark.id} className={`absolute left-1/2 top-1/2 ${fx.hitmark.kill ? 'hm-kill' : 'hm'}`}>
          {[45, -45, 135, -135].map(r => (
            <span key={r} style={{
              position: 'absolute', width: 2, height: 9, left: -1, top: -4.5,
              background: fx.hitmark!.kill ? '#FF3B30' : '#fff',
              boxShadow: fx.hitmark!.kill ? '0 0 7px #FF3B30' : '0 0 4px rgba(255,255,255,0.8)',
              transform: `rotate(${r}deg) translateY(-10px)`,
            }} />
          ))}
        </div>
      )}

      {/* ============ DAMAGE ARCS — smaller, directional, not fullscreen ============ */}
      {fx.dmgArcs.slice(-2).map(a => (
        <div key={a.id} className="absolute inset-0 grid place-items-center dmg-arc" style={{ transform: `rotate(${a.dir}deg)` }}>
          <div style={{
            width: '58vmin', height: '58vmin', borderRadius: '50%',
            border: '2px solid transparent', borderTopColor: '#CC0000',
            filter: `drop-shadow(0 -3px 10px rgba(204,0,0,${a.opacity * 0.8}))`, opacity: a.opacity * 0.85,
            clipPath: 'polygon(22% 0%, 78% 0%, 50% 50%)',
          }} />
        </div>
      ))}

      {/* ============ GRENADE WARNING — less intrusive, bottom ============ */}
      {hud.grenadeAngle !== undefined && (
        <div className="absolute left-1/2 bottom-[22%] -translate-x-1/2 flex flex-col items-center nade-warn gap-1">
          <span className="text-[11px] font-black tracking-[0.28em] text-[#FF3B30] px-2 py-0.5 chamfer-xs bg-black/60 border border-[#FF3B30]/40" style={{ textShadow: '0 0 8px #FF3B30' }}>GRENADE {hud.grenadeDist?.toFixed(0)}m</span>
          <div style={{ transform: `rotate(${hud.grenadeAngle}deg)` }}>
            <svg width="32" height="32" viewBox="0 0 40 40"><path d="M20 2L34 30L20 23L6 30L20 2Z" fill="#FF3B30" stroke="#FF8866" strokeWidth="1.5" /></svg>
          </div>
        </div>
      )}

      {/* ============ STREAK BANNER + CALLOUT + SCORE POPS ============ */}
      {fx.banner && !fx.missionBanner && (
        <div key={fx.banner.id} className="absolute left-1/2 top-[28%] -translate-x-1/2 text-center streak">
          <div className="relative px-6">
            <span className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-[var(--acc)] to-transparent streak-line" />
            <div className="text-3xl font-black text-[var(--acc)]" style={{ textShadow: '0 0 20px rgba(242,169,59,0.7)' }}>{fx.banner.label}</div>
          </div>
        </div>
      )}
      {fx.callout && (
        <div key={fx.callout.id} className="mission-radio">
          <span>RADIO</span> {fx.callout.text}
        </div>
      )}
      <div className="absolute left-1/2 top-[55%] -translate-x-1/2 flex flex-col items-center gap-1">
        {fx.scorePops.map(p => (
          <div key={p.id} className={`score-pop font-black tracking-[0.2em] ${p.headshot ? 'text-[#FF3B30] text-[13px]' : 'text-[var(--acc)] text-xs'}`}
            style={{ textShadow: '0 0 10px currentColor' }}>{p.text}</div>
        ))}
      </div>

      {fx.missionBanner && (
        <div key={fx.missionBanner.id} className="mission-phase-banner" role="status">
          <span>{String(fx.missionBanner.index + 1).padStart(2, '0')}</span>{fx.missionBanner.title}
        </div>
      )}

      {/* ============ AMMO — deliberate infinite ammo design ============ */}
      <div className="absolute bottom-6 right-6 text-right">
        <div className="text-[8px] tracking-[0.28em] text-white/40 mb-1">{hud.weapon} <span className="text-[#00FF88]/60">• ARCADE</span></div>
        <div className="flex items-end justify-end gap-2">
          <span key={displayedMag} className={`ammo-num tabnum text-[40px] ${displayedMag === 0 ? 'ammo-empty' : displayedMag <= 5 ? 'ammo-warn' : 'text-white'}`}>
            {displayedMag}
          </span>
          <span className="mb-1.5 text-[10px] tracking-[0.18em] text-[#00FF88] chamfer-xs px-1.5 py-0.5 border border-[#00FF88]/30 bg-[#00FF88]/10">∞ UNLIMITED</span>
        </div>
        <div className="flex gap-[2px] justify-end mt-1.5">
          {Array.from({ length: segs }, (_, i) => (
            <span key={i} className="mag-seg h-[10px]" style={{
              background: i < filled ? (displayedMag <= 5 ? '#FF3B30' : 'var(--acc)') : 'rgba(255,255,255,0.10)',
              boxShadow: i < filled ? '0 0 4px var(--acc)' : 'none',
              transitionDelay: hud.reloading ? `${i * 6}ms` : '0ms',
            }} />
          ))}
        </div>
        <div className="flex justify-end gap-2.5 mt-2 text-[9px] tracking-[0.16em] font-bold">
          <span className={hud.frags > 0 ? 'text-white/70' : 'text-white/20'}><span className="keycap mr-1 text-[8px]">G HOLD</span>×{hud.frags}</span>
          <span className={hud.flashes > 0 ? 'text-white/70' : 'text-white/20'}><span className="keycap mr-1 text-[8px]">F</span>×{hud.flashes}</span>
        </div>
        {hud.cooking && <div className="mt-1 text-[9px] tracking-[0.22em] font-black text-[#FF3B30] blink">◉ COOKING — RELEASE G TO THROW</div>}
        {!hud.reloading && hud.mag <= 5 && hud.mag > 0 && <div className="mt-1 text-[9px] tracking-[0.28em] font-black text-[var(--acc)] blink">RELOAD [R]</div>}
        {!hud.reloading && hud.mag === 0 && <div className="mt-1 text-[9px] tracking-[0.28em] font-black text-[#FF3B30] blink">RELOAD [R]</div>}
      </div>

      {/* ============ VITALS — legible at 720p ============ */}
      <div className="absolute bottom-6 left-6">
        <div className="flex items-center gap-2 mb-1.5">
          <svg width="64" height="18" viewBox="0 0 76 22" className="overflow-visible">
            <polyline points="0,11 14,11 19,4 24,18 29,11 44,11 49,7 54,15 59,11 76,11" fill="none"
              stroke={lowHp ? '#FF3B30' : '#00FF88'} strokeWidth="1.5"
              className="ekg" style={{ animationDuration: lowHp ? '0.6s' : '1.4s' }} />
          </svg>
          <span className={`tabnum text-[18px] font-black ${lowHp ? 'text-[#FF3B30]' : 'text-white/80'}`}>{hud.hp}</span>
          <span className="text-[8px] tracking-widest text-white/30">HP</span>
        </div>
        <div className="text-[8px] tracking-[0.20em] text-white/40 space-y-0.5">
          <div>ELIMINATED <span className="text-white font-black ml-1">{hud.kills}</span></div>
          <div>HOSTILES <span className="text-[#FF6A5A] font-black ml-1">{hud.enemiesLeft}</span></div>
        </div>
      </div>

      {/* ============ FPS — smaller, less intrusive ============ */}
      {s.showFps && (
        <div className="absolute top-4 right-4 mt-[52px] text-right">
          <span className="chamfer-xs hud-chip px-1.5 py-0.5 text-[9px] font-black tabnum" style={{ color: fpsColor }}>{hud.fps} FPS</span>
        </div>
      )}
    </div>
  );
}
