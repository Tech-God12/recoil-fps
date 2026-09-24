// Recoil FPS — Field Kit UI: the in-game ability slot, live gadget chips, onboarding
// prompt and ticker, the deploy-screen kit picker and the pause-menu reference/swap.
// Everything uses the print-room palette (brass / bone / signal on ink) plus one cyan
// accent reserved for sonar, so kit intel never reads as UAV (red) intel.
import { KIT_DEFS, KIT_IDS, KIT_KEY, KIT_TUNING, type KitHud, type KitId } from '../game/kits';

/* ------------------------------------------------------------------ */
/* Icons (inline SVG, stroke = currentColor)                           */
/* ------------------------------------------------------------------ */
export function KitIcon({ id, size = 22 }: { id: KitId; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (id === 'recon') {
    return (
      <svg {...common}>
        <path d="M4 20 L13 11" />
        <path d="M13 11 l2.5 -0.6 l-1.9 -1.9 z" fill="currentColor" />
        <path d="M16 5.5a6 6 0 0 1 2.5 2.5" />
        <path d="M17.5 2.8a9.5 9.5 0 0 1 3.7 3.7" />
      </svg>
    );
  }
  if (id === 'bulwark') {
    return (
      <svg {...common}>
        <rect x="3" y="7" width="18" height="11" rx="1" />
        <path d="M9 7v11M15 7v11" />
        <path d="M10.5 9.5h3" />
        <path d="M5 18l-1.5 3M19 18l1.5 3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="5.5" r="2.2" strokeDasharray="2 1.6" />
      <path d="M8 21v-6l-1.5 -3.5 L9 8.5h6l2.5 3 L16 15v6" strokeDasharray="2.4 1.6" />
      <path d="M7 21h10" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* In-game ability slot (bottom-left, above the vitals)                */
/* ------------------------------------------------------------------ */
export function KitSlot({ kit }: { kit: KitHud }) {
  const deg = Math.round(kit.pct * 360);
  return (
    <div className={`kit-slot kit-${kit.id} ${kit.ready ? 'ready' : 'charging'}`} aria-label={`Field kit ${kit.name}: ${kit.ability}${kit.ready ? ' ready' : ` recharging ${Math.ceil(kit.cooldownLeft)} seconds`}`}>
      <div className="kit-dial" style={{ background: `conic-gradient(var(--kit-accent) ${deg}deg, rgba(237,228,211,0.1) ${deg}deg)` }}>
        <div className="kit-dial-core">
          <KitIcon id={kit.id} />
          {!kit.ready && <span className="kit-cd tabular">{Math.ceil(kit.cooldownLeft)}</span>}
        </div>
      </div>
      <div className="kit-meta">
        <span className="kit-name">{kit.name}</span>
        <span className="kit-ability">{kit.ability}</span>
        <span className="kit-state mono">
          <span className="keycap">{kit.key}</span>
          {kit.ready ? 'READY' : 'CHARGING'}
        </span>
      </div>
      {kit.tagged > 0 && <span className="kit-tagged mono" role="status">{kit.tagged} TAGGED</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live gadget chips (barricade HP, decoy rounds drawn, sonar pings)   */
/* ------------------------------------------------------------------ */
export function KitLive({ kit }: { kit: KitHud }) {
  if (!kit.live.length) return null;
  return (
    <div className="kit-live" aria-label="Active field kit gadgets">
      {kit.live.map((l, i) => (
        <div key={`${l.kind}-${i}`} className={`kit-chip kit-chip-${l.kind}`}>
          <span className="kit-chip-name">{l.label}</span>
          {l.detail && <span className="kit-chip-detail mono">{l.detail}</span>}
          <span className="kit-chip-time tabular">{Math.ceil(l.timeLeft)}s</span>
          <span className="kit-chip-bar"><i style={{ width: `${Math.max(0, Math.min(1, l.health ?? l.timeLeft / l.total)) * 100}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onboarding prompt: first 20 s of a deployment, until first use      */
/* ------------------------------------------------------------------ */
export function KitHint({ kit }: { kit: KitHud }) {
  return (
    <div className="kit-hint" role="status">
      <span className="kit-hint-tag">FIELD KIT</span>
      <span className="kit-hint-text">
        Press <span className="keycap">{kit.key}</span> — {kit.ability}
      </span>
      <span className="kit-hint-sub">{kit.blurb}</span>
    </div>
  );
}

/** Kit ticker (SONAR — 3 HOSTILES TAGGED, BARRICADE DESTROYED, ...). */
export function KitMessage({ text }: { text: string }) {
  return (
    <div className="kit-msg" role="status">
      <span className="kit-msg-tag">KIT</span>
      <span className="kit-msg-text">{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deploy-screen picker (missions list + TDM setup)                     */
/* ------------------------------------------------------------------ */
function statLine(id: KitId): string {
  if (id === 'recon') return `${KIT_TUNING.recon.pulses} pings · ${KIT_TUNING.recon.radius} m · ${KIT_TUNING.recon.cooldown}s`;
  if (id === 'bulwark') return `${KIT_TUNING.bulwark.hp} HP · ${KIT_TUNING.bulwark.life}s · ${KIT_TUNING.bulwark.cooldown}s`;
  return `${KIT_TUNING.phantom.hp} HP · ${KIT_TUNING.phantom.life}s · ${KIT_TUNING.phantom.cooldown}s`;
}

export function KitPicker({ value, onChange, compact }: { value: KitId; onChange: (id: KitId) => void; compact?: boolean }) {
  return (
    <div className={`kit-picker ${compact ? 'compact' : ''}`} role="radiogroup" aria-label="Field kit">
      <div className="kit-picker-head mono">
        <span>FIELD KIT</span>
        <span>ABILITY ON <span className="keycap">{KIT_KEY}</span></span>
      </div>
      <div className="kit-picker-row">
        {KIT_IDS.map(id => {
          const d = KIT_DEFS[id];
          const on = id === value;
          return (
            <button key={id} type="button" role="radio" aria-checked={on}
              className={`kit-card kit-${id} ${on ? 'on' : ''}`} onClick={() => onChange(id)} title={`${d.blurb} ${d.rule}`}>
              <span className="kit-card-icon"><KitIcon id={id} size={compact ? 18 : 22} /></span>
              <span className="kit-card-body">
                <b>{d.name}</b>
                <em>{d.ability}</em>
                {!compact && <span className="kit-card-stats mono">{statLine(id)}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {!compact && <p className="kit-picker-blurb">{KIT_DEFS[value].blurb} <span>{KIT_DEFS[value].rule}</span></p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pause-menu reference + mid-match swap                               */
/* ------------------------------------------------------------------ */
export function KitPauseCard({ kit, onKit }: { kit: KitHud; onKit?: (id: KitId) => void }) {
  return (
    <div className="pause-kit" aria-label="Field kit">
      <div className="pause-streaks-head">
        <span>Field kit · <span className="keycap">{kit.key}</span></span>
        <span className="tabular">{kit.ready ? 'READY' : `${Math.ceil(kit.cooldownLeft)}s`}</span>
      </div>
      {KIT_IDS.map(id => {
        const d = KIT_DEFS[id];
        const on = id === kit.id;
        return (
          <button key={id} type="button" className={`pause-kit-row ${on ? 'on' : ''}`} onClick={() => onKit?.(id)} disabled={on || !onKit} aria-pressed={on}>
            <span className="pause-kit-icon"><KitIcon id={id} size={18} /></span>
            <span className="psr-name">{d.name} · {d.ability}</span>
            <span className="psr-state">{on ? 'EQUIPPED' : 'SWAP'}</span>
          </button>
        );
      })}
      <p className="pause-streaks-foot">{kit.blurb} {kit.rule} Kills cut {Math.round(KIT_TUNING.killRefund * 100)}% off the cooldown. Swapping starts the new kit on a full cooldown.</p>
    </div>
  );
}
