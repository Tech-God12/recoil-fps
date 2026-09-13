// Recoil FPS — in-game HUD (VOLT PROTOCOL)
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
  const fpsColor = hud.fps >= 55 ? 'var(--volt)' : hud.fps >= 35 ? 'var(--warn)' : 'var(--danger)';
  const hpSegs = 10;
  const hpFilled = Math.min(hpSegs, Math.max(0, Math.ceil(hud.hp / 100 * hpSegs)));

  return (
    <div className="hud-root pointer-events-none select-none">
      {/* HUD frame corners + ambient scanlines */}
      <span className="hud-corner tl" /><span className="hud-corner tr" />
      <span className="hud-corner bl" /><span className="hud-corner br" />
      <div className="hud-scan scanlines" aria-hidden="true" />

      {/* damage vignette */}
      {vig > 0 && (
        <div className={`absolute inset-0 ${lowHp ? 'hp-pulse' : ''}`}
          style={{ boxShadow: `inset 0 0 ${120 + vig * 200}px rgba(255,46,77,${0.25 + vig * 0.6})` }} />
      )}
      {/* flashbang */}
      <div className="absolute inset-0 bg-white" style={{ opacity: fx.flashPow, transition: fx.flashPow > 0 ? 'opacity 30ms' : 'opacity 2400ms' }} />
      {hud.mission && <MissionObjective mission={hud.mission} />}

      {/* ============ THREAT PROXIMITY INDICATOR ============ */}
      {hud.nearest && (() => {
        const n = hud.nearest;
        const hot = n.dist < 12, warm = n.dist < 30;
        const color = hot ? '#FF2E4D' : warm ? '#FFC400' : 'rgba(255,255,255,0.55)';
        const R = 92;
        const a = (n.angle - 90) * Math.PI / 180;
        const ax = Math.cos(a) * R, ay = Math.sin(a) * R;
        return (
          <div className="absolute left-1/2 top-1/2" style={{ opacity: hud.ads > 0.6 ? 0.35 : 1, transition: 'opacity .2s' }}>
            <div className="absolute rounded-full border" style={{ width: R * 2, height: R * 2, left: -R, top: -R, borderColor: 'rgba(255,255,255,0.07)' }} />
            <div className={`absolute ${hot ? 'prox-hot' : ''}`} style={{ left: ax, top: ay, transform: `translate(-50%,-50%) rotate(${n.angle}deg)` }}>
              <svg width="26" height="26" viewBox="0 0 26 26"><path d="M13 2 L22 20 L13 15 L4 20 Z" fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} /></svg>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 cut-xs hud-chip px-2 py-0.5" style={{ top: 34 }}>
              <span className="w-1.5 h-1.5 rotate-45" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
              <span className="tabnum text-[11px] font-black" style={{ color }}>{n.dist < 10 ? n.dist.toFixed(1) : Math.round(n.dist)}m</span>
              {Math.abs(n.above) > 1.8 && <span className="text-[9px] text-white/60">{n.above > 0 ? '▲' : '▼'}</span>}
              <span className="mono text-[8px] text-white/40 ml-1">{hud.enemiesLeft} LEFT</span>
            </div>
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
                <i style={{ width: 1, height: card ? 9 : inter ? 6 : 3, background: card ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.45)', boxShadow: card ? '0 0 6px rgba(255,255,255,.5)' : 'none' }} />
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
        <div className="compass-bear cut-xs hud-chip">{Math.round(hud.bearing).toString().padStart(3, '0')}<span> DEG</span></div>
      </div>

      {/* ============ KILL FEED + FPS ============ */}
      <div className="absolute top-4 right-5 flex flex-col items-end gap-1.5">
        {fx.feed.map(f => (
          <div key={f.id} className="feed-row text-right">
            <span className="text-[var(--acc)] font-black">YOU</span>
            <span className="mono text-[var(--cyber)] text-[9px] mx-1.5">{f.text.split('  ')[1]}</span>
            {f.headshot && <span className="text-[var(--danger)] font-black mr-1">☠</span>}
            <span className="text-white/90">{f.text.split('  ')[2]}</span>
          </div>
        ))}
        {s.showFps && (
          <span className="fps-chip cut-xs hud-chip" style={{ color: fpsColor }}>{hud.fps} FPS</span>
        )}
      </div>

      {/* ============ CENTER STACK ============ */}
      {hud.ads < 0.3 && !hud.sprinting && (
        <div className="absolute left-1/2 top-1/2" style={{ opacity: 1 - hud.ads / 0.3 }}>
          <Reticle s={s} spread={(hud.spread || 0) * 520} />
        </div>
      )}
      {hud.ads >= 0.3 && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"
          style={{ opacity: Math.min(1, (hud.ads - 0.3) / 0.4) }}
        >
          {hud.weapon.includes('SNIPER') ? (
            <div className="relative w-[320px] h-[320px] rounded-full shadow-[0_0_60px_rgba(0,0,0,0.85)] flex items-center justify-center">
              <div className="absolute rounded-full ring-1 ring-black/60" style={{ inset: 6 }} />
              <div className="absolute w-full h-px bg-black/75" />
              <div className="absolute h-full w-px bg-black/75" />
              {[-16, -8, 8, 16].map(offset => (
                <div key={offset} className="absolute h-px bg-black/60" style={{ width: 12, transform: `translateY(${offset}px)` }} />
              ))}
              {[-16, -8, 8, 16].map(offset => (
                <div key={`v-${offset}`} className="absolute w-px bg-black/60" style={{ height: 12, transform: `translateX(${offset}px)` }} />
              ))}
              <div className="absolute w-1.5 h-1.5 rounded-full bg-[var(--danger)] shadow-[0_0_9px_var(--danger)]" />
            </div>
          ) : (
            <div className="relative w-9 h-9 flex items-center justify-center">
              <div className="absolute w-6 h-6 rounded-full border border-[var(--danger)]/30" />
              <div className="absolute w-1.5 h-1.5 rounded-full bg-[var(--danger)] shadow-[0_0_8px_var(--danger)]" />
            </div>
          )}
        </div>
      )}
      {hud.canVault && (
        <div className="absolute left-1/2 top-[58%] -translate-x-1/2 vault-chip cut-xs hud-chip">
          [SPACE] VAULT
        </div>
      )}
      {hud.reloading && (
        <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" width="64" height="64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--acc)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={163} className="reload-ring" transform="rotate(-90 32 32)"
            style={{ filter: 'drop-shadow(0 0 6px rgba(255,92,26,.8))' }} />
        </svg>
      )}
      {fx.hitmark && (
        <div key={fx.hitmark.id} className={`absolute left-1/2 top-1/2 ${fx.hitmark.kill ? 'hm-kill' : 'hm'}`}>
          {[45, -45, 135, -135].map(r => (
            <span key={r} style={{
              position: 'absolute', width: 2, height: fx.hitmark!.kill ? 14 : 10, left: -1, top: fx.hitmark!.kill ? -7 : -5,
              background: fx.hitmark!.kill ? '#FF2E4D' : '#fff',
              boxShadow: fx.hitmark!.kill ? '0 0 10px #FF2E4D' : '0 0 4px rgba(255,255,255,.8)',
              transform: `rotate(${r}deg) translateY(${fx.hitmark!.kill ? -13 : -11}px)`,
            }} />
          ))}
        </div>
      )}

      {/* ============ DAMAGE ARCS ============ */}
      {fx.dmgArcs.map(a => (
        <div key={a.id} className="absolute inset-0 grid place-items-center dmg-arc" style={{ transform: `rotate(${a.dir}deg)` }}>
          <div style={{
            width: '74vmin', height: '74vmin', borderRadius: '50%',
            border: '3px solid transparent', borderTopColor: '#FF2E4D',
            filter: `drop-shadow(0 -4px 16px rgba(255,46,77,${a.opacity}))`, opacity: a.opacity,
            clipPath: 'polygon(18% 0%, 82% 0%, 50% 50%)',
          }} />
        </div>
      ))}

      {/* ============ GRENADE WARNING ============ */}
      {hud.grenadeAngle !== undefined && (
        <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center nade-warn">
          <span className="text-[15px] font-black tracking-[0.3em] text-[var(--danger)] glow-red">GRENADE</span>
          <div style={{ transform: `rotate(${hud.grenadeAngle}deg)` }}>
            <svg width="46" height="46" viewBox="0 0 40 40"><path d="M20 2L34 30L20 23L6 30L20 2Z" fill="#FF2E4D" stroke="#FF8A98" strokeWidth="2" /></svg>
          </div>
          <span className="mono text-[10px] text-white/85">{hud.grenadeDist?.toFixed(1)}m</span>
        </div>
      )}

      {/* ============ STREAK BANNER + CALLOUT + SCORE POPS ============ */}
      {fx.banner && !fx.missionBanner && (
        <div key={fx.banner.id} className="absolute left-1/2 top-[30%] -translate-x-1/2 text-center streak">
          <div className="relative px-8">
            <span className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-[var(--acc)] to-transparent streak-line" />
            <div className="text-4xl font-black text-[var(--acc)] glow-acc">{fx.banner.label}</div>
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
          <div key={p.id} className={`score-pop font-black tracking-[0.22em] ${p.headshot ? 'text-[var(--danger)] text-base glow-red' : 'text-[var(--acc)] text-sm glow-acc'}`}>{p.text}</div>
        ))}
      </div>

      {fx.missionBanner && (
        <div key={fx.missionBanner.id} className="mission-phase-banner" role="status">
          <span>{String(fx.missionBanner.index + 1).padStart(2, '0')}</span>{fx.missionBanner.title}
        </div>
      )}

      {/* ============ TACTICAL RADAR ============ */}
      {hud.mapImage && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <div className="radar" style={{ opacity: hud.ads > 0.6 ? 0.3 : 1, transition: 'opacity .2s' }}>
            <div className="radar-world" style={{ transform: `rotate(${-hud.bearing}deg)` }}>
              <img
                src={hud.mapImage}
                alt=""
                draggable={false}
                className="radar-map"
                style={{ transform: `translate(${(0.5 - hud.playerMap.nx) * 100}%, ${(0.5 - hud.playerMap.nz) * 100}%)` }}
              />
              {hud.enemiesMap.map((e, i) => (
                <span key={i} className="radar-enemy" style={{ left: `${e.nx * 100}%`, top: `${e.nz * 100}%` }} />
              ))}
            </div>
            <div className="radar-spin" style={{ transform: `rotate(${-hud.bearing}deg)` }} aria-hidden="true">
              <span className="radar-card" style={{ top: 3, left: '50%', marginLeft: -3 }}>N</span>
              <span className="radar-card" style={{ bottom: 3, left: '50%', marginLeft: -3 }}>S</span>
              <span className="radar-card" style={{ left: 5, top: '50%', marginTop: -4 }}>W</span>
              <span className="radar-card" style={{ right: 5, top: '50%', marginTop: -4 }}>E</span>
            </div>
            <span className="radar-rings" /><span className="radar-rings r2" /><span className="radar-rings r3" />
            <span className="radar-sweep" />
            <span className="radar-player" />
            <span className="radar-label">60M RANGE</span>
            <span className="radar-frame" />
          </div>
        </div>
      )}

      {/* ============ AMMO ============ */}
      <div className="absolute bottom-7 right-8 text-right">
        <div className="weapon-name">{hud.weapon}</div>
        <div className="flex items-end justify-end gap-2.5">
          <span key={displayedMag} className={`ammo-num tabnum ${displayedMag === 0 ? 'ammo-empty' : displayedMag <= 5 ? 'ammo-warn' : ''}`}>
            {displayedMag}
          </span>
          <span className="reserve-chip mb-1">∞</span>
        </div>
        <div className="flex gap-[2px] justify-end mt-2">
          {Array.from({ length: segs }, (_, i) => (
            <span key={i} className="mag-seg" style={{
              background: i < filled ? (displayedMag <= 5 ? 'var(--danger)' : 'var(--acc)') : 'rgba(255,255,255,0.12)',
              boxShadow: i < filled ? `0 0 5px ${displayedMag <= 5 ? 'var(--danger)' : 'var(--acc)'}` : 'none',
              transitionDelay: hud.reloading ? `${i * 8}ms` : '0ms',
            }} />
          ))}
        </div>
        <div className="flex justify-end gap-3 mt-2.5 nade-row">
          <span className={hud.frags > 0 ? 'text-white/75' : 'text-white/20'}><span className="keycap mr-1">G</span>FRAG ×{hud.frags}</span>
          <span className={hud.flashes > 0 ? 'text-white/75' : 'text-white/20'}><span className="keycap mr-1">F</span>FLASH ×{hud.flashes}</span>
        </div>
        {hud.cooking && <div className="mt-1.5 cook-warn">◉ COOKING — RELEASE G</div>}
        {!hud.reloading && hud.mag <= 5 && <div className="mt-1.5 text-[10px] tracking-[0.3em] font-black text-[var(--warn)] blink">RELOAD</div>}
      </div>

      {/* ============ VITALS ============ */}
      <div className="absolute bottom-7 left-8">
        <div className="vitals cut-sm hud-chip">
          <div className="vitals-head"><span className="live-dot" />VITALS</div>
          <div className="flex items-end gap-3 mt-1">
            <span className={`hp-num ${lowHp ? 'low' : ''}`}>{hud.hp}</span>
            <svg width="76" height="22" viewBox="0 0 76 22" className="overflow-visible mb-1">
              <polyline points="0,11 14,11 19,4 24,18 29,11 44,11 49,7 54,15 59,11 76,11" fill="none"
                stroke={lowHp ? '#FF2E4D' : '#38FF9B'} strokeWidth="1.6"
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
          </div>
        </div>
      </div>
    </div>
  );
}
