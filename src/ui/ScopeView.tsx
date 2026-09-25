import type { HudState } from '../game/engine';
import type { ScopeReticle } from '../game/economy/stats';

export interface ScopeControls {
  onScopePower?: (power: number) => void;
  onScopeAdjust?: () => void;
  onScopeDone?: () => void;
  active?: boolean;
}

/** All zeros are exactly (256,256); chevron apex, dot and wire intersections agree.
 * Reticle identity comes from the equipped optic, never an FOV threshold.
 */
export function OpticReticle({ kind, power = 1 }: { kind: ScopeReticle; power?: number }) {
  const ink = '#141918', lit = '#ee5140';
  return <svg viewBox="0 0 512 512" className={`optic-reticle optic-reticle-${kind}`} aria-label={`${kind} aiming reticle`}>
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'dot' && <circle cx="256" cy="256" r="2.2" fill={lit} stroke="#ffb3a6" strokeWidth=".55" />}
      {kind === 'holo' && <g stroke={lit} strokeWidth="1.4">
        <circle cx="256" cy="256" r="18" /><circle cx="256" cy="256" r="1.4" fill={lit} stroke="none" />
        <path d="M256 232v-5 M256 280v5 M232 256h-5 M280 256h5" />
      </g>}
      {kind === 'prism2' && <g stroke={ink} strokeWidth="1.1">
        <path d="M55 256h166 M291 256h166 M256 293v164" />
        <circle cx="256" cy="256" r="9" stroke="#bd3127" strokeWidth="1.6" />
        <circle cx="256" cy="256" r="1.5" fill={lit} stroke="none" />
      </g>}
      {kind === 'prism3' && <g>
        <path d="M235 251a22 22 0 1 1 42 0" stroke="#d87b2d" strokeWidth="2.1" />
        <path d="M249 264l7-8 7 8" stroke={lit} strokeWidth="1.5" />
        <g stroke={ink} strokeWidth="1"><path d="M256 273v80 M244 285h24 M247 306h18 M250 331h12" /><path d="M70 256h136 M306 256h136" /></g>
      </g>}
      {(kind === 'bdc4' || kind === 'acog') && <g>
        <path d="M246 269l10-13 10 13" stroke={lit} strokeWidth="1.8" />
        <g stroke={ink} strokeWidth="1"><path d="M256 277v140 M237 291h38 M241 316h30 M245 346h22 M249 382h14 M35 256h165 M312 256h165" /></g>
        <g fill={ink} fontSize="9" fontFamily="monospace"><text x="280" y="320">4</text><text x="274" y="386">6</text></g>
      </g>}
      {(kind === 'mil6' || kind === 'sniper' || kind === 'mil8') && <g stroke={ink}>
        <path d="M24 256h173 M315 256h173 M256 24v173 M256 315v173" strokeWidth="2.8" />
        <path d="M32 256h448 M256 32v448" strokeWidth=".85" />
        <g transform={`translate(256 256) scale(${kind === 'mil6' ? power / 6 : 1})`}>
          {[-4,-3,-2,-1,1,2,3,4].map(n=><g key={n} strokeWidth=".85">
            <path d={`M${n*18} -3v6 M-3 ${n*18}h6`} />
            <circle cx={n*18} cy="0" r="1.05" fill={ink} stroke="none" />
          </g>)}
          {kind === 'mil8' && [2,3,4,5,6].map(n=><g key={n} strokeWidth=".8"><path d={`M${-n*6} ${n*18}h${n*12}`} />{[-2,-1,1,2].map(x=><circle key={x} cx={x*n*7} cy={n*18} r=".9" fill={ink} />)}</g>)}
        </g>
        <circle cx="256" cy="256" r="1.4" fill={lit} stroke="none" />
      </g>}
    </g>
  </svg>;
}

export default function ScopeView({ hud, active = true, onScopePower, onScopeAdjust, onScopeDone }: ScopeControls & { hud: HudState }) {
  const opacity = Math.max(0, Math.min(1, (hud.ads - .3) / .35));
  if (opacity === 0) return null;
  const power = hud.scopePower ?? 1, kind = hud.reticle;
  const magnified = power > 1;
  const variable = hud.scopeMaxPower > hud.scopeMinPower && !hud.canted && active && hud.hp > 0;
  const label = hud.canted ? 'Canted irons' : `${power.toFixed(1)}×`;
  return <div className="optic-overlay" style={{ opacity }} data-optic={kind} data-magnification={power}>
    {magnified ? <>
      <div className={`optic-aperture optic-aperture-${kind}`} />
      <div className={`optic-glass optic-glass-${kind}`}>
        <OpticReticle kind={kind} power={power} />
        <span className="optic-power mono">{label}</span>
      </div>
    </> : kind !== 'none' ? <div className="reflex-reticle"><OpticReticle kind={kind} /></div> : null}
    {hud.canted && <span className="canted-hint mono">Backup irons · release T</span>}
    {variable && hud.ads > .65 && <section className={`scope-zoom-panel ${hud.scopeAdjusting ? 'editing' : ''}`} aria-label="Variable scope adjustment"
      onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key!=='Escape')e.stopPropagation();}}>
      <div className="scope-zoom-heading"><span>6× precision</span><output aria-live="off">{power.toFixed(1)}×</output></div>
      <label htmlFor="scope-magnification">Magnification</label>
      <input id="scope-magnification" aria-label="6x scope magnification" type="range" min={hud.scopeMinPower} max={hud.scopeMaxPower} step="0.1"
        value={power} disabled={!hud.scopeAdjusting} onChange={e=>onScopePower?.(Number(e.currentTarget.value))} />
      <div className="scope-zoom-limits"><span>{hud.scopeMinPower.toFixed(0)}× · wide</span><span>{hud.scopeMaxPower.toFixed(0)}× · tight</span></div>
      <small>{hud.zoomFov.toFixed(1)}° FOV · {hud.scopeAdjusting ? 'Aim stays up. The mission continues.' : 'Scroll or [ ] to adjust'}</small>
      {hud.scopeAdjusting ? <button type="button" onClick={onScopeDone}>Return to aim <kbd>↵</kbd></button>
        : <button type="button" onClick={onScopeAdjust}>Adjust zoom <kbd>V</kbd></button>}
    </section>}
  </div>;
}
