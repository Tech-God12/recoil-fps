import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';

const {
  ATMOSPHERES, TIME_OF_DAY, CONDITION_ORDER, CONDITION_LABEL, CONDITION_NOTE,
  AUTO_CONDITION, resolveAtmosphere, visionScale,
} = await import('../src/game/atmosphere.ts');
const { AIManager, PERCEPTION_MAX, ENGAGE_RANGE } = await import('../src/game/ai.ts');
const { DEFAULT_SETTINGS, sanitizeSettings } = await import('../src/game/engine.ts');

const MAPS = ['alrasul', 'kasbah', 'arena', 'sirocco'];

test('every condition is complete, labelled and explained', () => {
  assert.equal(CONDITION_ORDER.length, 7);
  for (const c of CONDITION_ORDER) {
    const p = TIME_OF_DAY[c];
    assert.ok(p, `${c} has no preset`);
    assert.equal(p.sun.length, 3, `${c} sun vector`);
    assert.ok(Math.hypot(...p.sun) > 0.5, `${c} sun vector is degenerate`);
    assert.ok(p.sun[1] > 0, `${c} sun is below the horizon — the shadow map would invert`);
    assert.ok(p.fogFar > p.fogNear, `${c} fog far must exceed near`);
    assert.ok(p.sunIntensity > 0 && p.sunIntensity < 4, `${c} sun intensity out of range`);
    assert.ok(p.exposure > 0.5 && p.exposure < 1.5, `${c} exposure out of range`);
    assert.ok(p.dust >= 0 && p.dust <= 1, `${c} dust out of range`);
    assert.ok(CONDITION_LABEL[c] && CONDITION_LABEL[c].length > 2, `${c} needs a label`);
    assert.ok(CONDITION_NOTE[c] && CONDITION_NOTE[c].length > 20, `${c} needs a note explaining it`);
  }
});

test("'auto' is exactly the map's authored preset, untouched", () => {
  for (const id of MAPS) {
    assert.deepEqual(resolveAtmosphere(id, 'auto'), ATMOSPHERES[id], `${id} auto must not be rewritten`);
    assert.deepEqual(resolveAtmosphere(id), ATMOSPHERES[id], `${id} default arg must be auto`);
  }
});

test('a forced condition changes the sky but keeps the map bouncing its own ground', () => {
  for (const id of MAPS) {
    const base = ATMOSPHERES[id];
    for (const c of CONDITION_ORDER) {
      const r = resolveAtmosphere(id, c);
      // Map identity that must survive: terrain bounce and IBL strength are properties
      // of the ground and the geometry, not of the time of day.
      assert.equal(r.ground, base.ground, `${id}/${c} lost its ground bounce colour`);
      assert.equal(r.hemiGround, base.hemiGround, `${id}/${c} lost its hemisphere ground`);
      assert.equal(r.envIntensity, base.envIntensity, `${id}/${c} lost its IBL strength`);
      // Condition identity that must apply:
      assert.equal(r.fogFar, TIME_OF_DAY[c].fogFar, `${id}/${c} did not take the condition fog`);
      assert.equal(r.sunColor, TIME_OF_DAY[c].sunColor, `${id}/${c} did not take the condition sun`);
    }
  }
});

test('each map declares which condition its authored look actually is', () => {
  for (const id of MAPS) {
    assert.ok(CONDITION_ORDER.includes(AUTO_CONDITION[id]), `${id} has no declared auto condition`);
  }
  // Sanity: the declaration should not be wildly at odds with the authored fog.
  assert.ok(ATMOSPHERES.sirocco.fogFar < ATMOSPHERES.alrasul.fogFar,
    'golden-hour Sirocco should be hazier than high-noon Sandblast');
});

test('visionScale maps the fog far-plane onto a sane multiplier', () => {
  assert.equal(visionScale(340), 1);
  assert.equal(visionScale(1000), 1, 'clear air never grants superhuman sight');
  assert.equal(visionScale(75), 0.35, 'a sandstorm clamps at the floor, not to zero');
  assert.equal(visionScale(0), 0.35, 'degenerate fog still leaves a playable floor');
  assert.ok(Math.abs(visionScale(170) - 0.5) < 1e-9, 'halfway fog is halfway sight');
  // Monotonic across the real presets.
  const sandstorm = visionScale(TIME_OF_DAY.sandstorm.fogFar);
  const noon = visionScale(TIME_OF_DAY.noon.fogFar);
  assert.ok(sandstorm < noon, 'a sandstorm must not see further than noon');
});

test('the setting round-trips through sanitizeSettings and rejects nonsense', () => {
  assert.equal(DEFAULT_SETTINGS.timeOfDay, 'auto');
  for (const c of ['auto', ...CONDITION_ORDER]) {
    assert.equal(sanitizeSettings({ timeOfDay: c }).timeOfDay, c, `${c} should survive sanitising`);
  }
  assert.equal(sanitizeSettings({ timeOfDay: 'blizzard' }).timeOfDay, 'auto');
  assert.equal(sanitizeSettings({ timeOfDay: 7 }).timeOfDay, 'auto');
});

// The whole point of B3. Weather that only the player suffers is scenery.
test('a sandstorm blinds the bots as much as it blinds the player', () => {
  const restore = installCanvasStub();
  try {
    const player = new THREE.Vector3(0, 0, 0);
    const build = (vis) => {
      const ctx = {
        scene: new THREE.Scene(), solids: [], occluders: [], coverNodes: [], half: 100,
        effects: { bloodDecal() {}, enemyMuzzle() {}, tracer() {} },
        difficulty: { reaction: 0.5, accuracy: 0.7, flank: true, aggression: 0.8 },
        playerPos: () => new THREE.Vector3(player.x, 1.62, player.z),
        playerFeet: () => player.clone(), playerAlive: () => true,
        playerVel: () => 0, playerStaticTime: () => 0,
        damagePlayer() {}, moveCollide(p, x, z) { p.x += x; p.z += z; },
        onCallout() {}, aiThrowGrenade() {}, onEnemyFire() {},
        visionScale: () => vis,
      };
      const ai = new AIManager(ctx, []);
      ai.insertSquad({ insertionId: 't', from: 'south', focus: [0, 0, 0], members: [[0, 0, 40], [-3, 0, 41], [3, 0, 41]] });
      const e = ai.enemies[0];
      e.pos.set(0, 0, 40);
      // Face the player so the peripheral cone is not what is being measured.
      e.yaw = Math.PI;
      e.setState('ENGAGE');
      return e;
    };

    // 40 m, clear air, no occluders, looking straight at the player: must acquire.
    assert.equal(build(1).checkLOS(), true, 'clear air at 40 m should see the player');
    // Same geometry, sandstorm multiplier: 70 m ceiling becomes 24.5 m, so 40 m is blind.
    const storm = visionScale(TIME_OF_DAY.sandstorm.fogFar);
    assert.ok(PERCEPTION_MAX * storm < 40, 'test premise: the storm ceiling must fall under 40 m');
    assert.equal(build(storm).checkLOS(), false, 'a sandstorm must break the acquisition');
    // And it recovers when the air clears.
    assert.equal(build(1).checkLOS(), true);
  } finally { restore(); }
});

test('effective rifle range closes with the weather too', () => {
  const restore = installCanvasStub();
  try {
    const mk = (vis) => {
      const ctx = {
        scene: new THREE.Scene(), solids: [], occluders: [], coverNodes: [], half: 100,
        effects: { bloodDecal() {}, enemyMuzzle() {}, tracer() {} },
        difficulty: { reaction: 0.5, accuracy: 0.7, flank: true, aggression: 0.8 },
        playerPos: () => new THREE.Vector3(0, 1.62, 0), playerFeet: () => new THREE.Vector3(),
        playerAlive: () => true, playerVel: () => 0, playerStaticTime: () => 0,
        damagePlayer() {}, moveCollide() {}, onCallout() {}, aiThrowGrenade() {}, onEnemyFire() {},
        ...(vis === null ? {} : { visionScale: () => vis }),
      };
      const ai = new AIManager(ctx, []);
      ai.insertSquad({ insertionId: 't', from: 'south', focus: [0, 0, 0], members: [[0, 0, 8], [-3, 0, 9], [3, 0, 9]] });
      return ai.enemies[0];
    };
    assert.equal(mk(null).engageRange(), ENGAGE_RANGE, 'no hook means clear air');
    assert.equal(mk(1).engageRange(), ENGAGE_RANGE);
    assert.ok(mk(0.35).engageRange() < ENGAGE_RANGE * 0.4,
      'bots must close in before shooting when they cannot see');
  } finally { restore(); }
});
