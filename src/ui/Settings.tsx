// Recoil FPS — settings suite (print-room)
import { useState } from 'react';
import type { GameSettings } from '../game/engine';
import { DEFAULT_SETTINGS } from '../game/engine';
import { MAPS } from '../game/world';
import { Panel, SectionTitle, Slider, Toggle, Segmented, ColorPick, CBtn } from './components';

const PRESETS: { id: string; label: string; hint: string; tag: string; v: Partial<GameSettings> }[] = [
  { id: 'perf', label: 'Performance', hint: 'Max FPS', tag: 'FPS', v: { resolutionScale: 60, shadowQuality: 'off', bloom: false, vignette: 0, filmGrain: 0 } },
  { id: 'bal', label: 'Balanced', hint: 'Recommended', tag: 'Default', v: { resolutionScale: 100, shadowQuality: 'low', bloom: false, bloomStrength: 22, vignette: 12, filmGrain: 0 } },
  { id: 'qual', label: 'Quality', hint: 'Strong GPU', tag: 'GPU', v: { resolutionScale: 100, shadowQuality: 'medium', bloom: true, bloomStrength: 30, vignette: 18, filmGrain: 0 } },
  { id: 'ultra', label: 'Cinematic', hint: 'Soft highlights', tag: 'Max', v: { resolutionScale: 100, shadowQuality: 'medium', bloom: true, bloomStrength: 34, vignette: 20, filmGrain: 0 } },
];

type Tab = 'gameplay' | 'graphics' | 'audio' | 'crosshair' | 'controls';

const TABS: { id: Tab; label: string }[] = [
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'graphics', label: 'Graphics' },
  { id: 'audio', label: 'Audio' },
  { id: 'crosshair', label: 'Reticle' },
  { id: 'controls', label: 'Controls' },
];

const BINDS: [string, string][] = [
  ['Move', 'WASD'], ['Sprint', 'Shift'], ['Crouch', 'C'], ['Slide', 'Sprint + C'],
  ['Jump / Vault', 'Space'], ['Fire', 'Mouse Left'], ['Aim', 'Mouse Right'], ['Reload', 'R'],
  ['Lean left', 'Q — hold'], ['Lean right', 'E — hold'], ['Frag grenade', 'Hold G'], ['Flashbang', 'F'],
  ['Primary / Sidearm', '1 / 2'], ['Last weapon', 'Tap Q'], ['Plant / Detonate', 'X'], ['Pause', 'Esc'],
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
                    <SectionTitle sub="Enemy reaction and squad tactics">Difficulty</SectionTitle>
                    <Segmented label="Threat level" value={s.difficulty} options={[{ v: 'Easy', l: 'Recruit' }, { v: 'Normal', l: 'Regular' }, { v: 'Hard', l: 'Veteran' }]} onChange={v => set({ difficulty: v })} />
                  </div>
                </div>
                <div>
                  <SectionTitle sub="Applies on next deployment">Area of operations</SectionTitle>
                  <div className="grid grid-cols-1 gap-2">
                    {/* Mission maps only — the arena is selected via Arena Mode on the main menu */}
                    {MAPS.filter(m => m.id !== 'arena').map(m => (
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
                  <SectionTitle sub="One-click profiles — fine-tune below">Quality preset</SectionTitle>
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {PRESETS.map(p => {
                      const on = p.v.resolutionScale === s.resolutionScale && p.v.shadowQuality === s.shadowQuality && p.v.bloom === s.bloom;
                      return (
                        <button key={p.id} onClick={() => set(p.v)} aria-pressed={on} className={`preset ${on ? 'preset-on' : ''}`}>
                          <div className="text-[12px] font-bold">{p.label}</div>
                          <div className="mono text-[10px] text-[var(--bone-dim)] mt-0.5">{p.hint}</div>
                        </button>
                      );
                    })}
                  </div>
                  <SectionTitle sub="Lower these first if performance drops">Performance</SectionTitle>
                  <Slider label="Resolution scale" value={s.resolutionScale} min={50} max={100} unit="%" onChange={v => set({ resolutionScale: v })} />
                  <Segmented label="Shadows" value={s.shadowQuality} options={[{ v: 'off', l: 'Off' }, { v: 'low', l: 'Low' }, { v: 'medium', l: 'Medium' }, { v: 'high', l: 'High' }]} onChange={v => set({ shadowQuality: v })} />
                  <Toggle label="Adaptive resolution" value={s.adaptiveResolution ?? true} onChange={v => set({ adaptiveResolution: v })} />
                  <Toggle label="Show FPS" value={s.showFps} onChange={v => set({ showFps: v })} />
                </div>
                <div>
                  <SectionTitle sub="Visual finish and clarity">Image</SectionTitle>
                  <Slider label="Brightness" value={s.brightness} min={80} max={170} unit="%" onChange={v => set({ brightness: v })} />
                  <Toggle label="Bloom" value={s.bloom} onChange={v => set({ bloom: v })} />
                  {s.bloom && <Slider label="Bloom strength" value={s.bloomStrength} min={0} max={100} onChange={v => set({ bloomStrength: v })} />}
                  <Slider label="Vignette" value={s.vignette} min={0} max={70} onChange={v => set({ vignette: v })} />
                  <Slider label="Film grain" value={s.filmGrain} min={0} max={100} onChange={v => set({ filmGrain: v })} />
                  <Slider label="Camera shake" value={s.cameraShake} min={0} max={100} unit="%" onChange={v => set({ cameraShake: v })} />
                </div>
              </div>
            )}

            {tab === 'audio' && (
              <div className="anim-fade">
                <SectionTitle sub="Spatial audio mix">Sound</SectionTitle>
                <Slider label="Master volume" value={s.masterVolume} min={0} max={100} unit="%" onChange={v => set({ masterVolume: v })} />
                <Toggle label="Voice lines" value={s.voices} onChange={v => set({ voices: v })} hint="Announcer and squad chatter" />
                <div className="mt-6 p-4 audio-block">
                  <p className="text-[13px] leading-relaxed text-[var(--bone-dim)]">3D audio with HRTF. Gunfire and grenades are positioned in world space.</p>
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
  const arm = (st: React.CSSProperties) => <span style={{ position: 'absolute', background: C, boxShadow: '0 1px 2px rgba(0,0,0,0.65)', ...st }} />;
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
