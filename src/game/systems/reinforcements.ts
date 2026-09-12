import * as THREE from 'three';
import type { InsertionPoint, Position, PressurePolicy } from './mission';

export const PRESSURE_BUDGET = {
  liveCap: 10, squadSize: 3, pendingCap: 30,
  candidateChecks: 8, sightChecks: 32, evaluateEvery: 0.5,
  minSpawnDistance: 25, retireDistance: 90, retireAfter: 20,
} as const;

export interface SpawnView {
  feet: Position;
  eye: Position;
  planes: readonly (readonly [number, number, number, number])[];
}
export interface PressureActor { id: number; at: Position; alive: boolean; seesPlayer: boolean }
export interface SpawnProbes {
  isWalkable(point: Position): boolean;
  hasLineOfSight(point: Position): boolean;
}
export interface ReinforcementBatch {
  insertionId: string; from: string; members: readonly Position[];
  zone: string | null; focus: Position;
}
export interface PressureHooks extends SpawnProbes {
  spawn(batch: ReinforcementBatch): boolean;
  retire(id: number): void;
}
export interface PressureStats {
  totalSpawned: number; peakLive: number; retired: number; pending: number;
  candidateChecks: number; sightChecks: number; deferred: number;
}

const matrix = new THREE.Matrix4();
const frustum = new THREE.Frustum();

export function makeSpawnView(camera: THREE.PerspectiveCamera, feet: Position): SpawnView {
  camera.updateMatrixWorld(true);
  frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return {
    feet: [feet[0], feet[1], feet[2]],
    eye: [camera.position.x, camera.position.y, camera.position.z],
    planes: frustum.planes.map(p => [p.normal.x, p.normal.y, p.normal.z, p.constant]),
  };
}

// Test the whole standing actor, not the enemy's perception flag or its feet alone.
export function actorInView(at: Position, view: SpawnView): boolean {
  return view.planes.every(p => p[0] * at[0] + p[1] * (at[1] + 0.95) + p[2] * at[2] + p[3] >= -1.1);
}

export function canInsertSquad(members: readonly Position[], view: SpawnView, probes: SpawnProbes): boolean {
  if (members.length !== PRESSURE_BUDGET.squadSize) return false;
  if (view.planes.length !== 6 || !view.planes.every(plane => plane.every(Number.isFinite)) || !view.feet.every(Number.isFinite)) return false;
  for (const at of members) {
    if (!at.every(Number.isFinite)) return false;
    if (Math.hypot(at[0] - view.feet[0], at[1] - view.feet[1], at[2] - view.feet[2]) < PRESSURE_BUDGET.minSpawnDistance) return false;
    if (actorInView(at, view)) return false;
    if (!probes.isWalkable(at)) return false;
    if (probes.hasLineOfSight([at[0], at[1] + 1.65, at[2]])) return false;
    if (probes.hasLineOfSight([at[0], at[1] + 0.7, at[2]])) return false;
  }
  return true;
}

/** Bounded pressure, not a roster. Failed or unsafe spawns stay pending; they never pop into view. */
export class PressureDirector {
  private sites: readonly InsertionPoint[];
  private policy: PressurePolicy = { target: 0, interval: 8 };
  private focus: Position = [0, 0, 0];
  private zone: string | null = null;
  private preferredFrom: string | undefined;
  private clock = 0;
  private nextEvaluation = 0;
  private nextSpawn = 0;
  private cursor = 0;
  private unseenSince = new Map<number, number>();
  private counters: PressureStats = { totalSpawned: 0, peakLive: 0, retired: 0, pending: 0, candidateChecks: 0, sightChecks: 0, deferred: 0 };

  constructor(sites: readonly InsertionPoint[]) {
    this.sites = sites.map(s => ({
      ...s,
      members: s.members ?? [s.at, [s.at[0] - 1.2, s.at[1], s.at[2] + 1.2], [s.at[0] + 1.2, s.at[1], s.at[2] + 1.2]],
    }));
  }

  setPolicy(policy: PressurePolicy, zone: string | null, focus: Position) {
    this.policy = { target: Math.min(PRESSURE_BUDGET.liveCap, Math.max(0, policy.target)), interval: Math.max(0.5, policy.interval) };
    this.zone = zone; this.focus = focus;
    this.nextSpawn = Math.min(this.nextSpawn, this.clock + 1);
  }

  request(count: number, from?: string) {
    if (!Number.isFinite(count) || count <= 0) return;
    const rounded = Math.ceil(count / PRESSURE_BUDGET.squadSize) * PRESSURE_BUDGET.squadSize;
    this.counters.pending = Math.min(PRESSURE_BUDGET.pendingCap, this.counters.pending + rounded);
    this.preferredFrom = from;
  }

  update(dt: number, actors: readonly PressureActor[], view: SpawnView, hooks: PressureHooks) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.clock += dt;
    if (this.clock < this.nextEvaluation) return;
    this.nextEvaluation = this.clock + PRESSURE_BUDGET.evaluateEvery;
    this.counters.candidateChecks = 0; this.counters.sightChecks = 0;
    const live = actors.filter(a => a.alive);
    this.counters.peakLive = Math.max(this.counters.peakLive, live.length);
    const ids = new Set(live.map(a => a.id));
    for (const id of this.unseenSince.keys()) if (!ids.has(id)) this.unseenSince.delete(id);
    const hasSight = (point: Position) => {
      // An exhausted query budget must fail closed: visible, so do not insert/retire.
      if (this.counters.sightChecks >= PRESSURE_BUDGET.sightChecks) return true;
      this.counters.sightChecks++;
      return hooks.hasLineOfSight(point);
    };

    for (const actor of live) {
      const far = Math.hypot(actor.at[0] - view.feet[0], actor.at[1] - view.feet[1], actor.at[2] - view.feet[2]) > PRESSURE_BUDGET.retireDistance;
      if (!far || actor.seesPlayer || actorInView(actor.at, view) || hasSight([actor.at[0], actor.at[1] + 1.6, actor.at[2]])) {
        this.unseenSince.delete(actor.id);
        continue;
      }
      const since = this.unseenSince.get(actor.id);
      if (since === undefined) this.unseenSince.set(actor.id, this.clock);
      else if (this.clock - since >= PRESSURE_BUDGET.retireAfter) {
        hooks.retire(actor.id);
        this.unseenSince.delete(actor.id);
        this.counters.retired++;
      }
    }

    if (this.clock < this.nextSpawn || live.length + PRESSURE_BUDGET.squadSize > PRESSURE_BUDGET.liveCap) return;
    if (live.length >= this.policy.target && this.counters.pending === 0) return;
    const allowed = Math.min(this.sites.length, PRESSURE_BUDGET.candidateChecks);
    for (let i = 0; i < allowed; i++) {
      const site = this.sites[this.cursor % this.sites.length];
      this.cursor++;
      this.counters.candidateChecks++;
      if (this.preferredFrom && site.from !== this.preferredFrom && i < allowed / 2) continue;
      if (!canInsertSquad(site.members!, view, { isWalkable: hooks.isWalkable, hasLineOfSight: hasSight })) continue;
      const batch: ReinforcementBatch = { insertionId: site.id, from: site.from, members: site.members!, zone: this.zone, focus: this.focus };
      if (!hooks.spawn(batch)) break;
      this.counters.totalSpawned += PRESSURE_BUDGET.squadSize;
      this.counters.peakLive = Math.max(this.counters.peakLive, live.length + PRESSURE_BUDGET.squadSize);
      this.counters.pending = Math.max(0, this.counters.pending - PRESSURE_BUDGET.squadSize);
      this.nextSpawn = this.clock + this.policy.interval;
      this.preferredFrom = undefined;
      return;
    }
    this.counters.deferred++;
  }

  stats(): PressureStats { return { ...this.counters }; }
}