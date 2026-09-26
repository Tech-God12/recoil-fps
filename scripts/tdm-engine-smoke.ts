/* Headless ENGINE smoke test for Warehouse 5v5 TDM. Boots the real Engine on the
 * arena map against the stub WebGL2 context from headless-shim.ts, then drives
 * frames and input the way a browser would: movement, firing, grenades, the field
 * ability, a scripted duel, player death → respawn, and the match clock through to
 * the end-of-match scoreboard. Catches runtime exceptions in the engine glue
 * without a browser. NOT part of the app.
 *   node --import ./tests/helpers/register-json.js scripts/tdm-engine-smoke.ts [seconds=200] */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { takeRaf, makeCanvas, listeners } from './headless-shim';

let failures = 0, checks = 0;
const expect = (cond: boolean, msg: string) => { checks++; console.log(`  ${cond ? '✓' : '✗ FAIL'} ${msg}`); if (!cond) failures++; };

async function main() {
  const seconds = Number(process.argv[2] ?? 200);
  let seed = 4242;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const THREE = await import('three');
  const { Engine, DEFAULT_SETTINGS } = await import('../src/game/engine');
  const { DEFAULT_PROFILE } = await import('../src/game/economy/profile');
  const { ABILITY_IDS } = await import('../src/game/abilities');

  const events: Record<string, number> = {};
  let ended: any = null;
  const canvas = makeCanvas();
  const pump = setInterval(() => { for (const fn of takeRaf()) fn(performance.now()); }, 1);
  const t0 = performance.now();
  const engine: any = await Engine.create(canvas, 'Normal', (e: any) => {
    events[e.type] = (events[e.type] ?? 0) + 1;
    if (e.type === 'end') ended = e;
  }, 'arena', DEFAULT_PROFILE.loadout, 1, { mode: 'tdm', ability: ABILITY_IDS[0] ?? null });
  clearInterval(pump);
  console.log(`ENGINE UP in ${(performance.now() - t0).toFixed(0)} ms — isTDM=${engine.isTDM} bots=${engine.tdm?.bots?.length ?? 'NO TDM MANAGER'}`);
  engine.applySettings(DEFAULT_SETTINGS);
  engine.start();
  (globalThis as any).document.pointerLockElement = canvas;
  engine.setPaused(false);

  const key = (type: 'keydown' | 'keyup', code: string) => { for (const fn of listeners.get(type) ?? []) fn({ code, repeat: false, preventDefault() {} }); };
  const mouse = (type: 'mousedown' | 'mouseup', button = 0) => { for (const fn of listeners.get(type) ?? []) fn({ button, preventDefault() {} }); };
  const tap = (code: string) => { key('keydown', code); key('keyup', code); };
  let now = performance.now();
  const step = (sec: number) => { for (let i = 0; i < Math.round(sec * 30); i++) { now += 1000 / 30; for (const fn of takeRaf()) fn(now); } };
  const hud = () => engine.hud();
  const log = (label: string) => {
    const h = hud(); const t = h.tdm;
    console.log(`${label.padEnd(22)} ${t ? `${t.alphaScore}:${t.bravoScore} clock=${t.timeLeft.toFixed(0).padStart(3)} you=${t.playerKills}k` : 'NO TDM HUD'} hp=${h.hp} w=${h.weapon} ${h.ability ? `ability=${h.ability.id} ${Math.round(h.ability.pct * 100)}%` : 'ability=none'} dead=${h.tdm?.playerDead ?? '-'}`);
  };

  expect(engine.isTDM === true, 'arena launches as Warehouse TDM');
  expect(!!engine.tdm && engine.tdm.bots.length === 9, `TDM manager owns both five-man teams (${engine.tdm?.bots?.length} bots + you)`);
  expect(!!hud().tdm, 'HUD exposes the TDM scoreboard');
  expect(hud().tdm.timeLeft === 150, 'match starts on the 2:30 clock');

  // ---- spawn: on the map, out of geometry, and walkable in every direction ----
  const spawn = engine.pos.clone();
  const stuckInSolid = engine.world.solids.some((b: any) =>
    spawn.x > b.minX - 0.4 && spawn.x < b.maxX + 0.4 && spawn.z > b.minZ - 0.4 && spawn.z < b.maxZ + 0.4 && b.maxY > 0.5 && b.minY < 1.8);
  expect(!stuckInSolid, `alpha spawn ${spawn.x.toFixed(0)},${spawn.z.toFixed(0)} is not inside a solid`);
  for (const dir of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    engine.pos.copy(spawn); engine.vel.set(0, 0, 0);
    key('keydown', dir); step(2); key('keyup', dir);
    expect(engine.pos.distanceTo(spawn) > 3, `the player can walk ${dir} out of the spawn`);
  }
  engine.pos.copy(spawn); engine.vel.set(0, 0, 0);
  log('boot');

  // ---- a scripted duel: the player's own bullets must kill a hostile ----
  {
    const bravo = engine.tdm.bots.find((b: any) => b.team === 'bravo' && !b.dead)!;
    expect(!!bravo, 'a living bravo bot exists');
    // Freeze the duel: nobody else shoots or respawns, the clock stops and the
    // player is invulnerable, so only the player's own trigger can act.
    const realDamage = engine.damagePlayerTDM.bind(engine);
    engine.damagePlayerTDM = () => {};
    for (const b of engine.tdm.bots) { b.updateFire = () => {}; b.updateLogic = () => {}; }
    const realUpdate = engine.tdm.update.bind(engine.tdm);
    engine.tdm.update = (dt: number) => { realUpdate(dt); engine.tdm.timeLeft = 150; };
    // Sweep the yaw until a clear sight line exists, then park the bot on it.
    const ray = new THREE.Raycaster();
    let placed = false;
    for (let deg = 0; deg < 360 && !placed; deg += 5) {
      engine.yaw = (deg * Math.PI) / 180;
      step(0.05);
      const dir = engine.camera.getWorldDirection(new THREE.Vector3());
      ray.set(engine.camera.position, dir); ray.far = 40;
      const first = ray.intersectObjects(engine.hittables, false)[0];
      if (first && first.distance <= 30) continue;
      const spot = engine.camera.position.clone().addScaledVector(dir, 12); spot.y = 0;
      bravo.pos.copy(spot);
      bravo.model.group.position.copy(spot);
      step(0.1);
      ray.set(engine.camera.position, engine.camera.getWorldDirection(new THREE.Vector3())); ray.far = 40;
      const chk = ray.intersectObjects(engine.hittables, false)[0];
      if (chk?.object.userData.tdmBot === bravo) placed = true;
    }
    expect(placed, 'a clear 12 m sight line to a bravo bot exists from the spawn');
    const hpBefore = bravo.hp, killsBefore = hud().tdm.playerKills, hitsBefore = engine.hits;
    for (let burst = 0; burst < 10 && !bravo.dead; burst++) { mouse('mousedown'); step(0.9); mouse('mouseup'); step(0.3); }
    step(0.5);
    expect(engine.hits > hitsBefore, 'player shots register hits on the bot');
    expect(bravo.dead === true, `the player killed the bravo bot (${hpBefore.toFixed(0)} → ${bravo.hp.toFixed(0)} HP)`);
    expect(hud().tdm.playerKills === killsBefore + 1, 'the player kill counter increments');
    expect(hud().tdm.alphaScore === killsBefore + 1, `alpha score follows the kill (${hud().tdm.alphaScore}:${hud().tdm.bravoScore})`);
    engine.damagePlayerTDM = realDamage;
    engine.tdm.update = realUpdate;
    log('after duel');
  }

  // ---- movement, weapons, grenades and the field ability ----
  key('keydown', 'KeyW'); step(1.2); key('keyup', 'KeyW');
  mouse('mousedown'); step(0.6); mouse('mouseup');
  tap('KeyR'); step(2.2);
  tap('Digit2'); step(0.3); tap('Digit1'); step(0.3);
  key('keydown', 'KeyG'); step(0.6); key('keyup', 'KeyG'); step(2);
  tap('KeyF'); step(1.5);
  // Abilities deploy half-charged, so wait out the recharge before spending one.
  for (let i = 0; i < 60 && !hud().ability.ready; i++) step(1);
  expect(hud().ability.ready, 'the field ability finishes recharging');
  const usesBefore = engine.abilities.uses;
  tap('KeyZ'); step(3);
  expect(engine.abilities.uses === usesBefore + 1, 'Z deploys the field ability');
  expect(hud().ability.cooldownLeft > 0 && hud().ability.pct < 1, `using it starts the cooldown (${hud().ability.cooldownLeft.toFixed(0)} s left)`);
  expect(!!events.abilityfx, 'the deployment fires a screen-space ability effect');
  log('after actions');

  // ---- player death → redeploy ----
  engine.hp = 1;
  engine.damagePlayerTDM(999, new THREE.Vector3(0, 1, 0), null);
  step(0.4);
  expect(hud().tdm.playerDead === true, 'player death registers');
  step(6);
  expect(hud().tdm.playerDead === false, 'the player redeploys after the 5 s respawn');
  expect(hud().hp === hud().tdm.maxHp, 'the redeploy is at full HP');
  log('respawned');

  // ---- let the bots play the match out to the final whistle ----
  for (let t = 0; t < seconds && !ended; t += 5) {
    step(5);
    if (t % 20 === 0) { key('keydown', 'KeyW'); step(1.2); key('keyup', 'KeyW'); mouse('mousedown'); step(0.5); mouse('mouseup'); }
  }
  log('final');
  console.log('events:', JSON.stringify(events));
  expect(!!ended, `the 2:30 match reaches its end (${hud().tdm.timeLeft.toFixed(0)} s left)`);
  if (ended) {
    expect(ended.tdm.roster.length === 10, `the debrief carries both squads (${ended.tdm.roster.length} rows)`);
    expect(['win', 'loss', 'draw'].includes(ended.tdm.outcome), `outcome is decided (${ended.tdm.outcome})`);
    console.log(`MATCH END → win=${ended.win} kills=${ended.kills} score ${ended.tdm.alphaScore}:${ended.tdm.bravoScore} outcome=${ended.tdm.outcome}`);
  }
  engine.dispose();
  console.log(failures === 0 ? `TDM ENGINE SMOKE PASSED — ${checks}/${checks} checks` : `${failures} of ${checks} TDM ENGINE CHECKS FAILED`);
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error('TDM ENGINE SMOKE FAIL:', e); process.exit(1); });
