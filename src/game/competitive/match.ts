// ============================================================================
// OPERATION BLACKOUT — match orchestrator.
//
// Glue between three things that each stay clean on their own:
//   * CompetitiveMatch  — the rules (rounds, money, bomb, sides)
//   * TacticalDirector  — the orders both squads play by
//   * TDMManager/TDMBot — the combat brains that actually fight
//
// It owns the round lifecycle (spawns, kits, revives), the bomb prop and site
// dressing, detonation damage, and the HUD payload. It knows nothing about React
// and very little about the engine: the player is reached through PlayerBridge,
// which the engine implements.
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponId } from '../economy/catalog';
import type { World } from '../world';
import { TDMManager, type TDMContext, type TDMBot, type TDMTeam } from '../tdm';
import {
  COMP_BLAST_DAMAGE, COMP_BLAST_RADIUS, COMP_DEFUSE_RADIUS, COMP_PICKUP_RADIUS, COMP_ROUND_END_SECONDS,
  COMP_SITES, CompetitiveMatch, applyCompetitiveDamage, siteAt,
  type CompBombState, type CompEvent, type CompPhase, type CompSiteId, type CompSide, type CompTeam, type CompWinReason,
} from './rules';
import { SITE_PLANS, TacticalDirector, gearFor, type CompOrder } from './tactics';

export const PLAYER_ID = 'YOU';
export const COMP_VISUAL_BUDGET = { draws: 6, triangles: 900 } as const;

/** The player, as seen from the match runner. Implemented by the engine. */
export interface PlayerBridge {
  /** Live armour pool and helmet state, written back so survivors keep the plate. */
  armor(): number;
  helmet(): boolean;
  /** Restore armour after a buy. */
  setArmor(armor: number, helmet: boolean): void;
  alive(): boolean;
  position(): { x: number; y: number; z: number };
  /** Put the operator on a spawn pad for the new round. */
  spawn(x: number, z: number, yaw: number): void;
  /** Apply the kit the rules say this operator owns (weapons, armour, utility). */
  applyKit(kit: PlayerKit): void;
  /** Movement freeze during the buy phase. */
  setFrozen(frozen: boolean): void;
  /** Damage from the charge blast or a fall — the engine owns death handling. */
  damage(amount: number, from: { x: number; y: number; z: number }, weapon: string): void;
}

export interface PlayerKit {
  primary: WeaponId | null;
  secondary: WeaponId;
  armor: number;
  helmet: boolean;
  kit: boolean;
  frags: number;
  flashes: number;
}

/** Events the HUD, audio and announcer react to. */
export type CompUiEvent =
  | { type: 'feed'; text: string; tone: 'alpha' | 'bravo' | 'neutral' }
  | { type: 'banner'; title: string; sub: string }
  | { type: 'sound'; cue: 'plant' | 'defuse' | 'planted' | 'defused' | 'round-win' | 'round-loss' | 'match-win' | 'match-loss' | 'beep' | 'buy' | 'deny' | 'detonate'; at?: { x: number; y: number; z: number } }
  | { type: 'callout'; text: string }
  | { type: 'round-end'; winner: CompTeam; reason: CompWinReason; text: string }
  | { type: 'match-end'; winner: CompTeam | null; draw: boolean; text: string };

export interface CompRosterRow {
  id: string;
  name: string;
  team: CompTeam;
  you: boolean;
  alive: boolean;
  hp: number;
  money: number;
  kills: number;
  deaths: number;
  headshots: number;
  assists: number;
  damage: number;
  adr: number;
  plants: number;
  defuses: number;
  mvps: number;
  primary: WeaponId | null;
  armor: number;
  helmet: boolean;
  kit: boolean;
}

export interface CompHud {
  phase: CompPhase;
  round: number;
  timeLeft: number;
  score: Record<CompTeam, number>;
  /** Team currently attacking / defending. */
  attackTeam: CompTeam;
  playerTeam: CompTeam;
  playerSide: CompSide;
  money: number;
  alive: Record<CompTeam, number>;
  history: CompTeam[];
  bomb: { state: CompBombState; site: CompSiteId | null; fuse: number; carrierId: string | null; dropped: boolean };
  action: { kind: 'plant' | 'defuse'; progress: number; duration: number; actorId: string } | null;
  armor: number;
  helmet: boolean;
  kit: boolean;
  roundResult: { winner: CompTeam; reason: CompWinReason } | null;
  matchResult: { winner: CompTeam | null; draw: boolean } | null;
  prompt: { kind: 'plant' | 'defuse' | 'pickup'; ok: boolean; text: string } | null;
  spectate: { name: string; id: string } | null;
  canSpectate: boolean;
  roster: CompRosterRow[];
  /** Attackers / defenders left, for the scoreboard header. */
  siteCall: string;
}

export interface CompetitiveRunnerOptions {
  scene: THREE.Scene;
  world: World;
  ctx: TDMContext;
  player: PlayerBridge;
  emit: (event: CompUiEvent) => void;
  random?: () => number;
  /** Weapon builds from the player's armory, so ranked uses their attachments. */
  buildFor?: (weapon: WeaponId) => { weapon: WeaponId; attachments: Record<string, string> } | null;
}

/** Where each side walks in. Attackers push north from the southern apron. */
const ATTACK_PADS: [number, number][] = [[0, 36], [-6, 38], [6, 38], [-12, 40], [12, 40]];
const DEFEND_PADS: [number, number][] = [[0, -36], [-6, -38], [6, -38], [-12, -40], [12, -40]];

const padFor = (pads: [number, number][], index: number, random: () => number) => {
  const [x, z] = pads[index % pads.length];
  return { x: x + (random() - 0.5) * 3, z: z + (random() - 0.5) * 3 };
};

/**
 * Runs one ranked Search & Destroy match on the arena map.
 */
export class CompetitiveRunner {
  readonly match: CompetitiveMatch;
  readonly director: TacticalDirector;
  readonly manager: TDMManager;
  readonly group = new THREE.Group();

  private readonly scene: THREE.Scene;
  private readonly world: World;
  private readonly player: PlayerBridge;
  private readonly emit: (event: CompUiEvent) => void;
  private readonly random: () => number;
  private readonly bombMesh: THREE.Group;
  private readonly bombGlow: THREE.Sprite;
  private readonly siteMarks = new Map<CompSiteId, THREE.Group>();
  private readonly pads: { alpha: [number, number][]; bravo: [number, number][] };
  private lastRound = 0;
  private bought = -1;
  private detonated = false;
  private blinkT = 0;
  private frozen = true;
  /** Live bot armour pools, mirrored into the rules roster as they take damage. */
  private readonly botArmor = new Map<string, { armor: number; helmet: boolean }>();
  /** Spectate target chosen by the engine. */
  spectateId: string | null = null;
  private lastCarrierId: string | null = null;

  constructor(options: CompetitiveRunnerOptions) {
    this.scene = options.scene;
    this.world = options.world;
    this.player = options.player;
    this.emit = options.emit;
    this.random = options.random ?? Math.random;

    // The bot squad rosters already exist (four allies + five hostiles); the player
    // fills the fifth slot on alpha, exactly like the Arena Mode roster.
    const ctx: TDMContext = {
      ...options.ctx,
      competitive: true,
      combatLive: () => this.match?.phase === 'live',
      orders: { get: (bot: TDMBot): CompOrder | null => this.director?.orderFor(bot) ?? null },
      onKill: (killer, victim, headshot, weapon) => this.onKill(killer, victim, headshot, weapon),
    };
    this.manager = new TDMManager(ctx);
    this.pads = { alpha: ATTACK_PADS, bravo: DEFEND_PADS };

    const seeds = [
      ...this.manager.bots.filter(b => b.team === 'alpha').map(b => ({ id: b.name, name: b.name, team: 'alpha' as CompTeam })),
      { id: PLAYER_ID, name: PLAYER_ID, team: 'alpha' as CompTeam },
      ...this.manager.bots.filter(b => b.team === 'bravo').map(b => ({ id: b.name, name: b.name, team: 'bravo' as CompTeam })),
    ];
    this.match = new CompetitiveMatch(seeds, { random: this.random });
    this.director = new TacticalDirector(
      this.match,
      id => this.positionOf(id),
      { callout: (kind, team, at) => this.onSquadCallout(kind, team, at) },
      this.random,
    );

    this.bombMesh = buildBombProp();
    this.bombGlow = buildGlowSprite();
    this.bombMesh.add(this.bombGlow);
    this.group.add(this.bombMesh);
    for (const id of ['A', 'B'] as CompSiteId[]) {
      const mark = buildSiteMarker(id);
      this.siteMarks.set(id, mark);
      this.group.add(mark);
    }
    this.scene.add(this.group);
  }

  // ------------------------------------------------------------- lifecycle ---
  /** Kick off round one. */
  start(): void {
    this.match.startMatch();
    this.beginRound();
  }

  private beginRound(): void {
    this.lastRound = this.match.round;
    this.bought = -1;
    this.detonated = false;
    this.director.beginRound();
    this.placeSquads();
    this.applyAllKits();
    this.emit({ type: 'banner', title: `ROUND ${this.match.round}`, sub: `${this.sideLabel(this.match.side.alpha)} VS ${this.sideLabel(this.match.side.bravo)}` });
    this.emit({ type: 'sound', cue: 'buy' });
  }

  private sideLabel(side: CompSide): string {
    return side === 'attack' ? 'ATTACK' : 'DEFEND';
  }

  /** Teleport every operator to this round's spawn pads and revive the squad. */
  private placeSquads(): void {
    for (const bot of this.manager.bots) {
      const actor = this.match.of(bot.name);
      if (!actor) continue;
      const team = actor.team;
      const pads = this.match.side[team] === 'attack' ? ATTACK_PADS : DEFEND_PADS;
      const index = this.squadIndex(bot.name, team);
      const spot = padFor(pads, index, this.random);
      const y = this.world.groundHeight(spot.x, spot.z);
      const yaw = Math.atan2(-spot.x, -spot.z);
      bot.roundSpawn(spot.x, y, spot.z, yaw);
      actor.alive = true;
      actor.deadThisRound = false;
      this.botArmor.set(actor.id, { armor: actor.armor, helmet: actor.helmet });
    }
    const playerActor = this.match.of(PLAYER_ID);
    if (playerActor) {
      const pads = this.match.side[playerActor.team] === 'attack' ? ATTACK_PADS : DEFEND_PADS;
      const spot = padFor(pads, 5, this.random);
      this.player.spawn(spot.x, spot.z, Math.atan2(-spot.x, -spot.z));
      playerActor.alive = true;
      playerActor.deadThisRound = false;
      this.player.setArmor(playerActor.armor, playerActor.helmet);
    }
    this.frozen = true;
    this.player.setFrozen(true);
  }

  private squadIndex(id: string, team: CompTeam): number {
    const ids = this.match.combatants.filter(c => c.team === team).map(c => c.id).sort();
    return Math.max(0, ids.indexOf(id));
  }

  /** Push the rules-owned kit into the live actors (weapons, armour, utility). */
  private applyAllKits(): void {
    for (const bot of this.manager.bots) {
      const actor = this.match.of(bot.name);
      if (!actor) continue;
      const gear = gearFor(actor.primary, actor.secondary);
      bot.setCompetitive(gear, actor.armor, actor.helmet);
      this.botArmor.set(actor.id, { armor: actor.armor, helmet: actor.helmet });
    }
    const actor = this.match.of(PLAYER_ID);
    if (actor) {
      this.player.setArmor(actor.armor, actor.helmet);
      this.player.applyKit({
        primary: actor.primary, secondary: actor.secondary,
        armor: actor.armor, helmet: actor.helmet, kit: actor.kit,
        frags: actor.frags, flashes: actor.flashes,
      });
    }
  }

  /** Per-frame tick, driven by the engine's update loop. */
  update(dt: number): void {
    const previousPhase = this.match.phase;
    if (this.match.phase === 'buy' && this.bought !== this.match.round) {
      this.bought = this.match.round;
      this.runShopping();
    }
    if (this.match.phase === 'live') this.director.tick(dt, this.manager.bots);
    this.match.update(dt);
    this.manager.updateCompetitive(dt);

    // Keep the live actors in sync with the rules about who is actually alive.
    for (const bot of this.manager.bots) {
      const actor = this.match.of(bot.name);
      if (!actor) continue;
      if (actor.alive && bot.dead) bot.roundSpawn(bot.pos.x, bot.pos.y, bot.pos.z, bot.yaw);
    }

    if (this.match.phase !== previousPhase) this.onPhaseChange(previousPhase);
    for (const event of this.match.drain()) this.onRulesEvent(event);
    if (this.match.round !== this.lastRound && this.match.phase !== 'matchEnd') this.beginRound();
    this.updateBombProp(dt);
    this.updateSiteMarks();
  }

  /** Rules events drive the announcer, the feed and the charge blast. */
  private onRulesEvent(event: CompEvent): void {
    switch (event.type) {
      case 'bomb-planted':
        this.emit({ type: 'sound', cue: 'planted' });
        this.emit({ type: 'callout', text: `CHARGE PLANTED — SITE ${event.site}` });
        this.emit({ type: 'feed', text: `${event.actorId} PLANTED THE CHARGE`, tone: this.toneOf(event.actorId) });
        break;
      case 'bomb-defused':
        this.emit({ type: 'sound', cue: 'defused' });
        this.emit({ type: 'callout', text: `${event.actorId} DEFUSED THE CHARGE` });
        this.emit({ type: 'feed', text: `${event.actorId} DEFUSED THE CHARGE`, tone: this.toneOf(event.actorId) });
        break;
      case 'bomb-detonated':
        this.detonateCharge();
        break;
      case 'bomb-dropped':
        this.emit({ type: 'feed', text: 'CHARGE IS DOWN', tone: 'neutral' });
        break;
      case 'bomb-picked':
        this.emit({ type: 'feed', text: `${event.actorId} RECOVERED THE CHARGE`, tone: this.toneOf(event.actorId) });
        break;
      case 'halftime':
        this.emit({ type: 'banner', title: 'HALFTIME — SIDES SWAPPED', sub: 'ECONOMY RESET' });
        this.emit({ type: 'callout', text: 'SIDES SWAPPED. ECONOMY RESET.' });
        break;
      case 'overtime':
        this.emit({ type: 'banner', title: 'OVERTIME', sub: 'FIRST TO LEAD BY TWO' });
        this.emit({ type: 'callout', text: 'OVERTIME — FIRST TO LEAD BY TWO TAKES IT' });
        break;
      default:
        break;
    }
  }

  private toneOf(id: string): 'alpha' | 'bravo' | 'neutral' {
    const team = this.match.of(id)?.team;
    if (!team) return 'neutral';
    return team;
  }

  private onPhaseChange(previous: CompPhase): void {
    if (this.match.phase === 'live' && previous === 'buy') {
      this.frozen = false;
      this.player.setFrozen(false);
      this.emit({ type: 'banner', title: 'ROUND LIVE', sub: `${Math.round(this.match.timeLeft)} SECONDS` });
      this.emit({ type: 'callout', text: this.attackCallText() });
    }
    if (this.match.phase === 'roundEnd' && this.match.lastRound) {
      const { winner, reason } = this.match.lastRound;
      const text = roundEndText(winner, reason, this.match);
      this.emit({ type: 'round-end', winner, reason, text });
      this.emit({ type: 'banner', title: text, sub: `${this.match.score.alpha} — ${this.match.score.bravo}` });
      const playerTeam = this.match.of(PLAYER_ID)?.team;
      this.emit({ type: 'sound', cue: winner === playerTeam ? 'round-win' : 'round-loss' });
    }
    if (this.match.phase === 'matchEnd') {
      const draw = this.match.draw;
      const winner = this.match.winner;
      const text = draw ? 'MATCH DRAW' : winner === this.match.of(PLAYER_ID)?.team ? 'VICTORY' : 'DEFEAT';
      this.emit({ type: 'match-end', winner, draw, text });
      this.emit({ type: 'banner', title: text, sub: `FINAL ${this.match.score.alpha} — ${this.match.score.bravo}` });
      this.emit({ type: 'sound', cue: draw ? 'round-loss' : winner === this.match.of(PLAYER_ID)?.team ? 'match-win' : 'match-loss' });
      this.frozen = true;
      this.player.setFrozen(true);
    }
  }

  private attackCallText(): string {
    const attacking = this.match.teamOnSide('attack');
    const playerTeam = this.match.of(PLAYER_ID)?.team;
    if (attacking === playerTeam) return `EXECUTE ${this.director.targetSite} — TAKE THE HALL`;
    return `THEY WILL HIT ${this.director.targetSite}`;
  }

  // -------------------------------------------------------------- shopping ---
  /** The squad buys: rules validate, bots take what the director asked for. */
  private runShopping(): void {
    for (const { bot, items } of this.director.shoppingList(this.manager.bots)) {
      for (const itemId of items) {
        if (this.match.buy(bot.name, itemId)) break;
      }
    }
    this.applyAllKits();
  }

  // ------------------------------------------------------------------ kills --
  /** Single funnel for every kill in the match, player included. */
  private onKill(killer: TDMBot | 'player', victim: TDMBot | 'player', headshot: boolean, weapon: string): void {
    const killerId = killer === 'player' ? PLAYER_ID : killer.name;
    const victimId = victim === 'player' ? PLAYER_ID : victim.name;
    this.match.notifyKill(killerId, victimId, weapon, headshot);
    if (victimId === PLAYER_ID) this.spectateId = null;
  }

  /** The player's kit exactly as the rules have it — used to rebuild the viewmodel. */
  currentKit(): PlayerKit {
    const actor = this.match.of(PLAYER_ID);
    return {
      primary: actor?.primary ?? null,
      secondary: actor?.secondary ?? 'm1911',
      armor: actor?.armor ?? 0,
      helmet: actor?.helmet ?? false,
      kit: actor?.kit ?? false,
      frags: actor?.frags ?? 0,
      flashes: actor?.flashes ?? 0,
    };
  }

  /**
   * Public kill funnel: the engine resolves player ↔ bot fights itself (its own
   * ballistics), so it reports the outcome here instead of the bot brains doing it.
   */
  reportKill(killer: TDMBot | 'player', victim: TDMBot | 'player', headshot: boolean, weapon: string): void {
    this.onKill(killer, victim, headshot, weapon);
  }

  /** The engine resolves the player's death itself (blast or gunfire). */
  reportPlayerDeath(killer: TDMBot | null, headshot: boolean, weapon: string): void {
    this.match.notifyKill(killer ? killer.name : null, PLAYER_ID, weapon, headshot);
    if (this.spectateId === null) {
      const mates = this.manager.bots.filter(b => !b.dead && b.team === (this.match.of(PLAYER_ID)?.team ?? 'alpha'));
      this.spectateId = mates[0]?.name ?? null;
    }
  }

  /** Damage bookkeeping for the ADR column (the engine calls this on every hit). */
  notifyDamage(victimId: string, amount: number): void {
    this.match.notifyDamage(victimId, amount);
  }

  /**
   * Bot armour is consumed by the competitive model. The depleted plate is written
   * back into the rules roster so a survivor carries a half-broken vest into the
   * next round instead of a fresh one.
   */
  syncBotArmor(id: string, armor: number, helmet: boolean): void {
    const actor = this.match.of(id);
    if (actor) { actor.armor = armor; actor.helmet = helmet; }
    this.botArmor.set(id, { armor, helmet });
  }

  // ------------------------------------------------------------ bomb + sites --
  private updateBombProp(dt: number): void {
    const bomb = this.match.bomb;
    const visible = bomb.state === 'dropped' || bomb.state === 'planted' || bomb.state === 'defused';
    this.bombMesh.visible = visible;
    if (visible) {
      const y = this.world.groundHeight(bomb.x, bomb.z) + 0.14;
      this.bombMesh.position.set(bomb.x, y, bomb.z);
      this.bombMesh.rotation.y += this.match.bomb.state === 'planted' ? dt * 0.6 : 0;
    }
    const led = this.bombMesh.userData.led as THREE.Mesh | undefined;
    const material = led?.material as THREE.MeshStandardMaterial | undefined;
    if (material) {
      // The blink rate is the clock: slow at 40 s, frantic under 10.
      const fuse = bomb.state === 'planted' ? bomb.fuse : 0;
      const rate = bomb.state === 'planted' ? 1.4 + (1 - fuse / 40) * 5.5 : 1.2;
      this.blinkT += dt * rate;
      const on = Math.sin(this.blinkT * Math.PI * 2) > 0;
      material.emissiveIntensity = bomb.state === 'defused' ? 0 : on ? 1 : 0.05;
      this.bombGlow.visible = on && bomb.state === 'planted';
      const scale = 1 + (bomb.state === 'planted' ? (1 - fuse / 40) * 0.5 : 0);
      this.bombGlow.scale.set(0.5 * scale, 0.5 * scale, 1);
    }
    if (bomb.state === 'carried' && this.lastCarrierId !== bomb.carrierId) {
      this.lastCarrierId = bomb.carrierId;
      if (bomb.carrierId === PLAYER_ID) this.emit({ type: 'callout', text: 'YOU HAVE THE CHARGE' });
    }
    if (bomb.state !== 'carried') this.lastCarrierId = null;
  }

  private updateSiteMarks(): void {
    const armed = this.match.bomb.state === 'planted';
    for (const [id, mark] of this.siteMarks) {
      const ring = mark.children[1] as THREE.Mesh | undefined;
      const material = ring?.material as THREE.MeshBasicMaterial | undefined;
      if (!material) continue;
      const active = armed ? this.match.bomb.site === id : this.director.targetSite === id;
      const pulse = armed && this.match.bomb.site === id ? 0.55 + Math.sin(performance.now() * 0.006) * 0.25 : 0.26;
      material.opacity = active ? pulse : 0.12;
    }
  }

  /**
   * Detonation. Called when the rules report the charge went off: the blast kills
   * everything inside the radius (both teams), blows out glass, and ends the round.
   */
  private detonateCharge(): void {
    if (this.detonated) return;
    this.detonated = true;
    const site = this.match.bomb.site ?? 'A';
    const pos = SHELL.set(this.match.bomb.x, this.world.groundHeight(this.match.bomb.x, this.match.bomb.z) + 0.5, this.match.bomb.z);
    this.emit({ type: 'sound', cue: 'detonate', at: { x: pos.x, y: pos.y, z: pos.z } });
    this.emit({ type: 'callout', text: `CHARGE DETONATED — ${site} DECK` });
    for (const bot of this.manager.bots) {
      if (bot.dead) continue;
      const d = bot.pos.distanceTo(pos);
      if (d > COMP_BLAST_RADIUS) continue;
      const dmg = blastDamage(d);
      const killed = bot.takeDamage(dmg, false, 'player', false);
      if (killed) this.match.notifyKill(null, bot.name, 'C4', false);
    }
    const playerPos = this.player.position();
    const dp = Math.hypot(playerPos.x - pos.x, playerPos.y - pos.y, playerPos.z - pos.z);
    if (this.player.alive() && dp <= COMP_BLAST_RADIUS) this.player.damage(blastDamage(dp), { x: pos.x, y: pos.y, z: pos.z }, 'C4');
  }

  // ------------------------------------------------------------ interactions --
  /** The player holds the interact key: plants or defuses through the rules. */
  playerHoldAction(dt: number): void {
    const actor = this.match.of(PLAYER_ID);
    if (!actor || !actor.alive || this.match.phase !== 'live') return;
    const pos = this.player.position();
    const site = siteAt(pos.x, pos.z);
    const bombDist = Math.hypot(pos.x - this.match.bomb.x, pos.z - this.match.bomb.z);
    if (this.match.bomb.state === 'carried' && this.match.bomb.carrierId === PLAYER_ID) {
      this.match.holdAction(PLAYER_ID, 'plant', dt, { site, bombDist });
    } else if (this.match.bomb.state === 'planted' && this.match.sideOfId(PLAYER_ID) === 'defend') {
      this.match.holdAction(PLAYER_ID, 'defuse', dt, { site, bombDist });
    }
  }

  playerReleaseAction(): void {
    if (this.match.action?.actorId === PLAYER_ID) this.match.cancelAction();
  }

  /** Buy for the player; the rules reject anything illegal or unaffordable. */
  playerBuy(itemId: string): boolean {
    const ok = this.match.buy(PLAYER_ID, itemId);
    if (ok) {
      const actor = this.match.of(PLAYER_ID);
      if (actor) this.player.setArmor(actor.armor, actor.helmet);
      this.applyPlayerKit();
      this.emit({ type: 'sound', cue: 'buy' });
    } else {
      this.emit({ type: 'sound', cue: 'deny' });
    }
    return ok;
  }

  private applyPlayerKit(): void {
    const actor = this.match.of(PLAYER_ID);
    if (!actor) return;
    this.player.applyKit({
      primary: actor.primary, secondary: actor.secondary,
      armor: actor.armor, helmet: actor.helmet, kit: actor.kit,
      frags: actor.frags, flashes: actor.flashes,
    });
  }

  /** Walking over a dropped charge as an attacker picks it up. */
  playerTryPickup(): boolean {
    const pos = this.player.position();
    const picked = this.match.tryPickup(PLAYER_ID, pos.x, pos.z);
    if (picked) this.emit({ type: 'callout', text: 'CHARGE RECOVERED — PLANT AT A OR B' });
    return picked;
  }

  /** Positions of every live combatant — feeds the radar, spectate and the AI. */
  positionOf(id: string): { x: number; z: number } | null {
    if (id === PLAYER_ID) {
      const pos = this.player.position();
      return { x: pos.x, z: pos.z };
    }
    const bot = this.manager.bots.find(b => b.name === id);
    return bot ? { x: bot.pos.x, z: bot.pos.z } : null;
  }

  private onSquadCallout(kind: string, team: CompTeam, at: { x: number; z: number }): void {
    void at;
    const playerTeam = this.match.of(PLAYER_ID)?.team;
    const friendly = team === playerTeam;
    if (kind === 'target-a' || kind === 'target-b') return; // the banner covers it
    const texts: Record<string, [string, string]> = {
      planting: ['THEY ARE PLANTING', 'PLANTING CHARGES'],
      defusing: ['THEY ARE DEFUSING', 'CUTTING THE WIRE'],
      retake: ['RETAKE — HOLD THE SITE', 'THEY ARE RETAKEING'],
      rotating: ['ROTATING', 'CONTACT — ROTATING'],
      recover: ['RECOVERING THE CHARGE', 'CHARGE IS DOWN'],
    };
    const line = texts[kind]?.[friendly ? 1 : 0];
    if (line) this.emit({ type: 'callout', text: line });
  }

  // ------------------------------------------------------------------- HUD ---
  hud(): CompHud {
    const actor = this.match.of(PLAYER_ID);
    const playerTeam: CompTeam = actor?.team ?? 'alpha';
    const playerSide = this.match.side[playerTeam];
    const attackTeam = this.match.teamOnSide('attack');
    const pos = this.player.position();
    // The call is the site the player is standing on if they are already there, and
    // otherwise the one the squad is executing on: attackers never read a blank objective.
    const site = siteAt(pos.x, pos.z) ?? (playerSide === 'attack' ? this.director.targetSite : null);
    const bombDist = Math.hypot(pos.x - this.match.bomb.x, pos.z - this.match.bomb.z);
    let prompt: CompHud['prompt'] = null;
    if (actor?.alive && this.match.phase === 'live') {
      if (this.match.bomb.state === 'carried' && this.match.bomb.carrierId === PLAYER_ID) {
        prompt = { kind: 'plant', ok: site !== null, text: site ? `HOLD [X] TO PLANT — SITE ${site}` : 'CARRY THE CHARGE TO SITE A OR B' };
      } else if (this.match.bomb.state === 'planted' && playerSide === 'defend') {
        prompt = { kind: 'defuse', ok: bombDist <= COMP_DEFUSE_RADIUS, text: bombDist <= COMP_DEFUSE_RADIUS ? 'HOLD [X] TO DEFUSE' : 'REACH THE CHARGE TO DEFUSE' };
      } else if (this.match.bomb.state === 'dropped' && playerSide === 'attack') {
        prompt = { kind: 'pickup', ok: bombDist <= COMP_PICKUP_RADIUS, text: bombDist <= COMP_PICKUP_RADIUS ? 'CHARGE AT YOUR FEET' : 'RECOVER THE CHARGE' };
      }
    }
    const spectateBot = this.spectateId ? this.manager.bots.find(b => b.name === this.spectateId) : undefined;
    return {
      phase: this.match.phase,
      round: this.match.round,
      timeLeft: this.match.timeLeft,
      score: { ...this.match.score },
      attackTeam,
      playerTeam,
      playerSide,
      money: actor?.money ?? 0,
      alive: { alpha: this.match.aliveIds('alpha').length, bravo: this.match.aliveIds('bravo').length },
      history: [...this.match.history],
      bomb: {
        state: this.match.bomb.state,
        site: this.match.bomb.site,
        fuse: this.match.bomb.fuse,
        carrierId: this.match.bomb.carrierId,
        dropped: this.match.bomb.state === 'dropped',
      },
      action: this.match.action
        ? { kind: this.match.action.kind, progress: this.match.action.progress, duration: this.match.action.duration, actorId: this.match.action.actorId }
        : null,
      armor: actor?.armor ?? 0,
      helmet: actor?.helmet ?? false,
      kit: actor?.kit ?? false,
      roundResult: this.match.lastRound ? { ...this.match.lastRound } : null,
      matchResult: this.match.phase === 'matchEnd' ? { winner: this.match.winner, draw: this.match.draw } : null,
      prompt,
      spectate: spectateBot ? { name: spectateBot.name, id: spectateBot.name } : null,
      canSpectate: !!this.spectateId,
      roster: this.rosterRows(),
      siteCall: `${site ?? '—'}`,
    };
  }

  private rosterRows(): CompRosterRow[] {
   	const rows: CompRosterRow[] = [];
    for (const c of this.match.combatants) {
      const bot = this.manager.bots.find(b => b.name === c.id);
      const hp = c.id === PLAYER_ID ? (c.alive ? 100 : 0) : bot ? Math.max(0, Math.round(bot.hp)) : 0;
      rows.push({
        id: c.id, name: c.id, team: c.team, you: c.id === PLAYER_ID, alive: c.alive, hp,
        money: c.money, kills: c.kills, deaths: c.deaths, headshots: c.headshots, assists: 0,
        damage: Math.round(c.damage), adr: Math.round(c.damage / Math.max(1, c.roundsPlayed)),
        plants: c.plants, defuses: c.defuses, mvps: c.mvps,
        primary: c.primary, armor: c.armor, helmet: c.helmet, kit: c.kit,
      });
    }
    return rows;
  }

  /** Which pads a team walks in from this round (HUD + spawn safety). */
  padsFor(team: CompTeam): [number, number][] {
    return this.match.side[team] === 'attack' ? this.pads.alpha : this.pads.bravo;
  }

  get isFrozen(): boolean { return this.frozen; }

  /** Charge state for the engine's spectate / camera logic. */
  bombPosition(): { x: number; y: number; z: number } {
    const y = this.world.groundHeight(this.match.bomb.x, this.match.bomb.z) + 0.2;
    return { x: this.match.bomb.x, y, z: this.match.bomb.z };
  }

  dispose(): void {
    this.manager.dispose();
    this.group.removeFromParent();
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite)) return;
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material?.dispose?.();
    });
    this.siteMarks.clear();
  }
}

// ---------------------------------------------------------------- helpers ----
const SHELL = new THREE.Vector3();

/** Radial charge damage: lethal inside 5 m, survivable at the rim. */
export function blastDamage(distance: number): number {
  if (distance <= 5) return COMP_BLAST_DAMAGE;
  const t = Math.min(1, (distance - 5) / (COMP_BLAST_RADIUS - 5));
  return Math.max(6, COMP_BLAST_DAMAGE * (1 - t) * 0.55);
}

export function roundEndText(winner: CompTeam, reason: CompWinReason, match: CompetitiveMatch): string {
  void match;
  const team = winner === 'alpha' ? 'ALPHA' : 'BRAVO';
  switch (reason) {
    case 'elimination': return `${team} WINS — ENEMY ELIMINATED`;
    case 'detonation': return 'CHARGE DETONATED';
    case 'defuse': return `${team} DEFUSED THE CHARGE`;
    case 'time': return `${team} HOLDS — TIME EXPIRED`;
    case 'defused-time': return 'CHARGE DEFUSED ON THE LINE';
    default: return `${team} TAKES THE ROUND`;
  }
}

/** The charge: a field case with a blinking LED and a strap. */
function buildBombProp(): THREE.Group {
  const group = new THREE.Group();
  const parts = [
    new THREE.BoxGeometry(0.42, 0.3, 0.26),
    new THREE.BoxGeometry(0.44, 0.06, 0.28).translate(0, 0.14, 0),
    new THREE.BoxGeometry(0.12, 0.02, 0.3).translate(-0.06, 0.19, 0),
  ];
  const body = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ color: 0x4b5340, roughness: 0.75, metalness: 0.2 }));
  parts.forEach(part => part.dispose());
  body.castShadow = true;
  group.add(body);
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.05, 0.02).translate(0.1, 0.03, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x3a1010, emissive: 0xff2d18, emissiveIntensity: 0.6 }),
  );
  group.add(led);
  const wires = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.02, 0.02).translate(0, -0.16, 0),
    new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 }),
  );
  group.add(wires);
  group.userData.led = led;
  group.visible = false;
  return group;
}

/** Soft additive halo behind the LED — no extra scene light. */
function buildGlowSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(255,90,60,0.95)');
  gradient.addColorStop(0.45, 'rgba(255,60,30,0.35)');
  gradient.addColorStop(1, 'rgba(255,40,20,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.position.set(0.1, 0.05, 0.15);
  sprite.scale.set(0.5, 0.5, 1);
  return sprite;
}

/** Floor dressing for a bomb site: painted ring + stencilled letter plate. */
function buildSiteMarker(id: CompSiteId): THREE.Group {
  const site = COMP_SITES[id];
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(site.radius - 0.35, site.radius, 56),
    new THREE.MeshBasicMaterial({ color: id === 'A' ? 0xffb347 : 0xff8a3d, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(site.x, 0.06, site.z);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(site.radius * 1.15, site.radius * 1.15),
    new THREE.MeshBasicMaterial({ map: siteLetterTexture(id), transparent: true, opacity: 0.85, depthWrite: false }),
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(site.x, 0.07, site.z);
  group.add(plate, ring);
  return group;
}

/** Canvas letter plate ("SITE A · WEST HALL") painted straight onto the floor. */
function siteLetterTexture(id: CompSiteId): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255,180,90,0.55)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,190,110,0.92)';
  ctx.font = 'bold 150px "Barlow Condensed", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(id, 128, 118);
  ctx.font = 'bold 34px "Barlow Condensed", Impact, sans-serif';
  ctx.fillStyle = 'rgba(255,190,110,0.7)';
  ctx.fillText('SITE', 128, 214);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Squad roster names, mirrored from the TDM manager so both modes agree. */
export function rankedRosterNames(manager: TDMManager): { alpha: string[]; bravo: string[] } {
  return {
    alpha: manager.bots.filter(b => b.team === 'alpha').map(b => b.name),
    bravo: manager.bots.filter(b => b.team === 'bravo').map(b => b.name),
  };
}

/** TDM team of a combatant id (used by the HUD's team colours). */
export function teamOfId(manager: TDMManager, id: string): TDMTeam | null {
  const bot = manager.bots.find(b => b.name === id);
  if (bot) return bot.team;
  return id === PLAYER_ID ? 'alpha' : null;
}

/** Export for tests: keep the round-end banner text honest about the phases. */
export const COMP_ROUND_END_BEAT = COMP_ROUND_END_SECONDS;

/** Where a bot's post is, for the debug + test harness. */
export const sitePlanFor = (site: CompSiteId) => SITE_PLANS[site];

/** Competitive armour helper re-export so the engine uses one implementation. */
export { applyCompetitiveDamage };
