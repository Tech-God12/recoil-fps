// Recoil FPS — Bomb Defusal director.
// Owns the round lifecycle (freeze → live → planted → post), the per-combatant
// economy, the bomb itself, and the team-level brains that hand every bot its
// orders: attackers pick a site and a style (execute / split / rush / lurk),
// stage, hit the site together and play post-plant crossfires; defenders set up
// on both sites, rotate on intel, retake, and decide when to stick a defuse.
import * as THREE from 'three';
import { BOT_GUNS, type BotOrders, type TDMBot, type TDMManager } from '../tdm';
import {
  DEFUSE, DefuseMatch, applyBuy, clampMoney, freshKit, killReward, roundIncome, reasonLabel, beepInterval,
  DEFUSE_PLAYER_BONUS, PLANT_PLAYER_BONUS,
  type BuyCheck, type DefuseSide, type DefuseTeam, type Kit, type MatchFormat, type RoundEndReason, type RoundPhase, type RoundRecord, type SiteId,
} from './rules';
import { ATTACK_SPAWNS, DEFEND_SPAWNS, MID_HOLD, MID_LURK, SITES, siteAt, type XZ, type BombSite } from './sites';
import { BombProp } from './bomb';

const RUN = 4.6;
const WALK = 3.1;
const v3 = (p: XZ, y = 0) => new THREE.Vector3(p[0], y, p[1]);

export interface Combatant {
  name: string;
  team: DefuseTeam;
  bot: TDMBot | null;
  kit: Kit;
  kills: number; deaths: number; assists: number; headshots: number;
  damage: number; mvps: number; plants: number; defuses: number; clutches: number;
  roundKills: number;
  /** Damage received this round, keyed by attacker name (assist credit ≥ 41). */
  hurtBy: Map<string, number>;
}

export interface CombatantStat {
  name: string; team: DefuseTeam; you: boolean; alive: boolean;
  kills: number; deaths: number; assists: number; headshots: number;
  damage: number; adr: number; mvps: number; plants: number; defuses: number; clutches: number;
  money: number; weapon: string; armor: 0 | 1 | 2; kit: boolean; hasBomb: boolean;
}

export interface DefuseSummary {
  alphaScore: number;
  bravoScore: number;
  winner: DefuseTeam | 'draw';
  history: RoundRecord[];
  players: CombatantStat[];
  format: string;
  rounds: number;
}

export type DefuseEvent =
  | { type: 'round-start'; round: number; side: DefuseSide; pistol: boolean; suddenDeath: boolean; matchPoint: DefuseTeam | null; lastOfHalf: boolean; halftimeReset: boolean }
  | { type: 'freeze-end'; side: DefuseSide }
  | { type: 'round-end'; winner: DefuseTeam; reason: RoundEndReason; reasonText: string; mvp: string; mvpWhy: string; income: number; alphaScore: number; bravoScore: number; halftime: boolean; over: boolean; suddenDeath: boolean; clutch: number }
  | { type: 'bomb'; what: 'planted' | 'defused' | 'dropped' | 'picked' | 'exploded' | 'plant-start' | 'defuse-start'; site?: SiteId; by?: string; byTeam?: DefuseTeam; playerCarrier?: boolean }
  | { type: 'money'; amount: number; reason: string }
  | { type: 'clutch'; vs: number }
  | { type: 'feed'; killer: string; killerTeam: DefuseTeam; weapon: string; victim: string; headshot: boolean; zone: string }
  | { type: 'beep'; pos: THREE.Vector3; urgency: number };

export interface DirectorHooks {
  scene: THREE.Scene;
  groundHeight(x: number, z: number): number;
  playerFeet(): THREE.Vector3;
  playerAlive(): boolean;
  /** Round (re)start: teleport + re-arm the player from their kit. */
  placePlayer(spawn: THREE.Vector3, faceTo: THREE.Vector3, kit: Kit, rearm: boolean): void;
  /** Bomb blast: engine applies player damage + VFX/SFX. */
  explode(pos: THREE.Vector3): void;
  emit(ev: DefuseEvent): void;
  matchOver(summary: DefuseSummary): void;
}

type AttackStyle = 'execute' | 'split' | 'rush' | 'lurk';
type AttackRole = 'yard' | 'hall' | 'lurk';
interface AttackPlan { site: SiteId; style: AttackStyle; executeAt: number; go: boolean; roles: Map<TDMBot, AttackRole> }
interface DefendSlot { site: SiteId | 'mid'; spot: number }

export class DefuseDirector {
  readonly match: DefuseMatch;
  readonly combatants: Combatant[] = [];
  readonly player: Combatant;
  phase: RoundPhase = 'freeze';
  timer: number = DEFUSE.freezeTime;
  /** Seconds since the freeze ended (buy window + execute timing). */
  liveT = 0;
  bomb = {
    state: 'carried' as 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded',
    carrier: null as Combatant | null,
    pos: new THREE.Vector3(),
    site: null as SiteId | null,
    timeLeft: DEFUSE.bombTime,
    plantT: 0,
    defuseT: 0,
    defuser: null as Combatant | null,
    planter: null as Combatant | null,
  };
  /** Player spawn point for the buy-zone check. */
  playerSpawn = new THREE.Vector3();
  playerHoldingUse = false;
  playerBusy = false;
  private prop: BombProp;
  private tdm: TDMManager;
  private hooks: DirectorHooks;
  private plan: AttackPlan = { site: 'A', style: 'execute', executeAt: 25, go: false, roles: new Map() };
  private defendSlots = new Map<TDMBot, DefendSlot>();
  private rotateTo: SiteId | null = null;
  private intel: Record<SiteId, number> = { A: 0, B: 0 };
  private orderT = 0;
  private beepT = 0;
  private lastSite: SiteId | null = null;
  private clutchAnnounced = false;
  private clutchVs = 0;
  private roundOutcome: { halftime: boolean; over: boolean } = { halftime: false, over: false };
  private halftimeReset = false;
  private matchSummarySent = false;
  private defuseAnnounced: Combatant | null = null;

  constructor(tdm: TDMManager, hooks: DirectorHooks, format: MatchFormat, alphaStartSide: DefuseSide) {
    this.tdm = tdm;
    this.hooks = hooks;
    this.match = new DefuseMatch(format, alphaStartSide);
    this.prop = new BombProp(hooks.scene);
    const mk = (name: string, team: DefuseTeam, bot: TDMBot | null): Combatant => ({
      name, team, bot, kit: freshKit(), kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, mvps: 0,
      plants: 0, defuses: 0, clutches: 0, roundKills: 0, hurtBy: new Map(),
    });
    this.player = mk('YOU', 'alpha', null);
    this.combatants.push(this.player);
    for (const b of tdm.bots) this.combatants.push(mk(b.name, b.team, b));
    tdm.onKill = (k, v, hs, w) => this.onKill(k, v, hs, w);
    tdm.onDamage = (a, v, amt) => this.recordDamage(a === 'player' ? this.player : this.byBot(a), this.byBot(v), amt);
    this.startRound();
  }

  // ============================ QUERIES ============================
  byBot(b: TDMBot): Combatant { return this.combatants.find(c => c.bot === b)!; }
  alive(c: Combatant): boolean { return c.bot ? !c.bot.dead : this.hooks.playerAlive(); }
  sideOf(team: DefuseTeam): DefuseSide { return this.match.sideOf(team); }
  get playerSide(): DefuseSide { return this.sideOf('alpha'); }
  aliveOn(team: DefuseTeam): Combatant[] { return this.combatants.filter(c => c.team === team && this.alive(c)); }
  get frozen(): boolean { return this.phase === 'freeze'; }
  get buyOpen(): boolean {
    if (this.phase === 'freeze') return this.hooks.playerAlive();
    if (this.phase !== 'live' || this.liveT > DEFUSE.buyWindow || !this.hooks.playerAlive()) return false;
    const f = this.hooks.playerFeet();
    return Math.hypot(f.x - this.playerSpawn.x, f.z - this.playerSpawn.z) < 14;
  }
  get buyTimeLeft(): number {
    return this.phase === 'freeze' ? this.timer + DEFUSE.buyWindow : Math.max(0, DEFUSE.buyWindow - this.liveT);
  }
  get playerHasBomb(): boolean { return this.bomb.state === 'carried' && this.bomb.carrier === this.player; }
  weaponLabel(c: Combatant): string {
    const id = c.kit.primary ?? c.kit.secondary;
    return BOT_GUNS[id]?.label ?? id.toUpperCase();
  }
  stats(): CombatantStat[] {
    const rounds = Math.max(1, this.match.history.length + (this.phase === 'post' || this.phase === 'over' ? 0 : 1));
    return this.combatants.map(c => ({
      name: c.name, team: c.team, you: c === this.player, alive: this.alive(c),
      kills: c.kills, deaths: c.deaths, assists: c.assists, headshots: c.headshots,
      damage: Math.round(c.damage), adr: Math.round(c.damage / rounds), mvps: c.mvps,
      plants: c.plants, defuses: c.defuses, clutches: c.clutches,
      money: c.kit.money, weapon: this.weaponLabel(c), armor: c.kit.armor, kit: c.kit.kit,
      hasBomb: this.bomb.state === 'carried' && this.bomb.carrier === c,
    }));
  }
  /** 0..1 urgency of the planted bomb (drives the HUD icon pulse). */
  get bombUrgency(): number { return this.bomb.state === 'planted' ? 1 - this.bomb.timeLeft / DEFUSE.bombTime : 0; }

  // ============================ ROUND FLOW ============================
  private startRound() {
    const m = this.match;
    const newHalf = m.round === 1 || m.round === m.format.half + 1;
    this.halftimeReset = m.round === m.format.half + 1;
    if (m.suddenDeath) {
      for (const c of this.combatants) c.kit = freshKit(DEFUSE.suddenDeathMoney);
    } else if (newHalf) {
      for (const c of this.combatants) c.kit = freshKit(DEFUSE.startMoney);
    }
    this.phase = 'freeze';
    this.timer = DEFUSE.freezeTime;
    this.liveT = 0;
    this.rotateTo = null;
    this.intel = { A: 0, B: 0 };
    this.clutchAnnounced = false;
    this.clutchVs = 0;
    this.defuseAnnounced = null;
    for (const c of this.combatants) { c.roundKills = 0; c.hurtBy.clear(); }
    const attack = m.teamOn('attack');
    this.tdm.frozen = true;

    // --- spawn everyone on their side's pads (player takes a slot too) ---
    const placeTeam = (team: DefuseTeam, pads: XZ[]) => {
      const order = [...pads].sort(() => Math.random() - 0.5);
      const members = this.combatants.filter(c => c.team === team);
      const face = team === attack ? new THREE.Vector3(0, 0, -20) : new THREE.Vector3(0, 0, 20);
      members.forEach((c, i) => {
        const [px, pz] = order[i % order.length];
        const at = new THREE.Vector3(px + (Math.random() - 0.5) * 1.2, 0, pz + (Math.random() - 0.5) * 1.2);
        at.y = this.hooks.groundHeight(at.x, at.z);
        if (c.bot) {
          c.bot.armor = c.kit.armor;
          c.bot.respawn(at);
          c.bot.orders = null;
          c.bot.yaw = Math.atan2(-(face.x - at.x), -(face.z - at.z));
          c.bot.model.group.rotation.y = c.bot.yaw;
        } else {
          this.playerSpawn.copy(at);
        }
      });
    };
    placeTeam(attack, ATTACK_SPAWNS);
    placeTeam(attack === 'alpha' ? 'bravo' : 'alpha', DEFEND_SPAWNS);

    // --- bots buy ---
    for (const c of this.combatants) if (c.bot) this.botBuy(c);

    // --- the player: teleport + re-arm ---
    const faceTo = this.playerSide === 'attack' ? new THREE.Vector3(this.playerSpawn.x, 0, 0) : new THREE.Vector3(this.playerSpawn.x, 0, 0);
    this.hooks.placePlayer(this.playerSpawn.clone(), faceTo, this.player.kit, true);

    // --- bomb to a random attacker (the player gets it 2 rounds in 5 when attacking) ---
    const attackers = this.combatants.filter(c => c.team === attack);
    let carrier: Combatant;
    if (attack === 'alpha' && Math.random() < 0.4) carrier = this.player;
    else {
      const bots = attackers.filter(c => c.bot);
      carrier = bots[Math.floor(Math.random() * bots.length)];
    }
    this.giveBomb(carrier, false);
    this.bomb.site = null; this.bomb.timeLeft = DEFUSE.bombTime; this.bomb.plantT = 0; this.bomb.defuseT = 0;
    this.bomb.defuser = null; this.bomb.planter = null;

    this.planAttack();
    this.planDefense();
    this.hooks.emit({
      type: 'round-start', round: m.round, side: this.playerSide, pistol: m.pistolRound && !m.suddenDeath,
      suddenDeath: m.suddenDeath, matchPoint: m.matchPointFor(), lastOfHalf: m.lastRoundOfHalf, halftimeReset: this.halftimeReset,
    });
  }

  private giveBomb(c: Combatant, announce = true) {
    this.bomb.state = 'carried';
    this.bomb.carrier = c;
    if (c.bot) this.prop.carryOn(c.bot.model.parts.torso);
    else this.prop.hide();
    if (announce) this.hooks.emit({ type: 'bomb', what: 'picked', by: c.name, byTeam: c.team, playerCarrier: c === this.player });
  }

  /** Player throws the bomb ~2 m ahead so a teammate can take it (H). */
  playerDropBomb(forward: THREE.Vector3): boolean {
    if (!this.playerHasBomb || (this.phase !== 'live' && this.phase !== 'freeze')) return false;
    const pf = this.hooks.playerFeet();
    this.dropBomb(new THREE.Vector3(pf.x + forward.x * 2.2, pf.y, pf.z + forward.z * 2.2));
    this.playerPickupBlockT = 2.5;
    return true;
  }
  private playerPickupBlockT = 0;

  private dropBomb(at: THREE.Vector3) {
    this.bomb.state = 'dropped';
    this.bomb.carrier = null;
    this.bomb.plantT = 0;
    this.bomb.pos.set(at.x, Math.max(at.y, this.hooks.groundHeight(at.x, at.z)) + 0.01, at.z);
    this.prop.placeAt(this.bomb.pos, 'ground', Math.random() * Math.PI);
    this.hooks.emit({ type: 'bomb', what: 'dropped' });
  }

  private endRound(winner: DefuseTeam, reason: RoundEndReason) {
    if (this.phase === 'post' || this.phase === 'over') return;
    this.phase = 'post';
    this.timer = DEFUSE.postRound;
    const m = this.match;
    const planted = this.bomb.planter !== null;
    // --- MVP: bomb hero if the bomb decided it, else the top fragger of the winners ---
    let mvp: Combatant | null = null, mvpWhy = '';
    if (reason === 'bomb' && this.bomb.planter?.team === winner) { mvp = this.bomb.planter; mvpWhy = 'Planted the bomb'; }
    else if (reason === 'defuse' && this.bomb.defuser?.team === winner) { mvp = this.bomb.defuser; mvpWhy = 'Defused the bomb'; }
    if (!mvp) {
      const winners = this.combatants.filter(c => c.team === winner).sort((a, b) => b.roundKills - a.roundKills);
      mvp = winners[0] ?? null;
      if (mvp) mvpWhy = mvp.roundKills > 0 ? `${mvp.roundKills} elimination${mvp.roundKills > 1 ? 's' : ''}` : 'Survived';
    }
    if (mvp) mvp.mvps++;
    // --- clutch: the last player standing won it ---
    let clutch = 0;
    if (winner === 'alpha' && this.clutchVs >= 2 && this.hooks.playerAlive() && this.aliveOn('alpha').length === 1) {
      clutch = this.clutchVs; this.player.clutches++;
    }
    // --- income (computed with the pre-round loss streak) ---
    let playerIncome = 0;
    for (const c of this.combatants) {
      const won = c.team === winner;
      const side = m.sideOf(c.team);
      const inc = roundIncome({ won, reason, side, lossStreak: won ? 0 : m.lossStreak[c.team] + 1, planted, survived: this.alive(c) });
      c.kit.money = clampMoney(c.kit.money + inc);
      if (c === this.player) playerIncome = inc;
      // survivors keep their grenades as thrown
      if (c.bot && !c.bot.dead) { c.kit.frags = Math.min(c.kit.frags, c.bot.frags); c.kit.flashes = Math.min(c.kit.flashes, c.bot.flashes); }
    }
    const outcome = m.recordRound(winner, reason, mvp?.name ?? '—');
    this.roundOutcome = outcome;
    if (outcome.over) this.phase = 'post';
    this.hooks.emit({
      type: 'round-end', winner, reason, reasonText: reasonLabel(reason), mvp: mvp?.name ?? '—', mvpWhy,
      income: playerIncome, alphaScore: m.alphaScore, bravoScore: m.bravoScore,
      halftime: outcome.halftime, over: outcome.over, suddenDeath: outcome.suddenDeath, clutch,
    });
    for (const c of this.combatants) if (c.bot) c.bot.orders = null;
  }

  // ============================ KILLS / DAMAGE ============================
  private recordDamage(attacker: Combatant | null, victim: Combatant | null, amount: number) {
    if (!attacker || !victim || attacker === victim || amount <= 0) return;
    if (attacker.team === victim.team) return;
    attacker.damage += amount;
    victim.hurtBy.set(attacker.name, (victim.hurtBy.get(attacker.name) ?? 0) + amount);
  }

  /** Engine → director: the player took `amount` (post-armor) from a bot. */
  playerDamaged(from: TDMBot | null, amount: number) {
    if (from) this.recordDamage(this.byBot(from), this.player, amount);
  }

  private onKill(killer: TDMBot | 'player', victim: TDMBot | 'player', headshot: boolean, weapon: string) {
    const k = killer === 'player' ? this.player : this.byBot(killer);
    const v = victim === 'player' ? this.player : this.byBot(victim);
    this.handleDeath(v, k, headshot, weapon);
  }

  private handleDeath(v: Combatant, k: Combatant | null, headshot: boolean, weapon: string) {
    v.deaths++;
    if (k && k !== v && k.team !== v.team) {
      k.kills++; k.roundKills++;
      if (headshot) k.headshots++;
      const reward = killReward(weapon);
      if (this.phase !== 'over') {
        k.kit.money = clampMoney(k.kit.money + reward);
        if (k === this.player) this.hooks.emit({ type: 'money', amount: reward, reason: `Kill · ${weapon}` });
      }
    }
    // assists: ≥ 41 damage this round without the kill
    for (const [name, dmg] of v.hurtBy) {
      if (dmg < 41 || name === k?.name) continue;
      const a = this.combatants.find(c => c.name === name);
      if (a) a.assists++;
    }
    const vPos = v.bot ? v.bot.pos : this.hooks.playerFeet();
    this.hooks.emit({
      type: 'feed', killer: k ? k.name : 'C4', killerTeam: k ? k.team : v.team === 'alpha' ? 'bravo' : 'alpha',
      weapon, victim: v.name, headshot, zone: siteAt(vPos.x, vPos.z) ? `SITE ${siteAt(vPos.x, vPos.z)}` : '',
    });
    // dying loses the whole kit — armor, guns, utility (money is kept)
    v.kit = { ...freshKit(v.kit.money) };
    if (this.bomb.state === 'carried' && this.bomb.carrier === v) this.dropBomb(vPos.clone());
    if (this.bomb.defuser === v) { this.bomb.defuseT = 0; this.bomb.defuser = null; }
  }

  // ============================ PLAYER ACTIONS ============================
  playerBuy(id: string): BuyCheck {
    if (!this.buyOpen) return { ok: false, reason: 'Buy time is over' };
    const { kit, check } = applyBuy(id, this.player.kit, this.playerSide);
    if (check.ok) this.player.kit = kit;
    return check;
  }

  /** Called when the player dies outside the bot kill path (bomb blast / fall). */
  playerDiedTo(weapon: string) {
    this.handleDeath(this.player, null, false, weapon);
  }

  // ============================ ECONOMY AI ============================
  private botBuy(c: Combatant) {
    const m = this.match;
    const side = m.sideOf(c.team);
    const team = this.combatants.filter(x => x.team === c.team && x.bot);
    const avg = team.reduce((s, x) => s + x.kit.money, 0) / Math.max(1, team.length);
    const buy = (id: string) => { const r = applyBuy(id, c.kit, side); if (r.check.ok) c.kit = r.kit; return r.check.ok; };
    const rifle = side === 'attack' ? 'ak47' : (Math.random() < 0.72 ? 'm4a1' : 'scar_h');
    if (m.suddenDeath) {
      if (!c.kit.primary) { if (!(Math.random() < 0.2 && buy('awm'))) buy(rifle); }
      buy('helmet'); buy('frag'); buy('flash'); if (side === 'defend') buy('kit');
    } else if (m.pistolRound) {
      const r = Math.random();
      if (r < 0.45) buy('kevlar');
      else if (r < 0.75) buy('deagle');
      else { buy('flash'); buy('frag'); }
    } else {
      const lastRound = m.lastRoundOfHalf || m.matchPointFor() !== null;
      const full = avg >= 3600 || c.kit.money >= 4300;
      const force = !full && (avg >= 2000 || lastRound);
      if (c.kit.primary) {
        // survived with a gun: top up armor + utility
      } else if (full) {
        const awper = !team.some(x => x !== c && x.kit.primary === 'awm') && c.kit.money >= 6000 && Math.random() < 0.45;
        if (!(awper && buy('awm'))) buy(rifle);
      } else if (force) {
        const r = Math.random();
        if (r < 0.55) buy('vector'); else if (r < 0.8) buy('spas12'); else buy('mp7');
      } else if (c.kit.money >= 1500 && Math.random() < 0.4) {
        buy('deagle'); // eco pistol
      }
      if (full || force || c.kit.primary) {
        if (c.kit.money >= 1000 + 300) buy('helmet'); else buy('kevlar');
        if (c.kit.money >= 500) buy('frag');
        if (c.kit.money >= 400) buy('flash');
        if (side === 'defend' && c.kit.money >= 400) buy('kit');
      }
    }
    const b = c.bot!;
    b.gun = BOT_GUNS[c.kit.primary ?? c.kit.secondary] ?? BOT_GUNS.m1911;
    b.armor = c.kit.armor;
    b.frags = c.kit.frags;
    b.flashes = c.kit.flashes;
  }

  // ============================ TEAM PLANS ============================
  private planAttack() {
    const attack = this.match.teamOn('attack');
    // Avoid hitting the same site three times running; otherwise a coin flip.
    let site: SiteId = Math.random() < 0.5 ? 'A' : 'B';
    if (this.lastSite && site === this.lastSite && Math.random() < 0.35) site = site === 'A' ? 'B' : 'A';
    this.lastSite = site;
    const r = Math.random();
    const style: AttackStyle = r < 0.4 ? 'execute' : r < 0.65 ? 'split' : r < 0.82 ? 'lurk' : 'rush';
    const bots = this.combatants.filter(c => c.team === attack && c.bot).map(c => c.bot!);
    const roles = new Map<TDMBot, AttackRole>();
    bots.forEach((b, i) => {
      let role: AttackRole = 'yard';
      if (style === 'split') role = i % 2 === 0 ? 'yard' : 'hall';
      else if (style === 'lurk') role = i === bots.length - 1 ? 'lurk' : (i % 3 === 2 ? 'hall' : 'yard');
      else if (style === 'execute') role = i === 1 ? 'hall' : 'yard';
      else role = i % 2 === 0 ? 'yard' : 'hall';
      roles.set(b, role);
    });
    this.plan = { site, style, go: style === 'rush', executeAt: 18 + Math.random() * 22, roles };
  }

  private planDefense() {
    const defend = this.match.teamOn('defend');
    const bots = this.combatants.filter(c => c.team === defend && c.bot).map(c => c.bot!);
    this.defendSlots.clear();
    // 5 bots: 2 A · 2 B · 1 mid. 4 bots (player defends): 2 on one site, 1 other, 1 mid.
    const heavy: SiteId = Math.random() < 0.5 ? 'A' : 'B';
    const light: SiteId = heavy === 'A' ? 'B' : 'A';
    const slots: DefendSlot[] = bots.length >= 5
      ? [{ site: 'A', spot: 0 }, { site: 'B', spot: 0 }, { site: 'A', spot: 1 }, { site: 'B', spot: 1 }, { site: 'mid', spot: 0 }]
      : [{ site: heavy, spot: 0 }, { site: light, spot: 0 }, { site: heavy, spot: 2 }, { site: 'mid', spot: 0 }];
    const shuffled = [...bots].sort(() => Math.random() - 0.5);
    shuffled.forEach((b, i) => this.defendSlots.set(b, slots[i % slots.length]));
  }

  // ============================ PER-FRAME ============================
  update(dt: number) {
    this.prop.update(dt);
    if (this.phase === 'over') return;
    this.playerBusy = false;

    if (this.phase === 'freeze') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'live';
        this.timer = DEFUSE.roundTime;
        this.liveT = 0;
        this.tdm.frozen = false;
        this.hooks.emit({ type: 'freeze-end', side: this.playerSide });
      }
      return;
    }

    if (this.phase === 'post') {
      this.timer -= dt;
      if (this.bomb.state === 'planted') this.tickBomb(dt, false);
      if (this.timer <= 0) {
        if (this.roundOutcome.over) {
          this.phase = 'over';
          if (!this.matchSummarySent) {
            this.matchSummarySent = true;
            this.hooks.matchOver(this.summary());
          }
        } else this.startRound();
      }
      return;
    }

    this.liveT += dt;
    if (this.phase === 'live') this.timer = Math.max(0, this.timer - dt);

    this.updateBombActions(dt);
    if (this.phase === 'planted') this.tickBomb(dt, true);

    this.orderT -= dt;
    if (this.orderT <= 0) {
      this.orderT = 0.25;
      this.gatherIntel();
      this.issueOrders();
    }
    this.checkClutch();
    this.checkWin();
  }

  private tickBomb(dt: number, canEnd: boolean) {
    this.bomb.timeLeft -= dt;
    this.beepT -= dt;
    if (this.beepT <= 0 && this.bomb.timeLeft > 0) {
      this.beepT = beepInterval(this.bomb.timeLeft);
      this.prop.pulse();
      this.hooks.emit({ type: 'beep', pos: this.bomb.pos, urgency: this.bombUrgency });
    }
    if (this.bomb.timeLeft <= 0 && this.bomb.state === 'planted') {
      this.bomb.state = 'exploded';
      this.prop.hide();
      this.hooks.emit({ type: 'bomb', what: 'exploded', site: this.bomb.site ?? undefined });
      this.hooks.explode(this.bomb.pos.clone());
      // blast damage to bots (no kill credit — the bomb takes them)
      for (const c of this.combatants) {
        if (!c.bot || c.bot.dead) continue;
        const d = c.bot.pos.distanceTo(this.bomb.pos);
        if (d > DEFUSE.blastRadius) continue;
        const dmg = DEFUSE.blastDamage * Math.pow(1 - d / DEFUSE.blastRadius, 1.6);
        if (c.bot.takeDamage(dmg, false, c.bot, false)) {
          c.bot.deaths++;
          this.handleDeath(c, null, false, 'C4');
        }
      }
      if (canEnd) this.endRound(this.match.teamOn('attack'), 'bomb');
    }
  }

  /** Plant / defuse / pickup progress for bots and the player. */
  private updateBombActions(dt: number) {
    const b = this.bomb;
    const attackTeam = this.match.teamOn('attack');
    const pf = this.hooks.playerFeet();
    const playerAlive = this.hooks.playerAlive();
    // ---- pickup ----
    this.playerPickupBlockT = Math.max(0, this.playerPickupBlockT - dt);
    if (b.state === 'dropped' && this.phase === 'live') {
      if (attackTeam === 'alpha' && playerAlive && this.playerPickupBlockT <= 0 && Math.hypot(pf.x - b.pos.x, pf.z - b.pos.z) < 1.4) this.giveBomb(this.player);
      else {
        for (const c of this.combatants) {
          if (!c.bot || c.bot.dead || c.team !== attackTeam) continue;
          if (Math.hypot(c.bot.pos.x - b.pos.x, c.bot.pos.z - b.pos.z) < 1.1) { this.giveBomb(c); break; }
        }
      }
    }
    // ---- plant ----
    if (b.state === 'carried' && b.carrier && this.phase === 'live') {
      const c = b.carrier;
      let planting = false;
      let at: THREE.Vector3 | null = null;
      if (c === this.player) {
        const site = siteAt(pf.x, pf.z);
        planting = playerAlive && !!site && this.playerHoldingUse;
        at = pf;
        if (planting) this.playerBusy = true;
      } else if (c.bot && !c.bot.dead) {
        const o = c.bot.orders;
        planting = !!o?.busy && c.bot.state === 'PATROL' && Math.hypot(c.bot.pos.x - o.goal.x, c.bot.pos.z - o.goal.z) < 0.9 && !!siteAt(c.bot.pos.x, c.bot.pos.z);
        at = c.bot.pos;
      }
      if (planting && at) {
        if (b.plantT === 0) this.hooks.emit({ type: 'bomb', what: 'plant-start', by: c.name, byTeam: c.team, site: siteAt(at.x, at.z) ?? undefined });
        b.plantT += dt;
        if (b.plantT >= DEFUSE.plantTime) this.plant(c, at.clone());
      } else b.plantT = 0;
    }
    // ---- defuse ----
    if (b.state === 'planted') {
      let who: Combatant | null = null;
      const defendTeam = attackTeam === 'alpha' ? 'bravo' : 'alpha';
      if (defendTeam === 'alpha' && playerAlive && this.playerHoldingUse && Math.hypot(pf.x - b.pos.x, pf.z - b.pos.z) < 1.8 && Math.abs(pf.y - b.pos.y) < 1.5) {
        who = this.player; this.playerBusy = true;
      } else {
        for (const c of this.combatants) {
          if (!c.bot || c.bot.dead || c.team !== defendTeam) continue;
          const o = c.bot.orders;
          if (o?.busy && c.bot.state === 'PATROL' && Math.hypot(c.bot.pos.x - b.pos.x, c.bot.pos.z - b.pos.z) < 1.4) { who = c; break; }
        }
      }
      if (who) {
        if (b.defuser !== who) { b.defuser = who; b.defuseT = 0; }
        if (this.defuseAnnounced !== who) {
          this.defuseAnnounced = who;
          this.hooks.emit({ type: 'bomb', what: 'defuse-start', by: who.name, byTeam: who.team });
        }
        b.defuseT += dt;
        const need = who.kit.kit ? DEFUSE.kitDefuseTime : DEFUSE.defuseTime;
        if (b.defuseT >= need && b.timeLeft > 0) {
          b.state = 'defused';
          who.defuses++;
          if (who.team === 'alpha') {
            who.kit.money = clampMoney(who.kit.money + DEFUSE_PLAYER_BONUS);
            if (who === this.player) this.hooks.emit({ type: 'money', amount: DEFUSE_PLAYER_BONUS, reason: 'Bomb defused' });
          } else who.kit.money = clampMoney(who.kit.money + DEFUSE_PLAYER_BONUS);
          this.hooks.emit({ type: 'bomb', what: 'defused', by: who.name, byTeam: who.team });
          this.endRound(defendTeam, 'defuse');
        }
      } else if (b.defuser) {
        b.defuseT = 0; b.defuser = null; this.defuseAnnounced = null;
      }
    }
  }

  private plant(c: Combatant, at: THREE.Vector3) {
    const b = this.bomb;
    b.state = 'planted';
    b.carrier = null;
    b.planter = c;
    b.site = siteAt(at.x, at.z);
    b.timeLeft = DEFUSE.bombTime;
    b.defuseT = 0;
    this.beepT = 0;
    this.phase = 'planted';
    b.pos.set(at.x, Math.max(at.y, this.hooks.groundHeight(at.x, at.z)) + 0.01, at.z);
    this.prop.placeAt(b.pos, 'planted', c.bot ? c.bot.yaw : 0);
    c.plants++;
    c.kit.money = clampMoney(c.kit.money + PLANT_PLAYER_BONUS);
    if (c === this.player) this.hooks.emit({ type: 'money', amount: PLANT_PLAYER_BONUS, reason: 'Bomb planted' });
    this.hooks.emit({ type: 'bomb', what: 'planted', site: b.site ?? undefined, by: c.name, byTeam: c.team });
  }

  private checkWin() {
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    const attackTeam = this.match.teamOn('attack');
    const defendTeam: DefuseTeam = attackTeam === 'alpha' ? 'bravo' : 'alpha';
    const att = this.aliveOn(attackTeam).length;
    const def = this.aliveOn(defendTeam).length;
    if (def === 0) { this.endRound(attackTeam, this.phase === 'planted' ? 'bomb' : 'elimination'); return; }
    if (this.phase === 'live') {
      if (att === 0) { this.endRound(defendTeam, 'elimination'); return; }
      if (this.timer <= 0) this.endRound(defendTeam, 'time');
    }
  }

  private checkClutch() {
    if (this.clutchAnnounced || !this.hooks.playerAlive()) return;
    const mine = this.aliveOn('alpha').length;
    const theirs = this.aliveOn('bravo').length;
    if (mine === 1 && theirs >= 2) {
      this.clutchAnnounced = true;
      this.clutchVs = theirs;
      this.hooks.emit({ type: 'clutch', vs: theirs });
    }
  }

  // ============================ INTEL + ORDERS ============================
  private gatherIntel() {
    const defend = this.match.teamOn('defend');
    const decay = 0.25 * 0.35;
    this.intel.A = Math.max(0, this.intel.A - decay);
    this.intel.B = Math.max(0, this.intel.B - decay);
    for (const c of this.combatants) {
      if (!c.bot || c.bot.dead || c.team !== defend) continue;
      const s = c.bot.sighting();
      if (!s) continue;
      for (const site of Object.values(SITES)) {
        const d = Math.hypot(s.pos.x - site.center[0], s.pos.z - site.center[1]);
        if (d < 26) this.intel[site.id] += 1 + (this.bomb.carrier && (s.isPlayer ? this.bomb.carrier === this.player : this.bomb.carrier.bot === s.bot) ? 2 : 0);
      }
    }
    // The player's own team radio: the defenders also rotate on the dropped/planted bomb.
    if (!this.rotateTo) {
      if (this.intel.A >= 2.5 && this.intel.A > this.intel.B) this.rotateTo = 'A';
      else if (this.intel.B >= 2.5 && this.intel.B > this.intel.A) this.rotateTo = 'B';
    }
  }

  private issueOrders() {
    const attack = this.match.teamOn('attack');
    const m = this.plan;
    // ---- the execute trigger ----
    if (!m.go) {
      const staged = [...m.roles.entries()].every(([b, role]) => {
        if (b.dead || role === 'lurk') return true;
        const st = role === 'hall' ? SITES[m.site].stage.hall : SITES[m.site].stage.yard;
        return Math.hypot(b.pos.x - st[0], b.pos.z - st[1]) < 5;
      });
      if (this.liveT >= m.executeAt || (staged && this.liveT > 12) || this.timer < 32) m.go = true;
    }
    let ai = 0, di = 0;
    const dropPicker = this.bomb.state === 'dropped' ? this.nearestBot(attack, this.bomb.pos) : null;
    const defender = this.bomb.state === 'planted' ? this.nearestBot(attack === 'alpha' ? 'bravo' : 'alpha', this.bomb.pos) : null;
    for (const c of this.combatants) {
      if (!c.bot || c.bot.dead) continue;
      c.bot.orders = c.team === attack ? this.attackOrders(c, ai++, dropPicker) : this.defendOrders(c, di++, defender);
    }
  }

  private nearestBot(team: DefuseTeam, p: THREE.Vector3): TDMBot | null {
    let best: TDMBot | null = null, bd = Infinity;
    for (const c of this.combatants) {
      if (!c.bot || c.bot.dead || c.team !== team) continue;
      const d = c.bot.pos.distanceTo(p);
      if (d < bd) { bd = d; best = c.bot; }
    }
    return best;
  }

  private attackOrders(c: Combatant, idx: number, dropPicker: TDMBot | null): BotOrders {
    const bot = c.bot!;
    const plan = this.plan;
    const site = SITES[this.bomb.site ?? plan.site];
    if (this.bomb.state === 'planted' || this.bomb.state === 'exploded' || this.bomb.state === 'defused') {
      const spot = site.postPlant[idx % site.postPlant.length];
      return { goal: v3(spot.at), speed: RUN, look: v3(spot.look) };
    }
    if (this.bomb.state === 'dropped' && bot === dropPicker) return { goal: this.bomb.pos.clone(), speed: RUN };
    const toward = v3(site.center);
    if (this.bomb.carrier === c) {
      if (!plan.go) {
        const st = SITES[plan.site].stage.yard;
        return { goal: v3([st[0], st[1] + 3.5]), speed: RUN, look: toward };
      }
      const spot = site.plantSpots[bot.id % site.plantSpots.length];
      const near = Math.hypot(bot.pos.x - spot[0], bot.pos.z - spot[1]) < 1.2;
      // Late: plant no matter what is shooting at you.
      return { goal: v3(spot), speed: RUN, busy: near, stick: near && this.timer < 9, look: toward };
    }
    const role = plan.roles.get(bot) ?? 'yard';
    if (!plan.go) {
      if (role === 'lurk') return { goal: v3(MID_LURK), speed: WALK, look: v3([0, -14]) };
      const st = role === 'hall' ? site.stage.hall : site.stage.yard;
      const off = (idx % 3 - 1) * 1.8;
      return { goal: v3([st[0] + off, st[1] + (idx % 2) * 1.5]), speed: RUN, look: toward };
    }
    if (role === 'lurk' && this.liveT < plan.executeAt + 12) {
      // the lurker waits a beat for the rotation, then pushes mid to cut it off
      return { goal: v3(MID_HOLD.at), speed: WALK, look: v3([0, -30]) };
    }
    const e = site.entry[idx % site.entry.length];
    return { goal: v3(e), speed: RUN, look: v3([site.center[0], site.center[1] - 10]) };
  }

  private defendOrders(c: Combatant, idx: number, defuser: TDMBot | null): BotOrders {
    const bot = c.bot!;
    const b = this.bomb;
    if (b.state === 'planted') {
      const site = SITES[b.site ?? 'A'];
      const attackersAlive = this.aliveOn(this.match.teamOn('attack')).length;
      if (bot === defuser) {
        const near = Math.hypot(bot.pos.x - b.pos.x, bot.pos.z - b.pos.z) < 1.2;
        const need = c.kit.kit ? DEFUSE.kitDefuseTime : DEFUSE.defuseTime;
        const mustStick = attackersAlive === 0 || b.timeLeft < need + 1.5;
        if (b.timeLeft < need - 0.2 && !near) {
          // no time left to defuse: save the gun
          return { goal: v3(site.retake[idx % site.retake.length]), speed: RUN };
        }
        return { goal: b.pos.clone(), speed: RUN, busy: near, stick: near && mustStick, look: b.pos.clone() };
      }
      // Retake: stage on the retake points and swing in TOGETHER — trickling in
      // one at a time just feeds a stacked post-plant.
      const e = site.entry[idx % site.entry.length];
      const stagePt = site.retake[idx % site.retake.length];
      if (!this.retakeGo(site)) return { goal: v3(stagePt), speed: RUN, look: v3(site.center) };
      return { goal: v3(e), speed: RUN, look: v3(site.center) };
    }
    const slot = this.defendSlots.get(bot) ?? { site: 'mid', spot: 0 };
    // Rotation: mid and the second man on the other site answer the call.
    if (this.rotateTo && slot.site !== this.rotateTo && (slot.site === 'mid' || slot.spot >= 1)) {
      const s = SITES[this.rotateTo];
      const spot = s.defend[(idx + 1) % s.defend.length];
      return { goal: v3(spot.at), speed: RUN, look: v3(spot.look) };
    }
    if (slot.site === 'mid') return { goal: v3(MID_HOLD.at), speed: RUN, look: v3(MID_HOLD.look) };
    const spot = SITES[slot.site].defend[slot.spot % SITES[slot.site].defend.length];
    return { goal: v3(spot.at), speed: RUN, look: v3(spot.look) };
  }

  /** Coordinated retake trigger: go once two defenders are staged (or the clock/numbers force it). */
  private retakeGo(site: BombSite): boolean {
    const defenders = this.aliveOn(this.match.teamOn('defend'));
    const attackers = this.aliveOn(this.match.teamOn('attack')).length;
    if (this.bomb.timeLeft < 22 || attackers <= 1 || defenders.length <= 1) return true;
    let staged = 0;
    for (const c of defenders) {
      const p = c.bot ? c.bot.pos : this.hooks.playerFeet();
      const nearStage = site.retake.some(r => Math.hypot(p.x - r[0], p.z - r[1]) < 7);
      const onSite = Math.hypot(p.x - site.center[0], p.z - site.center[1]) < 12;
      if (nearStage || onSite) staged++;
    }
    return staged >= Math.min(2, defenders.length);
  }

  // ============================ SUMMARY ============================
  summary(): DefuseSummary {
    return {
      alphaScore: this.match.alphaScore, bravoScore: this.match.bravoScore,
      winner: this.match.winner(), history: [...this.match.history], players: this.stats(),
      format: this.match.format.label, rounds: this.match.history.length,
    };
  }

  dispose() {
    this.prop.dispose();
    this.tdm.onKill = undefined;
    this.tdm.onDamage = undefined;
  }
}
