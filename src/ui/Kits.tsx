// Recoil FPS — Field Kit UI: the in-game ability slot, live gadget chips, onboarding
// prompt, ticker and screen-space kit effects, the "equipped kit" button on the deploy
// screens and the read-only pause-menu reference. The full shop/equip screen lives in
// KitsMenu.tsx. Print-room palette (brass / bone / signal on ink); each kit carries one
// accent: radar cyan, barricade signal orange, decoy holo teal, mine warning red,
// medkit medical green.
import type { CSSProperties } from 'react';
import { KIT_DEFS, KIT_KEY, KIT_TUNING, type KitFxKind, type KitHud, type KitId } from '../game/kits';

/* ------------------------------------------------------------------ */
/* Icons (inline SVG, stroke = currentColor)                           */
/* ------------------------------------------------------------------ */
export function KitIcon({ id, size = 22 }: { id: KitId; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (id === 'recon') {
    return (
      <svg {...common}>
        <path d="M5 7.5a8 8 0 0 0 11.5 11.5z" />
        <path d="M10.8 13.2 15 9" />
        <circle cx="15.6" cy="8.4" r="1.2" fill="currentColor" />
        <path d="M17.8 3.6a5 5 0 0 1 2.6 2.6" />
        <path d="M9 21h8" />
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
  if (id === 'mine') {
    return (
      <svg {...common}>
        <path d="M4 17h16l-1.5 -4h-13z" />
        <path d="M12 13V9.5" />
        <path d="M10 8.5l2 -2 2 2" />
        <path d="M6.5 5.5l1.5 1.5M17.5 5.5 16 7M12 3v1.5" />
        <path d="M4 20h16" />
      </svg>
    );
  }
  if (id === 'medic') {
    return (
      <svg {...common}>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5h6v2" />
        <path d="M12 10.5v6M9 13.5h6" />
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

export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* In-game ability slot (bottom-left, beside the vitals)               */
/* ------------------------------------------------------------------ */
/** 24 tick marks around the dial: one per 1/24 of a charge. */
const TICKS = Array.from({ length: 24 }, (_, i) => i);
const R = 27; // dial radius in the 64×64 viewBox
const CIRC = 2 * Math.PI * R;

export function KitSlot({ kit }: { kit: KitHud }) {
  const lit = Math.floor(kit.pct * TICKS.length);
  const secs = Math.ceil(kit.cooldownLeft);
  return (
    <div
      className={`kit-slot kit-${kit.id} ${kit.ready ? 'ready' : 'charging'} ${kit.recall ? 'recall' : ''}`}
      aria-label={`Kit ${kit.name}${kit.ready ? ' ready' : ` recharging ${secs} seconds`}`}
    >
      <div className="kit-dial">
        <svg viewBox="0 0 64 64" className="kit-dial-svg" aria-hidden="true">
          <circle cx="32" cy="32" r={R} className="kit-dial-track" />
          <circle
            cx="32" cy="32" r={R} className="kit-dial-arc"
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - kit.pct)}
            transform="rotate(-90 32 32)"
          />
          {TICKS.map(i => {
            const a = (i / TICKS.length) * Math.PI * 2 - Math.PI / 2;
            return (
              <line key={i} className={i < lit || kit.ready ? 'on' : ''}
                x1={32 + Math.cos(a) * 30.5} y1={32 + Math.sin(a) * 30.5}
                x2={32 + Math.cos(a) * 32} y2={32 + Math.sin(a) * 32} />
            );
          })}
        </svg>
        {/* Keyed bursts: remount on every ready / use so the CSS animation replays. */}
        {kit.readyEpoch > 0 && <span key={`r${kit.readyEpoch}`} className="kit-burst ready" aria-hidden="true" />}
        {kit.useEpoch > 0 && <span key={`u${kit.useEpoch}`} className="kit-burst use" aria-hidden="true" />}
        <div className="kit-dial-core">
          <KitIcon id={kit.id} size={24} />
          {!kit.ready && <span className="kit-cd tabular">{secs}</span>}
        </div>
      </div>
      <div className="kit-meta">
        <span className="kit-ability">{kit.name}</span>
        <span className="kit-state mono">
          <span className="keycap">{kit.key}</span>
          {kit.recall ? 'RECALL' : kit.ready ? 'READY' : 'CHARGING'}
        </span>
        <span className="kit-bar" aria-hidden="true"><i style={{ width: `${Math.round(kit.pct * 100)}%` }} /></span>
      </div>
      {kit.tagged > 0 && <span className="kit-tagged mono" role="status">{kit.tagged} TAGGED · +10%</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live gadget chips (barricade HP, decoy rounds drawn, sonar pings)   */
/* ------------------------------------------------------------------ */
export function KitLive({ kit }: { kit: KitHud }) {
  if (!kit.live.length) return null;
  return (
    <div className="kit-live" aria-label="Active kit">
      {kit.live.map((l, i) => {
        const frac = Math.max(0, Math.min(1, l.health ?? l.timeLeft / l.total));
        return (
          <div key={`${l.kind}-${i}`} className={`kit-chip kit-chip-${l.kind} ${frac < 0.35 ? 'low' : ''}`}>
            <span className="kit-chip-name">{l.label}</span>
            {l.detail && <span className="kit-chip-detail mono">{l.detail}</span>}
            <span className="kit-chip-time tabular">{Math.ceil(l.timeLeft)}s</span>
            <span className="kit-chip-bar"><i style={{ width: `${frac * 100}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onboarding prompt: first 45 s of a deployment, until first use      */
/* ------------------------------------------------------------------ */
export function KitHint({ kit }: { kit: KitHud }) {
  return (
    <div className={`kit-hint kit-${kit.id}`} role="status">
      <span className="kit-hint-tag">YOUR KIT</span>
      <span className="kit-hint-text">
        {kit.ready
          ? <>Press <span className="keycap">{kit.key}</span> to use {kit.name}</>
          : <>{kit.name} charging · <span className="tabular">{Math.ceil(kit.cooldownLeft)}s</span> · then <span className="keycap">{kit.key}</span></>}
      </span>
      <span className="kit-hint-sub">{kit.blurb}</span>
    </div>
  );
}

/** Kit ticker (RADAR — 3 ENEMIES FOUND, BARRICADE DESTROYED, ...). */
export function KitMessage({ text }: { text: string }) {
  return (
    <div className="kit-msg" role="status">
      <span className="kit-msg-tag">KIT</span>
      <span className="kit-msg-text">{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen-space kit effects (one overlay per event, keyed to replay)   */
/* ------------------------------------------------------------------ */
export function KitFx({ kind }: { kind: KitFxKind }) {
  return (
    <div className={`kit-fx kit-fx-${kind}`} aria-hidden="true">
      {kind === 'ping' && <><i className="kf-ring" /><i className="kf-ring two" /></>}
      {kind === 'burst' && <><i className="kf-glitch" /><i className="kf-glitch b" /><i className="kf-glitch c" /></>}
      {kind === 'slam' && <i className="kf-dust" />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deploy screens: the equipped kit, as a button into the KITS menu    */
/* ------------------------------------------------------------------ */
export function KitEquipButton({ kit, onOpen, compact }: { kit: KitId | null; onOpen?: () => void; compact?: boolean }) {
  const d = kit ? KIT_DEFS[kit] : null;
  return (
    <button type="button" className={`kit-equip ${kit ? `kit-${kit}` : 'none'} ${compact ? 'compact' : ''}`} onClick={onOpen} disabled={!onOpen}
      aria-label={d ? `${d.name} equipped. Open the Kits menu` : 'No kit equipped. Open the Kits menu'}>
      <span className="kit-equip-icon">{kit ? <KitIcon id={kit} size={compact ? 18 : 22} /> : <LockIcon size={compact ? 16 : 18} />}</span>
      <span className="kit-equip-body">
        <em>KIT <span className="keycap">{KIT_KEY}</span></em>
        <b>{d ? d.name : 'NONE EQUIPPED'}</b>
      </span>
      <span className="kit-equip-go mono">{d ? 'CHANGE' : 'GET A KIT'} ›</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Pause-menu reference (read-only: kits are locked mid-deployment)    */
/* ------------------------------------------------------------------ */
export function KitPauseCard({ kit }: { kit?: KitHud }) {
  if (!kit) {
    return (
      <div className="pz-kit none">
        <span className="pz-kit-icon"><LockIcon size={18} /></span>
        <div className="pz-kit-body">
          <b>No kit</b>
          <p>Buy and equip one from <b>KITS</b> on the main menu. Kits can only be changed between games.</p>
        </div>
      </div>
    );
  }
  const d = KIT_DEFS[kit.id];
  const style = { '--pct': kit.pct } as CSSProperties;
  return (
    <div className={`pz-kit kit-${kit.id} ${kit.ready ? 'ready' : ''}`} style={style} aria-label="Kit">
      <span className="pz-kit-icon"><KitIcon id={kit.id} size={22} /></span>
      <div className="pz-kit-body">
        <div className="pz-kit-head">
          <b>{d.name}</b>
          <span className="pz-kit-state mono">{kit.ready ? 'READY' : `${Math.ceil(kit.cooldownLeft)}s`}</span>
        </div>
        <span className="pz-kit-bar" aria-hidden="true"><i /></span>
        <ul className="pz-kit-steps">
          {d.steps.map((s, i) => <li key={i}><span className="mono">{String(i + 1).padStart(2, '0')}</span>{s}</li>)}
        </ul>
        <p className="pz-kit-foot mono">
          <LockIcon size={11} /> LOCKED FOR THIS DEPLOYMENT · KILLS −{Math.round(KIT_TUNING.killRefund * 100)}% (MAX {Math.round(KIT_TUNING.refundCap * 100)}%/CHARGE)
        </p>
      </div>
    </div>
  );
}
