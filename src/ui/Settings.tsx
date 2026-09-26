// Recoil FPS — settings suite (print-room)
import { useState } from 'react';
import type { GameSettings } from '../game/engine';
import { DEFAULT_SETTINGS } from '../game/engine';
import { MAPS, isMissionMap } from '../game/world';
import { GRAPHICS_PRESETS } from '../game/engine';
import { Panel, SectionTitle, Slider, Toggle, Segmented, ColorPick, CBtn } from './components';
import { BINDS } from './bindings';

/** Quality presets, ordered cheapest first. Each maps onto GRAPHICS_PRESETS in
 *  the engine so the menu and the renderer can never disagree about what "High" means. */
const PRESETS: { id: Exclude<GameSettings['graphicsPreset'], 'custom'>; label: string; hint: string }[] = [
  { id: 'performance', label: 'Performance', hint: 'Highest frame rate' },
  { id: 'balanced', label: 'Balanced', hint: 'Integrated graphics' },
  { id: 'high', label: 'High', hint: 'Recommended' },
  { id: 'ultra', label: 'Ultra', hint: 'Discrete GPU' },
];

type Tab = 'gameplay' | 'graphics' | 'audio' | 'interface' | 'crosshair' | 'controls';

const TABS: { id: Tab; label: string }[] = [
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'graphics', label: 'Graphics' },
  { id: 'audio', label: 'Audio' },
  { id: 'interface', label: 'Interface' },
  { id: 'crosshair', label: 'Reticle' },
  { id: 'controls', label: 'Controls' },
];


export default function Settings({ s, set, onClose }: { s: GameSettings; set: (p: Partial<GameSettings>) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('graphics');
  return (
    <div className="settings-layer anim-fade">
      <Panel className="settings-panel anim-rise" pad="p-0">
        <div className="settings-head">
          <div>
            <h2>Settings</h2>
            <p className="mono">Changes apply instantly</p>
          </div>
          <CBtn onClick={onClose}>Close</CBtn>
        </div>

        <div className="settings-body">
          <div className="settings-rail">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`rail-item ${tab === t.id ? 'on' : ''}`} aria-pressed={tab === t.id}>
                <span>{t.label}</span>
              </button>
            ))}
            <div className="rail-foot">
              <CBtn full variant="danger" onClick={() => set(DEFAULT_SETTINGS)}>Restore defaults</CBtn>
            </div>
          </div>

          <div className="settings-pane tac-scroll" key={tab}>
            {tab === 'gameplay' && (
              <div className="anim-fade set-cols">
                <div>
                  <SectionTitle sub="Aim response and field of view">Aim and view</SectionTitle>
                  <Slider label="Mouse sensitivity" value={s.sensitivity} min={0.5} max={10} step={0.1} onChange={v => set({ sensitivity: v })} hint="Horizontal and vertical look speed" />
                  <Slider label="Aim sensitivity" value={s.adsSensitivity} min={0.2} max={1.5} step={0.05} onChange={v => set({ adsSensitivity: v })} hint="Relative speed while aiming" />
                  <Slider label="Field of view" value={s.fov} min={70} max={120} unit="°" onChange={v => set({ fov: v })} />
                  <Toggle label="Invert vertical look" value={s.invertY} onChange={v => set({ invertY: v })} />
                  <Toggle label="Hold to aim" value={!s.adsToggle} onChange={v => set({ adsToggle: !v })} hint={s.adsToggle ? 'Click to toggle scope' : 'Hold right mouse to aim'} />
                  <div className="mt-6">
                    <SectionTitle sub="How crouch and sprint behave">Movement</SectionTitle>
                    <Toggle
                      label="Hold to crouch"
                      value={s.holdToCrouch}
                      onChange={v => set({ holdToCrouch: v })}
                      hint={s.holdToCrouch ? 'Ctrl stays down only while held' : 'Ctrl toggles crouch on and off'}
                    />
                    <Toggle
                      label="Auto sprint"
                      value={s.autoSprint}
                      onChange={v => set({ autoSprint: v })}
                      hint="Break into a sprint after running forward briefly, without holding Shift"
                    />
                  </div>
                  <div className="mt-6">
                    <SectionTitle sub="Enemy reaction and squad tactics">Difficulty</SectionTitle>
                    <Segmented label="Threat level" value={s.difficulty} options={[{ v: 'Easy', l: 'Recruit' }, { v: 'Normal', l: 'Regular' }, { v: 'Hard', l: 'Veteran' }]} onChange={v => set({ difficulty: v })} />
                  </div>
                </div>
                <div>
                  <SectionTitle sub="Applies on next deployment">Area of operations</SectionTitle>
                  <div className="grid grid-cols-1 gap-2">
                    {/* Mission maps only — the arena is selected via Arena Mode on the main menu */}
                    {MAPS.filter(m => isMissionMap(m.id)).map(m => (
                      <button key={m.id} onClick={() => set({ map: m.id })} aria-pressed={s.map === m.id} className={`preset text-left ${s.map === m.id ? 'preset-on' : ''}`}>
                        <div className="text-[13px] font-bold" style={{ fontFamily: 'var(--display)' }}>{m.name}</div>
                        <div className="text-[12px] leading-snug text-[var(--bone-dim)] mt-1">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'graphics' && (
              <div className="anim-fade set-cols">
                <div>
                  <SectionTitle sub="Start here, then fine-tune below">Quality preset</SectionTitle>
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {PRESETS.map(p => (
                      <button
                        key={p.id}
                        onClick={() => set({ ...GRAPHICS_PRESETS[p.id], graphicsPreset: p.id })}
                        aria-pressed={s.graphicsPreset === p.id}
                        className={`preset ${s.graphicsPreset === p.id ? 'preset-on' : ''}`}
                      >
                        <div className="text-[12px] font-bold">{p.label}</div>
                        <div className="mono text-[10px] text-[var(--bone-dim)] mt-0.5">{p.hint}</div>
                      </button>
                    ))}
                  </div>
                  {s.graphicsPreset === 'custom' && (
                    <p className="mono text-[10px] tracking-[0.1em] text-[var(--brass)] uppercase -mt-3 mb-4">Custom — modified from a preset</p>
                  )}

                  <SectionTitle sub="Biggest frame-rate levers, in order">Performance</SectionTitle>
                  <p className="text-[12px] leading-snug text-[var(--bone-dim)] mb-3">
                    Resolution scale and shadows cost the most. Post-processing is fill-rate bound, so on a
                    weak GPU drop the resolution scale before you start turning effects off.
                  </p>
                  <Slider label="Resolution scale" value={s.resolutionScale} min={50} max={100} unit="%" onChange={v => set({ resolutionScale: v, graphicsPreset: 'custom' })} />
                  <Toggle label="Adaptive resolution" value={s.adaptiveResolution ?? true} onChange={v => set({ adaptiveResolution: v, graphicsPreset: 'custom' })} hint="Automatically trade resolution for a stable frame rate" />
                  <Segmented label="Shadows" value={s.shadowQuality} options={[{ v: 'off', l: 'Off' }, { v: 'low', l: 'Low' }, { v: 'medium', l: 'Medium' }, { v: 'high', l: 'High' }]} onChange={v => set({ shadowQuality: v, graphicsPreset: 'custom' })} />
                  <Segmented label="Texture detail" value={s.textureQuality} options={[{ v: 'low', l: 'Low' }, { v: 'medium', l: 'Medium' }, { v: 'high', l: 'High' }]} onChange={v => set({ textureQuality: v, graphicsPreset: 'custom' })} />
                  <p className="text-[11px] leading-snug text-[var(--bone-mute)] -mt-2 mb-4">Texture detail changes on the next deployment.</p>
                </div>

                <div>
                  <SectionTitle sub="Post-processing and colour">Image</SectionTitle>
                  <Toggle label="Post-processing" value={s.postProcess} onChange={v => set({ postProcess: v, graphicsPreset: 'custom' })} hint="Anti-aliasing, colour grade and sharpening" />
                  <Toggle label="Sun shafts" value={s.sunShafts} onChange={v => set({ sunShafts: v, graphicsPreset: 'custom' })} hint="Volumetric light through the haze" />
                  <Toggle label="Bloom" value={s.bloom} onChange={v => set({ bloom: v, graphicsPreset: 'custom' })} />
                  {s.bloom && <Slider label="Bloom strength" value={s.bloomStrength} min={0} max={100} onChange={v => set({ bloomStrength: v, graphicsPreset: 'custom' })} />}
                  <Slider label="Sharpness" value={s.sharpness} min={0} max={100} onChange={v => set({ sharpness: v, graphicsPreset: 'custom' })} hint="Recovers detail lost to anti-aliasing" />
                  <Slider label="Chromatic aberration" value={s.aberration} min={0} max={100} onChange={v => set({ aberration: v, graphicsPreset: 'custom' })} />
                  <Slider label="Brightness" value={s.brightness} min={80} max={170} unit="%" onChange={v => set({ brightness: v })} />
                  <Slider label="Vignette" value={s.vignette} min={0} max={70} onChange={v => set({ vignette: v })} />
                  <Slider label="Film grain" value={s.filmGrain} min={0} max={100} onChange={v => set({ filmGrain: v })} />
                  <Slider label="Camera shake" value={s.cameraShake} min={0} max={100} unit="%" onChange={v => set({ cameraShake: v })} />
                </div>
              </div>
            )}

            {tab === 'audio' && (
              <div className="anim-fade set-cols">
                <div>
                  <SectionTitle sub="Independent buses — set the balance you want">Mix</SectionTitle>
                  <Slider label="Master volume" value={s.masterVolume} min={0} max={100} unit="%" onChange={v => set({ masterVolume: v })} />
                  <Slider label="Weapons and effects" value={s.sfxVolume} min={0} max={100} unit="%" onChange={v => set({ sfxVolume: v })} />
                  <Slider
                    label="Footsteps"
                    value={s.footstepVolume} min={0} max={150} unit="%"
                    onChange={v => set({ footstepVolume: v })}
                    hint="Footsteps ride their own bus. Push past 100% to hear enemies sooner."
                  />
                  <Slider label="Music" value={s.musicVolume} min={0} max={100} unit="%" onChange={v => set({ musicVolume: v })} />
                  <Toggle label="Voice lines" value={s.voices} onChange={v => set({ voices: v })} hint="Announcer and squad chatter" />
                </div>
                <div>
                  <SectionTitle sub="How far apart the quietest and loudest sounds sit">Dynamic range</SectionTitle>
                  <Segmented
                    label="Range"
                    value={s.dynamicRange}
                    options={[{ v: 'night', l: 'Night' }, { v: 'normal', l: 'Normal' }, { v: 'wide', l: 'Wide' }]}
                    onChange={v => set({ dynamicRange: v })}
                  />
                  <div className="mt-4 p-4 audio-block">
                    <p className="text-[13px] leading-relaxed text-[var(--bone-dim)]">
                      <b className="text-[var(--bone)]">Night</b> heavily compresses the mix so gunfire will not
                      wake the house and quiet footsteps stay audible.<br />
                      <b className="text-[var(--bone)]">Normal</b> is a light broadcast-style compression.<br />
                      <b className="text-[var(--bone)]">Wide</b> bypasses compression entirely for headphones —
                      the loudest weapons hit much harder.
                    </p>
                  </div>
                  <div className="mt-4 p-4 audio-block">
                    <p className="text-[13px] leading-relaxed text-[var(--bone-dim)]">
                      Positional audio uses HRTF panning. Indoor spaces switch to a shorter, denser
                      reverb automatically, and footsteps are layered per surface — sand, concrete,
                      wood, metal, gravel and grass all sound different.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {tab === 'interface' && (
              <div className="anim-fade set-cols">
                <div>
                  <SectionTitle sub="Readability and scaling">HUD</SectionTitle>
                  <Slider label="HUD scale" value={s.hudScale} min={80} max={130} unit="%" onChange={v => set({ hudScale: v })} hint="Scales every HUD element together" />
                  <Slider label="Minimap zoom" value={s.minimapZoom} min={70} max={160} unit="%" onChange={v => set({ minimapZoom: v })} />
                  <Toggle label="Show FPS" value={s.showFps} onChange={v => set({ showFps: v })} />
                  <Toggle
                    label="Performance overlay"
                    value={s.perfOverlay}
                    onChange={v => set({ perfOverlay: v })}
                    hint="Frame time, draw calls, triangles and shader count"
                  />
                </div>
                <div>
                  <SectionTitle sub="Combat readouts">Feedback</SectionTitle>
                  <Toggle label="Damage numbers" value={s.damageNumbers} onChange={v => set({ damageNumbers: v })} hint="Floating damage over the target you hit" />
                  <Toggle label="Damage log" value={s.showDamageLog} onChange={v => set({ showDamageLog: v })} hint="Rolling list of recent damage dealt, by target" />
                  <div className="mt-6">
                    <SectionTitle sub="Remaps friendly and hostile colours">Colour vision</SectionTitle>
                    <Segmented
                      label="Mode"
                      value={s.colorBlindMode}
                      options={[{ v: 'off', l: 'Off' }, { v: 'protanopia', l: 'Prot.' }, { v: 'deuteranopia', l: 'Deut.' }, { v: 'tritanopia', l: 'Trit.' }]}
                      onChange={v => set({ colorBlindMode: v })}
                    />
                    <p className="text-[12px] leading-snug text-[var(--bone-dim)] mt-2">
                      Changes the hostile/friendly palette rather than tinting the whole screen, so
                      contrast against the environment is preserved.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {tab === 'crosshair' && (
              <div className="anim-fade">
                <SectionTitle sub="Live preview below">Reticle</SectionTitle>
                <div className="flex gap-6 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <ColorPick label="Color" value={s.crosshairColor} onChange={v => set({ crosshairColor: v })} />
                    <Slider label="Length" value={s.crosshairSize} min={3} max={24} onChange={v => set({ crosshairSize: v })} />
                    <Slider label="Gap" value={s.crosshairGap} min={0} max={26} onChange={v => set({ crosshairGap: v })} />
                    <Slider label="Thickness" value={s.crosshairThickness} min={1} max={6} onChange={v => set({ crosshairThickness: v })} />
                    <Toggle label="Center dot" value={s.crosshairDot} onChange={v => set({ crosshairDot: v })} />
                  </div>
                  <div className="w-60 shrink-0 rounded-[3px] border border-[var(--line)] bg-[var(--ink)] relative overflow-hidden grid place-items-center" style={{ minHeight: 210 }}>
                    <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(rgba(237,228,211,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(237,228,211,0.12) 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
                    <Reticle s={s} />
                    <span className="absolute bottom-2 text-[10px] tracking-[0.12em] text-[var(--bone-mute)] uppercase">Preview</span>
                  </div>
                </div>
              </div>
            )}

            {tab === 'controls' && (
              <div className="anim-fade">
                <SectionTitle sub="Reference — bindings are fixed">Key bindings</SectionTitle>
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
  // Arms glide on spread changes: bloom growth and the kill-confirm pulse read as
  // a kick, not a flicker. 160 ms matches the HUD poll cadence (50 ms) ×3.
  const arm = (st: React.CSSProperties) => <span style={{ position: 'absolute', background: C, boxShadow: '0 1px 2px rgba(0,0,0,0.65)', transition: 'top 160ms ease-out, left 160ms ease-out', ...st }} />;
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
