// Recoil FPS — full settings suite (VOLT PROTOCOL)
import { useState } from 'react';
import type { GameSettings } from '../game/engine';
import { DEFAULT_SETTINGS } from '../game/engine';
import { MAPS } from '../game/world';
import { Panel, SectionTitle, Slider, Toggle, Segmented, ColorPick, CBtn } from './components';

const PRESETS: { id: string; label: string; hint: string; tag: string; v: Partial<GameSettings> }[] = [
  { id: 'perf', label: 'PERFORMANCE', hint: 'Max FPS', tag: 'FPS', v: { resolutionScale: 60, shadowQuality: 'off', bloom: false, vignette: 0, filmGrain: 0 } },
  { id: 'bal', label: 'BALANCED', hint: 'Recommended', tag: 'DEFAULT', v: { resolutionScale: 100, shadowQuality: 'low', bloom: false, bloomStrength: 22, vignette: 12, filmGrain: 0 } },
  { id: 'qual', label: 'QUALITY', hint: 'Strong GPU', tag: 'GPU', v: { resolutionScale: 100, shadowQuality: 'medium', bloom: true, bloomStrength: 30, vignette: 18, filmGrain: 0 } },
  { id: 'ultra', label: 'CINEMATIC', hint: 'Soft highlights', tag: 'MAX', v: { resolutionScale: 100, shadowQuality: 'medium', bloom: true, bloomStrength: 34, vignette: 20, filmGrain: 0 } },
];

type Tab = 'gameplay' | 'graphics' | 'audio' | 'crosshair' | 'controls';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'gameplay', label: 'GAMEPLAY', icon: '◈' },
  { id: 'graphics', label: 'GRAPHICS', icon: '◆' },
  { id: 'audio', label: 'AUDIO', icon: '◉' },
  { id: 'crosshair', label: 'RETICLE', icon: '+' },
  { id: 'controls', label: 'CONTROLS', icon: '⌨' },
];

const BINDS: [string, string][] = [
  ['MOVE', 'W A S D'], ['SPRINT', 'SHIFT'], ['CROUCH', 'C'], ['SLIDE', 'SPRINT + C'],
  ['JUMP / VAULT', 'SPACE'], ['FIRE', 'MOUSE 1'], ['SCOPE (ADS)', 'MOUSE 2'], ['RELOAD', 'R'],
  ['LEAN LEFT (HOLD)', 'Q'], ['LEAN RIGHT (HOLD)', 'E'], ['FRAG (5×)', 'HOLD G'], ['FLASHBANG', 'F'],
  ['PRIMARY / SIDEARM', '1 / 2'], ['LAST WEAPON (TAP)', 'Q'],
  ['ATTACH / DETONATE', 'X'], ['PAUSE', 'ESC'],
];

export default function Settings({ s, set, onClose }: { s: GameSettings; set: (p: Partial<GameSettings>) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('graphics');

  return (
    <div className="settings-layer anim-fade">
      <Panel className="settings-panel anim-rise" pad="p-0">
        {/* header */}
        <div className="settings-head">
          <div>
            <h2>Settings</h2>
            <p className="mono">Changes apply instantly</p>
          </div>
          <CBtn onClick={onClose}>× CLOSE</CBtn>
        </div>

        <div className="settings-body">
          {/* tab rail */}
          <div className="settings-rail">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`rail-item ${tab === t.id ? 'on' : ''}`} aria-pressed={tab === t.id}>
                <span className="rail-icon">{t.icon}</span>
                <span>{t.label}</span>
                <span className="rail-chev">▸</span>
              </button>
            ))}
            <div className="rail-foot">
              <CBtn full variant="danger" onClick={() => set(DEFAULT_SETTINGS)}>RESTORE DEFAULTS</CBtn>
            </div>
          </div>

          {/* panes */}
          <div className="settings-pane tac-scroll" key={tab}>
            {tab === 'gameplay' && (
              <div className="anim-fade-fast">
                <SectionTitle sub="Aim response and field of view">AIM &amp; VIEW</SectionTitle>
                <Slider label="MOUSE SENSITIVITY" value={s.sensitivity} min={0.5} max={10} step={0.1} onChange={v => set({ sensitivity: v })} hint="Horizontal + vertical look speed" />
                <Slider label="ADS SENSITIVITY MULTIPLIER" value={s.adsSensitivity} min={0.2} max={1.5} step={0.05} onChange={v => set({ adsSensitivity: v })} hint="Relative look speed while aiming down sights" />
                <Slider label="FIELD OF VIEW" value={s.fov} min={70} max={120} unit="°" onChange={v => set({ fov: v })} hint="Higher = wider peripheral vision" />
                <Toggle label="INVERT VERTICAL LOOK" value={s.invertY} onChange={v => set({ invertY: v })} />
                <Toggle label="ADS TOGGLE" value={s.adsToggle} onChange={v => set({ adsToggle: v })} hint="Off: hold Mouse 2 to aim. On: click Mouse 2 to keep the scope in, click again to lower it." />
                <div className="mt-6">
                  <SectionTitle sub="Enemy reaction time, accuracy and squad tactics">COMBAT DIFFICULTY</SectionTitle>
                  <Segmented label="THREAT LEVEL" value={s.difficulty}
                    options={[{ v: 'Easy', l: 'RECRUIT' }, { v: 'Normal', l: 'REGULAR' }, { v: 'Hard', l: 'VETERAN' }]}
                    onChange={v => set({ difficulty: v })} hint="Applies on next deployment" />
                </div>
                <div className="mt-6">
                  <SectionTitle sub="Applies on next deployment">AREA OF OPERATIONS</SectionTitle>
                  <div className="grid grid-cols-2 gap-2">
                    {MAPS.map(m => (
                      <button key={m.id} onClick={() => set({ map: m.id })} aria-pressed={s.map === m.id}
                        className={`preset text-left p-3! ${s.map === m.id ? 'preset-on' : ''}`}>
                        <div className="text-[10px] font-black tracking-[0.18em]" style={{ fontFamily: 'Orbitron' }}>{m.name}</div>
                        <div className="text-[8px] leading-relaxed text-white/45 mt-1">{m.desc}</div>
                        <div className="mono text-[8px] text-[var(--cyber)] mt-1.5">5 OBJECTIVES / REINFORCEMENTS</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'graphics' && (
              <div className="anim-fade-fast">
                <SectionTitle sub="One-click profiles — fine-tune below">QUALITY PRESET</SectionTitle>
                <div className="grid grid-cols-4 gap-2 mb-5">
                  {PRESETS.map(p => {
                    const on = p.v.resolutionScale === s.resolutionScale && p.v.shadowQuality === s.shadowQuality && p.v.bloom === s.bloom;
                    return (
                      <button key={p.id} onClick={() => set(p.v)} aria-pressed={on} className={`preset ${on ? 'preset-on' : ''}`}>
                        <div className="text-[10px] font-black tracking-[0.16em]">{p.label}</div>
                        <div className="mono text-[8px] text-white/40 mt-0.5">{p.hint}</div>
                        <div className={`mono text-[7px] tracking-[0.2em] mt-1 ${on ? 'text-[var(--acc)]' : 'text-[var(--cyber)]'}`}>{p.tag}</div>
                      </button>
                    );
                  })}
                </div>
                <SectionTitle sub="Lower these first if the game feels sluggish">PERFORMANCE</SectionTitle>
                <Slider label="RESOLUTION SCALE" value={s.resolutionScale} min={40} max={100} unit="%" onChange={v => set({ resolutionScale: v })} hint="Render resolution. Higher values improve distant detail." />
                <Segmented label="SHADOW QUALITY" value={s.shadowQuality}
                  options={[{ v: 'off', l: 'OFF' }, { v: 'low', l: 'LOW' }, { v: 'medium', l: 'MED' }, { v: 'high', l: 'HIGH' }]}
                  onChange={v => set({ shadowQuality: v })} hint="Second biggest FPS cost" />
                <Toggle label="ADAPTIVE RESOLUTION" value={s.adaptiveResolution ?? true} onChange={v => set({adaptiveResolution:v})} hint="Lower resolution under sustained load. Disable for fixed image quality." />
                <Toggle label="SHOW FPS COUNTER" value={s.showFps} onChange={v => set({ showFps: v })} />

                <div className="mt-6">
                  <SectionTitle sub="Visual finish and image clarity">IMAGE</SectionTitle>
                  <Slider label="BRIGHTNESS / EXPOSURE" value={s.brightness} min={80} max={170} unit="%" onChange={v => set({ brightness: v })} hint="Raise if the map looks too dark" />
                  <Toggle label="BLOOM" value={s.bloom} onChange={v => set({ bloom: v })} hint="Glow on bright highlights" />
                  {s.bloom && <Slider label="BLOOM STRENGTH" value={s.bloomStrength} min={0} max={100} onChange={v => set({ bloomStrength: v })} />}
                  <Slider label="VIGNETTE" value={s.vignette} min={0} max={70} onChange={v => set({ vignette: v })} hint="Screen-edge darkening — set 0 for maximum clarity" />
                  <Slider label="FILM GRAIN" value={s.filmGrain} min={0} max={100} onChange={v => set({ filmGrain: v })} hint="Off by default — reduces clarity" />
                  <Slider label="CAMERA SHAKE" value={s.cameraShake} min={0} max={100} unit="%" onChange={v => set({ cameraShake: v })} hint="Impact and explosion shake intensity" />
                </div>
              </div>
            )}

            {tab === 'audio' && (
              <div className="anim-fade-fast">
                <SectionTitle sub="Spatial HRTF audio mix">SOUND</SectionTitle>
                <Slider label="MASTER VOLUME" value={s.masterVolume} min={0} max={100} unit="%" onChange={v => set({ masterVolume: v })} />
                <Toggle label="VOICE LINES" value={s.voices} onChange={v => set({ voices: v })} hint="Announcer callouts and enemy squad chatter" />
                <div className="mt-6 p-4 audio-block">
                  <div className="audio-wave mb-3" aria-hidden="true">
                    {Array.from({ length: 36 }, (_, i) => <i key={i} />)}
                  </div>
                  <p className="mono text-[9px] text-white/40 leading-relaxed">
                    AUDIO ENGINE: WEB AUDIO HRTF · INVERSE DISTANCE MODEL · REF 1M · MAX 80M<br />
                    Enemy gunfire, grenades and impacts are positioned in true 3D space.
                  </p>
                </div>
              </div>
            )}

            {tab === 'crosshair' && (
              <div className="anim-fade-fast">
                <SectionTitle sub="Live preview shown below">RETICLE DESIGN</SectionTitle>
                <div className="flex gap-6 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <ColorPick label="COLOR" value={s.crosshairColor} onChange={v => set({ crosshairColor: v })} />
                    <Slider label="LENGTH" value={s.crosshairSize} min={3} max={24} onChange={v => set({ crosshairSize: v })} />
                    <Slider label="GAP" value={s.crosshairGap} min={0} max={26} onChange={v => set({ crosshairGap: v })} />
                    <Slider label="THICKNESS" value={s.crosshairThickness} min={1} max={6} onChange={v => set({ crosshairThickness: v })} />
                    <Toggle label="CENTER DOT" value={s.crosshairDot} onChange={v => set({ crosshairDot: v })} />
                  </div>
                  <div className="w-60 shrink-0 cut-sm border border-white/10 bg-[#05070b] relative overflow-hidden grid place-items-center" style={{ minHeight: 210 }}>
                    <div className="absolute inset-0 opacity-30 minimap-grid" />
                    <div className="absolute inset-0 scanlines opacity-20 pointer-events-none" />
                    <Reticle s={s} />
                    <span className="absolute bottom-2 left-0 right-0 text-center mono text-[8px] text-[var(--cyber)]">LIVE PREVIEW</span>
                    <span className="brk brk-tl" /><span className="brk brk-tr" /><span className="brk brk-bl" /><span className="brk brk-br" />
                  </div>
                </div>
              </div>
            )}

            {tab === 'controls' && (
              <div className="anim-fade-fast">
                <SectionTitle sub="Reference — bindings are fixed in this build">KEY BINDINGS</SectionTitle>
                <div className="grid grid-cols-2 gap-x-8">
                  {BINDS.map(([a, k]) => (
                    <div key={a} className="bind-row">
                      <span>{a}</span>
                      <span className="keycap">{k}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function Reticle({ s, spread = 0 }: { s: GameSettings; spread?: number }) {
  const gap = s.crosshairGap + spread;
  const L = s.crosshairSize, T = s.crosshairThickness, C = s.crosshairColor;
  const arm = (st: React.CSSProperties) => (
    <span style={{ position: 'absolute', background: C, boxShadow: `0 0 5px ${C}, 0 0 1px #000`, ...st }} />
  );
  return (
    <div className="relative" style={{ width: 0, height: 0 }}>
      {arm({ width: T, height: L, left: -T / 2, top: -gap - L })}
      {arm({ width: T, height: L, left: -T / 2, top: gap })}
      {arm({ width: L, height: T, top: -T / 2, left: -gap - L })}
      {arm({ width: L, height: T, top: -T / 2, left: gap })}
      {s.crosshairDot && arm({ width: T, height: T, left: -T / 2, top: -T / 2, borderRadius: '50%' })}
    </div>
  );
}
