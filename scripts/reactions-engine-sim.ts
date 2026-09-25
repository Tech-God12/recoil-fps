/* Headless ENGINE simulation for impact & death reactions. Boots the real Engine
 * (stub WebGL, headless-shim.ts) on a mission map and the Warehouse TDM, kills live
 * soldiers from different directions through the engine's own hook wiring, steps
 * frames, and checks: varied variants, bodies settled on the floor, rifles dropped
 * and later reclaimed, thud/clatter hooks fired, no exceptions, and that disposing
 * the engine leaves no dropped rifle orphaned. NOT part of the app.
 *   node --import ./tests/helpers/register-json.js scripts/reactions-engine-sim.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { takeRaf, makeCanvas } from './headless-shim';

async function main() {
  const THREE = await import('three');
  const { Engine, DEFAULT_SETTINGS } = await import('../src/game/engine');
  const { DEFAULT_PROFILE } = await import('../src/game/economy/profile');
  const expect = (c: boolean, m: string) => { if (!c) throw new Error('EXPECTATION FAILED: ' + m); console.log('  ✓ ' + m); };
  let fails = 0;
  for (const map of ['alrasul', 'arena'] as const) {
    console.log(`== ${map}`);
    const pump = setInterval(() => { for (const fn of takeRaf()) fn(performance.now()); }, 1);
    const e: any = await Engine.create(makeCanvas(), 'Normal', () => {}, map, DEFAULT_PROFILE.loadout, 1, {});
    clearInterval(pump);
    e.applySettings(DEFAULT_SETTINGS); e.start(); (globalThis as any).document.pointerLockElement = {}; e.setPaused(false);
    let now = performance.now();
    const step = (sec: number) => { for (let i = 0; i < Math.round(sec * 60); i++) { now += 1000 / 60; for (const fn of takeRaf()) fn(now); } };
    step(0.5);
    let thuds = 0, clatters = 0;
    const victims: any[] = map === 'arena' ? e.tdm.bots.filter((b: any) => b.team === 'bravo' && !b.dead).slice(0, 5) : e.ai.enemies.filter((x: any) => !x.dead).slice(0, 5);
    // Count the engine-wired hooks (they forward to spatial audio, distance-gated).
    const hctx = victims[0].ctx; const of = hctx.onBodyFall, ow = hctx.onWeaponDrop;
    if (!of || !ow) throw new Error('engine did not wire death audio hooks into the AI context');
    hctx.onBodyFall = (a: any, h: boolean) => { thuds++; of(a, h); }; hctx.onWeaponDrop = (a: any) => { clatters++; ow(a); };
    // Shooter placed relative to each victim's facing: front, front(head), side, front(leg), blast.
    const { forwardOf } = await import('../src/game/reactions');
    victims.forEach((v, i) => {
      const f = forwardOf(v.model.group.rotation.y);
      const side = new THREE.Vector3(-f.z, 0, f.x);
      const off = i === 2 ? side.multiplyScalar(12) : f.clone().multiplyScalar(i === 4 ? 2 : 12);
      v.noteHit({ from: new THREE.Vector3(v.pos.x + off.x, v.pos.y + 1.6, v.pos.z + off.z), zone: i === 1 ? 'head' : i === 3 ? 'limb' : 'torso', explosive: i === 4 });
      const killed = map === 'arena' ? v.takeDamage(9999, i === 1, 'player', false) : v.takeDamage(9999, i === 1);
      expect(killed, `${v.name} killed`);
    });
    step(2.2);
    const variants = victims.map(v => v.reactions.variant);
    console.log('  variants:', variants.join(', '));
    expect(new Set(variants).size === victims.length, `${victims.length} kills, ${victims.length} different death animations`);
    expect(victims.every(v => v.reactions.isSettled), 'all bodies settled within 2.2 s');
    expect(thuds === victims.length, `one body-fall thud per kill (${thuds})`);
    expect(clatters === victims.length, `one rifle clatter per kill (${clatters})`);
    for (const v of victims) {
      const head = v.model.parts.head.getWorldPosition(new THREE.Vector3());
      const floor = v.pos.y;
      if (!(head.y < floor + 1.05)) { fails++; console.log(`  ✗ ${v.name} head too high ${head.y - floor}`); }
    }
    expect(fails === 0, 'every head is at lying/sitting height');
    const dropped = victims.map(v => v.reactions.droppedRifle).filter(Boolean);
    expect(dropped.length === victims.length && dropped.every((r: any) => r.parent === e.scene), 'rifles are on the floor in the world scene');
    if (map === 'arena') {
      step(5); // TDM respawn
      expect(victims.every(v => !v.dead), 'all victims respawned');
      expect(victims.every(v => v.model.parts.rifle.parent?.parent === v.model.group && v.reactions.variant === null), 'rifles back in hands after respawn');
    }
    const orphan = dropped.filter((r: any) => r.parent === e.scene);
    e.dispose();
    expect(orphan.every((r: any) => r.parent !== e.scene), 'dispose reclaims every dropped rifle');
  }
  console.log('REACTIONS ENGINE SIM PASSED');
}
main().then(() => process.exit(0), err => { console.error(err); process.exit(1); });
