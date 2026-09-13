import * as THREE from 'three';
import type { AIManager } from '../ai';
import type { World } from '../world';
import { Mission, getMission, type MissionEvent, type MissionPhase, type MissionSnapshot, type Position } from './mission';
import { MissionMarkers } from './mission-markers';
import { PressureDirector, makeSpawnView, type PressureActor, type PressureHooks } from './reinforcements';

export interface MissionHud extends MissionSnapshot {
  waypoint: { x: number; y: number; visible: boolean };
  live: number;
  targetPressure: number;
  totalSpawned: number;
}
export interface MissionHost {
  scene: THREE.Scene; world: World; camera: THREE.PerspectiveCamera; ai: AIManager;
  player: THREE.Vector3;
  isAlive(): boolean;
  phaseChanged(phase: MissionPhase, index: number): void;
  radio(text: string, at?: THREE.Vector3): void;
  detonate(at: THREE.Vector3): void;
  resupply(): void;
  dropSupply(): void;
  finish(win: boolean): void;
}

const tuple = (p: THREE.Vector3): Position => [p.x, p.y, p.z];

export class MissionRuntime {
  readonly mission: Mission;
  readonly pressure: PressureDirector;
  readonly markers: MissionMarkers;
  private host: MissionHost;
  private ray = new THREE.Raycaster();
  private direction = new THREE.Vector3();
  private point = new THREE.Vector3();
  private pressureTime = 0;
  private actors: PressureActor[] = [];
  private hooks: PressureHooks;
  private activePolicy = { target: 3, interval: 12 };
  private noticeUntil = 0;
  private targetVisible = false;
  private holdBeats = new Set<number>();

  constructor(host: MissionHost, map: string) {
    this.host = host;
    this.mission = new Mission(getMission(map));
    if (this.mission.definition.deployment) host.player.set(...this.mission.definition.deployment);
    this.pressure = new PressureDirector(this.mission.definition.insertions);
    this.markers = new MissionMarkers(host.scene, host.world, this.mission.definition);
    this.ray.firstHitOnly = true;
    this.hooks = {
      isWalkable: at => this.isWalkable(at),
      hasLineOfSight: at => this.lineOfSight(at),
      spawn: batch => {
        if (!host.ai.insertSquad(batch)) return false;
        host.radio(`Hostile squad entering from the ${batch.from}.`, new THREE.Vector3(...batch.members[0]));
        return true;
      },
      retire: id => host.ai.retire(id),
    };
  }

  start() {
    this.mission.start();
    this.consumeEvents();
  }

  private isWalkable(at: Position) {
    const { world, ai } = this.host;
    if (Math.abs(at[0]) > world.half - 3 || Math.abs(at[2]) > world.half - 3) return false;
    if (!ai.nav.free(ai.nav.toCell(at[0]), ai.nav.toCell(at[2]))) return false;
    return !world.solids.some(b => b.maxY > at[1] + 0.34 && b.minY < at[1] + 1.8 && at[0] + 0.36 > b.minX && at[0] - 0.36 < b.maxX && at[2] + 0.36 > b.minZ && at[2] - 0.36 < b.maxZ);
  }

  private lineOfSight(at: Position, allowCache = false): boolean {
    const origin = this.host.camera.position;
    this.point.set(...at);
    this.direction.subVectors(this.point, origin);
    const length = this.direction.length();
    if (length < 0.05) return true;
    this.ray.set(origin, this.direction.normalize());
    this.ray.near = 0;
    this.ray.far = Math.max(0, length - 0.05);
    const hit = this.ray.intersectObjects(this.host.world.occluders, false)[0];
    return !hit || (allowCache && hit.object === this.markers.cache);
  }

  private consumeEvents() {
    for (const event of this.mission.drainEvents()) this.handle(event);
  }

  private handle(event: MissionEvent) {
    const h = this.host;
    if (event.type === 'mission-ended') { h.finish(event.status === 'complete'); return; }
    if (this.mission.status === 'failed') return;
    switch (event.type) {
      case 'phase-started': {
        this.holdBeats.clear();
        this.activePolicy = event.phase.pressure;
        const clear = event.phase.type === 'advance'
          ? this.mission.definition.phases.slice(event.index + 1).find(p => p.type === 'clear')
          : event.phase.type === 'clear' ? event.phase : undefined;
        this.pressure.setPolicy(event.phase.pressure, clear?.zone ?? null, clear?.at ?? event.phase.at);
        this.markers.setPhase(event.phase);
        h.phaseChanged(event.phase, event.index);
        h.radio(event.phase.brief);
        break;
      }
      case 'phase-completed':
        if (event.consequences.alert) h.ai.alertZone(event.consequences.alert, h.player);
        if (event.consequences.reinforce) this.pressure.request(event.consequences.reinforce, event.consequences.from);
        if (event.consequences.resupply) h.resupply();
        break;
      case 'charge-armed':
        h.radio(`Charge set. ${event.fuse} seconds. Move away from the cache.`);
        break;
      case 'cache-detonated':
        this.markers.destroyCache(h.world);
        h.detonate(new THREE.Vector3(...event.at));
        break;
      case 'reinforcement-request': {
        this.pressure.request(event.count, event.from);
        const waves = ['North squad inbound. Hold your corner.', 'They are committing. Stay inside the perimeter.', 'Last push. Do not chase them.'];
        h.radio(waves[Math.min(this.holdBeats.size, waves.length - 1)]);
        break;
      }
    }
  }

  update(dt: number, interact: boolean) {
    const player = tuple(this.host.player);
    const p = this.mission.current;
    const close = p.type === 'destroy' && Math.hypot(p.at[0] - player[0], p.at[1] - player[1], p.at[2] - player[2]) <= p.radius;
    const visible = close && this.lineOfSight([p.at[0], p.at[1] + 0.8, p.at[2]], true);
    this.targetVisible = visible;
    this.mission.update(dt, { player, interact, targetVisible: visible, alive: this.host.isAlive() });
    this.consumeEvents();
    if (this.mission.status !== 'active') return;
    this.tickHoldBeats(player);
    this.pressureTime += dt;
    if (this.pressureTime < 0.5) return;
    this.actors.length = 0;
    for (const e of this.host.ai.enemies) this.actors.push({ id: e.id, at: tuple(e.pos), alive: !e.dead, seesPlayer: e.seesPlayer });
    this.pressure.update(this.pressureTime, this.actors, makeSpawnView(this.host.camera, player), this.hooks);
    this.pressureTime = 0;
    const stats = this.pressure.stats();
    if (stats.deferred > 0 && this.host.ai.aliveCount() === 0 && this.mission.elapsed > this.noticeUntil) {
      this.noticeUntil = this.mission.elapsed + 25;
      this.host.radio('Hostiles are regrouping. Keep moving toward your objective.');
    }
  }

  recordElimination(enemy: { id: number; pos: THREE.Vector3; missionZone?: string }) {
    this.mission.recordElimination({ id: enemy.id, at: tuple(enemy.pos), zone: enemy.missionZone });
  }

  hud(heading: number): MissionHud {
    const snapshot = this.mission.snapshot(tuple(this.host.player), heading);
    const p = this.point.set(snapshot.at[0], snapshot.at[1] + 1.8, snapshot.at[2]).project(this.host.camera);
    return {
      ...snapshot,
      canPlant: snapshot.canPlant && this.targetVisible,
      waypoint: { x: (p.x * 0.5 + 0.5) * 100, y: (0.5 - p.y * 0.5) * 100, visible: p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 0.86 && Math.abs(p.y) < 0.76 },
      live: this.host.ai.aliveCount(), targetPressure: this.activePolicy.target, totalSpawned: this.pressure.stats().totalSpawned,
    };
  }

  private tickHoldBeats(player: Position) {
    const p = this.mission.current;
    if (p.type !== 'hold') return;
    const held = (p.seconds ?? 60) - this.mission.snapshot(player).remaining;
    const beats: [number, () => void][] = [
      [30, () => {
        this.host.dropSupply();
        this.host.radio('Supply crate on the courtyard. Grab it and stay inside the ring.');
      }],
      [58, () => this.host.radio('Pickup inbound. Break contact after the clock.')],
    ];
    for (const [t, fn] of beats) {
      if (held >= t && !this.holdBeats.has(t)) {
        this.holdBeats.add(t);
        fn();
      }
    }
  }

  dispose() { this.markers.dispose(); }
}