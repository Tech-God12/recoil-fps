// Recoil FPS — Field Ability UI: the in-game ability slot, live gadget chips, onboarding
// prompt, ticker and screen-space ability effects, the "equipped ability" button on the deploy
// screens and the read-only pause-menu reference. The full shop/equip screen lives in
// AbilitiesMenu.tsx. Print-room palette (brass / bone / signal on ink); each ability carries one
// accent: radar cyan, barricade signal orange, decoy holo teal, mine warning red,
// medkit medical green.
import type { CSSProperties } from 'react';
import { ABILITY_DEFS, ABILITY_KEY, ABILITY_TUNING, type AbilityFxKind, type AbilityHud, type AbilityId } from '../game/abilities';

/* ------------------------------------------------------------------ */
/* Icons (inline SVG, stroke = currentColor)                           */
/* ------------------------------------------------------------------ */
export function AbilityIcon({ id, size = 22 }: { id: AbilityId; size?: number }) {
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

export function AbilitySlot({ ability }: { ability: AbilityHud }) {
  const lit = Math.floor(ability.pct * TICKS.length);
  const secs = Math.ceil(ability.cooldownLeft);
  return (
    <div
      className={`ability-slot ability-${ability.id} ${ability.ready ? 'ready' : 'charging'} ${ability.recall ? 'recall' : ''}`}
      aria-label={`Ability ${ability.name}${ability.ready ? ' ready' : ` recharging ${secs} seconds`}`}
    >
      <div className="ability-dial">
        <svg viewBox="0 0 64 64" className="ability-dial-svg" aria-hidden="true">
          <circle cx="32" cy="32" r={R} className="ability-dial-track" />
          <circle
            cx="32" cy="32" r={R} className="ability-dial-arc"
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - ability.pct)}
            transform="rotate(-90 32 32)"
          />
          {TICKS.map(i => {
            const a = (i / TICKS.length) * Math.PI * 2 - Math.PI / 2;
            return (
              <line key={i} className={i < lit || ability.ready ? 'on' : ''}
                x1={32 + Math.cos(a) * 30.5} y1={32 + Math.sin(a) * 30.5}
                x2={32 + Math.cos(a) * 32} y2={32 + Math.sin(a) * 32} />
            );
          })}
        </svg>
        {/* Keyed bursts: remount on every ready / use so the CSS animation replays. */}
        {ability.readyEpoch > 0 && <span key={`r${ability.readyEpoch}`} className="ability-burst ready" aria-hidden="true" />}
        {ability.useEpoch > 0 && <span key={`u${ability.useEpoch}`} className="ability-burst use" aria-hidden="true" />}
        <div className="ability-dial-core">
          <AbilityIcon id={ability.id} size={24} />
          {!ability.ready && <span className="ability-cd tabular">{secs}</span>}
        </div>
      </div>
      <div className="ability-meta">
        <span className="ability-ability">{ability.name}</span>
        <span className="ability-state mono">
          <span className="keycap">{ability.key}</span>
          {ability.recall ? 'RECALL' : ability.ready ? 'READY' : 'CHARGING'}
        </span>
        <span className="ability-bar" aria-hidden="true"><i style={{ width: `${Math.round(ability.pct * 100)}%` }} /></span>
      </div>
      {ability.tagged > 0 && <span className="ability-tagged mono" role="status">{ability.tagged} TAGGED · +10%</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live gadget chips (barricade HP, decoy rounds drawn, sonar pings)   */
/* ------------------------------------------------------------------ */
export function AbilityLive({ ability }: { ability: AbilityHud }) {
  if (!ability.live.length) return null;
  return (
    <div className="ability-live" aria-label="Active ability">
      {ability.live.map((l, i) => {
        const frac = Math.max(0, Math.min(1, l.health ?? l.timeLeft / l.total));
        return (
          <div key={`${l.kind}-${i}`} className={`ability-chip ability-chip-${l.kind} ${frac < 0.35 ? 'low' : ''}`}>
            <span className="ability-chip-name">{l.label}</span>
            {l.detail && <span className="ability-chip-detail mono">{l.detail}</span>}
            <span className="ability-chip-time tabular">{Math.ceil(l.timeLeft)}s</span>
            <span className="ability-chip-bar"><i style={{ width: `${frac * 100}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onboarding prompt: first 45 s of a deployment, until first use      */
/* ------------------------------------------------------------------ */
export function AbilityHint({ ability }: { ability: AbilityHud }) {
  return (
    <div className={`ability-hint ability-${ability.id}`} role="status">
      <span className="ability-hint-tag">YOUR ABILITY</span>
      <span className="ability-hint-text">
        {ability.ready
          ? <>Press <span className="keycap">{ability.key}</span> to use {ability.name}</>
          : <>{ability.name} charging · <span className="tabular">{Math.ceil(ability.cooldownLeft)}s</span> · then <span className="keycap">{ability.key}</span></>}
      </span>
      <span className="ability-hint-sub">{ability.blurb}</span>
    </div>
  );
}

/** Ability ticker (RADAR — 3 ENEMIES FOUND, BARRICADE DESTROYED, ...). */
export function AbilityMessage({ text }: { text: string }) {
  return (
    <div className="ability-msg" role="status">
      <span className="ability-msg-tag">ABILITY</span>
      <span className="ability-msg-text">{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen-space ability effects (one overlay per event, keyed to replay)   */
/* ------------------------------------------------------------------ */
export function AbilityFx({ kind }: { kind: AbilityFxKind }) {
  return (
    <div className={`ability-fx ability-fx-${kind}`} aria-hidden="true">
      {kind === 'ping' && <><i className="kf-ring" /><i className="kf-ring two" /></>}
      {kind === 'burst' && <><i className="kf-glitch" /><i className="kf-glitch b" /><i className="kf-glitch c" /></>}
      {kind === 'slam' && <i className="kf-dust" />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deploy screens: the equipped ability, as a button into the ABILITIES menu    */
/* ------------------------------------------------------------------ */
export function AbilityEquipButton({ ability, onOpen, compact }: { ability: AbilityId | null; onOpen?: () => void; compact?: boolean }) {
  const d = ability ? ABILITY_DEFS[ability] : null;
  return (
    <button type="button" className={`ability-equip ${ability ? `ability-${ability}` : 'none'} ${compact ? 'compact' : ''}`} onClick={onOpen} disabled={!onOpen}
      aria-label={d ? `${d.name} equipped. Open the Abilities menu` : 'No ability equipped. Open the Abilities menu'}>
      <span className="ability-equip-icon">{ability ? <AbilityIcon id={ability} size={compact ? 18 : 22} /> : <LockIcon size={compact ? 16 : 18} />}</span>
      <span className="ability-equip-body">
        <em>ABILITY <span className="keycap">{ABILITY_KEY}</span></em>
        <b>{d ? d.name : 'NONE EQUIPPED'}</b>
      </span>
      <span className="ability-equip-go mono">{d ? 'CHANGE' : 'GET A ABILITY'} ›</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Pause-menu reference (read-only: abilities are locked mid-deployment)    */
/* ------------------------------------------------------------------ */
export function AbilityPauseCard({ ability }: { ability?: AbilityHud }) {
  if (!ability) {
    return (
      <div className="pz-ability none">
        <span className="pz-ability-icon"><LockIcon size={18} /></span>
        <div className="pz-ability-body">
          <b>No ability</b>
          <p>Buy and equip one from <b>ABILITIES</b> on the main menu. Abilities can only be changed between games.</p>
        </div>
      </div>
    );
  }
  const d = ABILITY_DEFS[ability.id];
  const style = { '--pct': ability.pct } as CSSProperties;
  return (
    <div className={`pz-ability ability-${ability.id} ${ability.ready ? 'ready' : ''}`} style={style} aria-label="Ability">
      <span className="pz-ability-icon"><AbilityIcon id={ability.id} size={22} /></span>
      <div className="pz-ability-body">
        <div className="pz-ability-head">
          <b>{d.name}</b>
          <span className="pz-ability-state mono">{ability.ready ? 'READY' : `${Math.ceil(ability.cooldownLeft)}s`}</span>
        </div>
        <span className="pz-ability-bar" aria-hidden="true"><i /></span>
        <ul className="pz-ability-steps">
          {d.steps.map((s, i) => <li key={i}><span className="mono">{String(i + 1).padStart(2, '0')}</span>{s}</li>)}
        </ul>
        <p className="pz-ability-foot mono">
          <LockIcon size={11} /> LOCKED FOR THIS DEPLOYMENT · KILLS −{Math.round(ABILITY_TUNING.killRefund * 100)}% (MAX {Math.round(ABILITY_TUNING.refundCap * 100)}%/CHARGE)
        </p>
      </div>
    </div>
  );
}
