import definitions from '../config/missions.json';

export type Position = readonly [number, number, number];
export type PhaseType = 'advance' | 'clear' | 'destroy' | 'hold' | 'defend' | 'extract';
export type MissionStatus = 'briefing' | 'active' | 'complete' | 'failed';
export interface PressurePolicy { target: number; interval: number }
export interface Consequences { alert?: string; reinforce?: number; from?: string; resupply?: boolean }
export interface MissionPhase {
  id: string;
  type: PhaseType;
  title: string;
  location: string;
  brief: string;
  at: Position;
  radius: number;
  pressure: PressurePolicy;
  zone?: string;
  count?: number;
  plantSeconds?: number;
  fuse?: number;
  seconds?: number;
  defense?: number;
  drain?: number;
  onComplete?: Consequences;
  escalate?: { every: number; count: number };
}
export interface InsertionPoint { id: string; from: string; at: Position; members?: readonly Position[] }
export interface MissionDefinition {
  id: string; name: string; map: string; brief: string; extractionCallsign: string;
  deployment?: Position;
  phases: readonly MissionPhase[];
  insertions: readonly InsertionPoint[];
}
export interface MissionInput {
  hostilesInObjective?: number;
  player: Position; alive: boolean; paused?: boolean; interact?: boolean; targetVisible?: boolean;
}
export interface MissionSnapshot {
  id: string; name: string; status: MissionStatus; index: number; phaseCount: number;
  phaseId: string; type: PhaseType; title: string; location: string; brief: string;
  at: Position; radius: number; elapsed: number; phaseElapsed: number;
  defense: number; defenseMax: number; contested: boolean;
  completed: number; required: number; progress: number; remaining: number;
  armed: boolean; inside: boolean; canPlant: boolean; plantProgress: number;
  distance: number; bearing: number; relativeBearing: number;
}
export interface MissionReport {
  id: string; name: string; map: string; status: MissionStatus; duration: number;
  phases: { id: string; title: string; type: PhaseType; seconds: number; complete: boolean }[];
}
export type MissionEvent =
  | { type: 'phase-started'; index: number; phase: MissionPhase }
  | { type: 'phase-completed'; index: number; phaseId: string; consequences: Consequences }
  | { type: 'charge-armed'; phaseId: string; fuse: number }
  | { type: 'cache-detonated'; at: Position }
  | { type: 'reinforcement-request'; count: number; from?: string }
  | { type: 'mission-ended'; status: 'complete' | 'failed' };

export const MISSION_BUDGET = { maxPhases: 8, maxEvents: 64, maxClearCount: 30, maxHoldSeconds: 300 } as const;
const distance = (a: Position, b: Position) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const within = (a: Position, b: Position, radius: number) => Math.abs(a[1] - b[1]) <= 2.5 && distance(a, b) <= radius;

export function objectiveGuidance(player: Position, target: Position, heading = 0) {
  const bearing = (Math.atan2(target[0] - player[0], player[2] - target[2]) * 180 / Math.PI + 360) % 360;
  const relativeBearing = ((bearing - heading + 540) % 360) - 180;
  return { distance: distance(player, target), bearing, relativeBearing };
}

export function validateMission(definition: MissionDefinition): string[] {
  const errors: string[] = [];
  const phases = definition.phases ?? [];
  if (!phases.length || phases.length > MISSION_BUDGET.maxPhases) errors.push('Mission needs 1-8 phases.');
  if (phases.filter(p => p.type === 'destroy').length !== 1) errors.push('Mission needs exactly one demolition objective.');
  if (phases[phases.length - 1]?.type !== 'extract') errors.push('The terminal phase must be extract.');
  if (new Set(phases.map(p => p.id)).size !== phases.length) errors.push('Phase IDs must be unique.');
  for (const [i, p] of phases.entries()) {
    if (!['advance', 'clear', 'destroy', 'hold', 'defend', 'extract'].includes(p.type)) errors.push(`${p.id}: unsupported type.`);
    if (p.type === 'extract' && i !== phases.length - 1) errors.push('Only the terminal phase can extract.');
    if (!p.at || p.at.length !== 3 || !p.at.every(Number.isFinite)) errors.push(`${p.id}: finite position required.`);
    if (!Number.isFinite(p.radius) || p.radius <= 0) errors.push(`${p.id}: positive radius required.`);
    if (!p.pressure || !Number.isInteger(p.pressure.target) || p.pressure.target < 0 || p.pressure.target > 10 || !Number.isFinite(p.pressure.interval) || p.pressure.interval < 0.5) errors.push(`${p.id}: invalid pressure budget.`);
    if (p.type === 'clear' && (!p.zone || !Number.isInteger(p.count) || p.count! < 1 || p.count! > MISSION_BUDGET.maxClearCount)) errors.push(`${p.id}: invalid clear count or zone.`);
    if (p.type === 'clear' && p.pressure?.target < 3) errors.push(`${p.id}: clear objectives require at least one reinforcement squad.`);
    if (p.type === 'destroy' && (![p.plantSeconds, p.fuse].every(v => Number.isFinite(v) && v! > 0) || p.plantSeconds! < 1 || p.plantSeconds! > 10 || p.fuse! < 1 || p.fuse! > 180)) errors.push(`${p.id}: finite planting seconds (1-10) and fuse (1-180) required.`);
    if ((p.type === 'hold' || p.type === 'defend') && (!Number.isFinite(p.seconds) || p.seconds! <= 0 || p.seconds! > MISSION_BUDGET.maxHoldSeconds)) errors.push(`${p.id}: invalid hold seconds.`);
    if (p.type === 'defend' && (!Number.isInteger(p.defense) || p.defense! < 1 || p.defense! > 1000 || !Number.isFinite(p.drain) || p.drain! < 1 || p.drain! > 100)) errors.push(`${p.id}: invalid defense pool or drain.`);
    if (p.escalate && (!Number.isFinite(p.escalate.every) || p.escalate.every < 1 || !Number.isInteger(p.escalate.count) || p.escalate.count < 1)) errors.push(`${p.id}: invalid escalation.`);
  }
  if (!definition.insertions?.length || definition.insertions.length > 64) errors.push('Mission needs 1-64 insertion sites.');
  for (const site of definition.insertions ?? []) {
    if (!site.at || site.at.length !== 3 || !site.at.every(Number.isFinite)) errors.push(`${site.id}: invalid insertion position.`);
    if (site.members && (site.members.length !== 3 || site.members.some(at => at.length !== 3 || !at.every(Number.isFinite)))) errors.push(`${site.id}: insertion must contain three finite positions.`);
  }
  if (definition.deployment && (definition.deployment.length !== 3 || !definition.deployment.every(Number.isFinite))) errors.push('Deployment must be a finite position.');
  return errors;
}

export function getMission(map: string): MissionDefinition {
  const data = definitions as unknown as Record<string, MissionDefinition>;
  return data[map] ?? data.alrasul;
}

/** Pure, simulation-time objectives. Rendering, audio, spawning and wall-clock time stay outside. */
export class Mission {
  readonly definition: MissionDefinition;
  status: MissionStatus = 'briefing';
  index = 0;
  elapsed = 0;
  private phaseElapsed = 0;
  private plantTime = 0;
  private attaching = false;
  private interactDown = false;
  private fuseTime = 0;
  private holdTime = 0;
  private defense = 0;
  private contested = false;
  private armed = false;
  private nextWave = 0;
  private events: MissionEvent[] = [];
  private credits = new Map<string, Set<number>>();
  private records: MissionReport['phases'];

  constructor(definition: MissionDefinition) {
    const errors = validateMission(definition);
    if (errors.length) throw new Error(errors.join('\n'));
    this.definition = definition;
    this.records = definition.phases.map(p => ({ id: p.id, title: p.title, type: p.type, seconds: 0, complete: false }));
    for (const p of definition.phases) if (p.type === 'clear') this.credits.set(p.id, new Set());
  }

  get current() { return this.definition.phases[this.index]; }

  start() {
    if (this.status !== 'briefing') return;
    this.status = 'active';
    this.enterPhase();
  }

  private emit(event: MissionEvent) {
    if (this.events.length >= MISSION_BUDGET.maxEvents) this.events.shift();
    this.events.push(event);
  }

  private enterPhase() {
    this.phaseElapsed = 0; this.plantTime = 0; this.attaching = false; this.fuseTime = 0; this.holdTime = 0; this.armed = false;
    this.defense = this.current.defense ?? 0; this.contested = false;
    this.nextWave = this.current.escalate?.every ?? Infinity;
    this.emit({ type: 'phase-started', index: this.index, phase: this.current });
  }

  private completePhase() {
    const p = this.current;
    if (this.records[this.index].complete) return;
    this.records[this.index].complete = true;
    this.emit({ type: 'phase-completed', index: this.index, phaseId: p.id, consequences: { ...p.onComplete } });
    if (p.type === 'extract') {
      this.status = 'complete';
      this.emit({ type: 'mission-ended', status: 'complete' });
    } else {
      this.index++;
      this.enterPhase();
    }
  }

  recordElimination(event: { id: number; at: Position; zone?: string }) {
    if (this.status !== 'active') return;
    for (let i = this.index; i < this.definition.phases.length; i++) {
      const p = this.definition.phases[i];
      const credit = this.credits.get(p.id);
      // Count designated defenders even if they reposition, plus kills made inside the zone.
      if (p.type !== 'clear' || !credit || credit.size >= p.count!) continue;
      if (event.zone === p.zone || within(event.at, p.at, p.radius)) credit.add(event.id);
    }
  }

  fail() {
    if (this.status !== 'active') return;
    this.status = 'failed';
    this.emit({ type: 'mission-ended', status: 'failed' });
  }

  update(dt: number, frame: MissionInput) {
    if (this.status !== 'active' || frame.paused) return;
    if (!frame.alive) { this.fail(); return; }
    if (!Number.isFinite(dt) || dt < 0) return;
    this.elapsed += dt; this.phaseElapsed += dt;
    this.records[this.index].seconds = this.phaseElapsed;
    const p = this.current;
    const inside = within(frame.player, p.at, p.radius);
    const pressed = !!frame.interact && !this.interactDown;
    this.interactDown = !!frame.interact;
    switch (p.type) {
      case 'advance':
      case 'extract':
        if (inside) this.completePhase();
        break;
      case 'clear':
        if ((this.credits.get(p.id)?.size ?? 0) >= p.count!) this.completePhase();
        break;
      case 'destroy':
        if (!this.armed) {
          // Tap to begin attachment; the player can fire and release X. Leaving
          // the target pauses work without erasing it. Returning resumes it.
          if (inside && pressed && frame.targetVisible) this.attaching = true;
          if (this.attaching && inside && frame.targetVisible) this.plantTime = Math.min(p.plantSeconds!, this.plantTime + dt);
          if (this.plantTime >= p.plantSeconds!) {
            this.armed = true;
            this.emit({ type: 'charge-armed', phaseId: p.id, fuse: p.fuse! });
          }
        } else {
          this.fuseTime += dt;
          if (this.fuseTime >= p.fuse! || (pressed && this.fuseTime >= 1 && distance(frame.player,p.at) > p.radius + 3)) {
            this.emit({ type: 'cache-detonated', at: p.at });
            this.completePhase();
          }
        }
        break;
      case 'defend': {
        // Count comes from the live actors, never the player's location. Cap hostile
        // input to the live budget; only consume the part of dt before the deadline.
        const hostiles = Number.isFinite(frame.hostilesInObjective) ? Math.max(0, Math.min(10, Math.floor(frame.hostilesInObjective!))) : 0;
        this.contested = hostiles > 0;
        const step = Math.min(dt, Math.max(0, p.seconds! - this.holdTime));
        this.defense = Math.max(0, this.defense - hostiles * p.drain! * step);
        this.holdTime += step;
        if (this.defense <= 0) { this.fail(); break; }
        while (p.escalate && this.nextWave < p.seconds! && this.holdTime >= this.nextWave) {
          this.emit({ type: 'reinforcement-request', count: p.escalate.count });
          this.nextWave += p.escalate.every;
        }
        if (this.holdTime >= p.seconds!) this.completePhase();
        break;
      }
      case 'hold':
        if (inside) this.holdTime = Math.min(p.seconds!, this.holdTime + dt);
        while (p.escalate && this.nextWave < p.seconds! && this.holdTime >= this.nextWave) {
          this.emit({ type: 'reinforcement-request', count: p.escalate.count });
          this.nextWave += p.escalate.every;
        }
        if (this.holdTime >= p.seconds!) this.completePhase();
        break;
    }
  }

  snapshot(player: Position, heading = 0): MissionSnapshot {
    const p = this.current;
    const inside = within(player, p.at, p.radius);
    const completed = this.credits.get(p.id)?.size ?? 0;
    const remaining = (p.type === 'hold' || p.type === 'defend') ? Math.max(0, p.seconds! - this.holdTime)
      : p.type === 'destroy' ? Math.max(0, p.fuse! - this.fuseTime) : 0;
    const progress = p.type === 'clear' ? completed / p.count!
      : (p.type === 'hold' || p.type === 'defend') ? this.holdTime / p.seconds!
      : p.type === 'destroy' ? (this.armed ? this.fuseTime / p.fuse! : this.plantTime / p.plantSeconds!)
      : inside ? 1 : 0;
    return {
      id: this.definition.id, name: this.definition.name, status: this.status,
      index: this.index, phaseCount: this.definition.phases.length,
      phaseId: p.id, type: p.type, title: p.title, location: p.location, brief: p.brief,
      at: p.at, radius: p.radius, elapsed: this.elapsed, phaseElapsed: this.phaseElapsed,
      defense: this.defense, defenseMax: p.defense ?? 0, contested: this.contested,
      completed, required: p.count ?? 0, progress: Math.min(1, progress), remaining,
      armed: this.armed, inside, canPlant: p.type === 'destroy' && !this.armed && inside,
      plantProgress: p.type === 'destroy' ? this.plantTime / p.plantSeconds! : 0,
      ...objectiveGuidance(player, p.at, heading),
    };
  }

  drainEvents() { const events = this.events; this.events = []; return events; }
  report(): MissionReport {
    return { id: this.definition.id, name: this.definition.name, map: this.definition.map, status: this.status, duration: this.elapsed, phases: this.records.map(p => ({ ...p })) };
  }
  diagnostics() {
    let creditedVictims = 0;
    for (const credit of this.credits.values()) creditedVictims += credit.size;
    return { queuedEvents: this.events.length, creditedVictims };
  }
}