import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const tests = ['tests/mission.test.js', 'tests/mission-defense.test.js', 'tests/reinforcements.test.js', 'tests/mission-integration.test.js', 'tests/armory-economy.test.js', 'tests/armory-models.test.js'];
function run() {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: root, encoding: 'utf8', timeout: 60000 });
  if (result.error) throw result.error;
  return result;
}

const baseline = run();
if (baseline.status !== 0) {
  console.error(baseline.stdout, baseline.stderr);
  throw new Error('Baseline tests fail. Mutations cannot be credited.');
}

const mission = 'src/game/systems/mission.ts';
const pressure = 'src/game/systems/reinforcements.ts';
const mutations = [
  { name: 'relay never takes hostile damage', file: mission, from: 'this.defense - hostiles * p.drain! * step', to: 'this.defense - 0 * step' },
  { name: 'overrun relay cannot fail', file: mission, from: 'if (this.defense <= 0) { this.fail(); break; }', to: 'if (false) { this.fail(); break; }' },
  { name: 'relay clock secretly requires player inside', file: mission, from: 'this.holdTime += step;', to: 'if (inside) this.holdTime += step;' },
  { name: 'relay drains beyond completion deadline', file: mission, from: 'const step = Math.min(dt, Math.max(0, p.seconds! - this.holdTime));', to: 'const step = dt;' },
  { name: 'advance/extract radius removed', file: mission, from: 'if (inside) this.completePhase();', to: 'this.completePhase();' },
  { name: 'clear threshold bypassed', file: mission, from: 'if ((this.credits.get(p.id)?.size ?? 0) >= p.count!) this.completePhase();', to: 'this.completePhase();' },
  { name: 'kills outside the objective accepted', file: mission, from: 'if (event.zone === p.zone || within(event.at, p.at, p.radius)) credit.add(event.id);', to: 'credit.add(event.id);' },
  { name: 'duplicate victim IDs earn credit twice', file: mission, from: 'if (event.zone === p.zone || within(event.at, p.at, p.radius)) credit.add(event.id);', to: 'if (event.zone === p.zone || within(event.at, p.at, p.radius)) credit.add(event.id + credit.size);' },
  { name: 'clear credit limit removed', file: mission, from: "if (p.type !== 'clear' || !credit || credit.size >= p.count!) continue;", to: "if (p.type !== 'clear' || !credit) continue;" },
  { name: 'charge can be planted through walls', file: mission, from: 'inside && pressed && frame.targetVisible', to: 'inside && pressed' },
  { name: 'attachment loses saved progress behind cover', file: mission, from: 'if (this.attaching && inside && frame.targetVisible)', to: 'if (!inside || !frame.targetVisible) this.plantTime = 0; if (this.attaching && inside && frame.targetVisible)' },
  { name: 'fuse detonates early', file: mission, from: 'this.fuseTime >= p.fuse! ||', to: 'this.fuseTime >= 0 ||' },
  { name: 'hold progresses outside its perimeter', file: mission, from: 'if (inside) this.holdTime = Math.min(p.seconds!, this.holdTime + dt);', to: 'this.holdTime = Math.min(p.seconds!, this.holdTime + dt);' },
  { name: 'pause no longer freezes clocks', file: mission, from: "if (this.status !== 'active' || frame.paused) return;", to: "if (this.status !== 'active') return;" },
  { name: 'mission clock keeps running after extraction', file: mission, from: "if (this.status !== 'active' || frame.paused) return;", to: 'if (frame.paused) return;' },
  { name: 'dead player can advance objectives', file: mission, from: 'if (!frame.alive) { this.fail(); return; }', to: 'if (!frame.alive) { /* deliberately broken */ }' },
  { name: 'start consequences run twice', file: mission, from: "if (this.status !== 'briefing') return;", to: "if (this.status === 'failed') return;" },
  { name: 'insertion proximity gate removed', file: pressure, from: 'minSpawnDistance: 25', to: 'minSpawnDistance: 0' },
  { name: 'visible spawns allowed', file: pressure, from: 'if (actorInView(at, view)) return false;', to: 'if (false && actorInView(at, view)) return false;' },
  { name: 'head LOS gate removed', file: pressure, from: 'if (probes.hasLineOfSight([at[0], at[1] + 1.65, at[2]])) return false;', to: 'if (false) return false;' },
  { name: 'body LOS gate removed', file: pressure, from: 'if (probes.hasLineOfSight([at[0], at[1] + 0.7, at[2]])) return false;', to: 'if (false) return false;' },
  { name: 'director ignores the actual occlusion probe', file: pressure, from: 'return hooks.hasLineOfSight(point);', to: 'return false;' },
  { name: 'blocked spawn space accepted', file: pressure, from: 'if (!probes.isWalkable(at)) return false;', to: 'if (false) return false;' },
  { name: 'live actor limit removed', file: pressure, from: 'liveCap: 10', to: 'liveCap: 30' },
  { name: 'spawn search budget removed', file: pressure, from: 'candidateChecks: 8', to: 'candidateChecks: 64' },
  { name: 'phase pressure policies ignored', file: pressure, from: 'target: Math.min(PRESSURE_BUDGET.liveCap, Math.max(0, policy.target))', to: 'target: 0' },
  { name: 'offscreen actors retired too early', file: pressure, from: 'retireAfter: 20', to: 'retireAfter: 0' },
  { name: 'fixed frame-zero roster restored', file: 'src/game/engine.ts', from: 'this.ai = new AIManager(ctx, [], this.isTDM ? 0 : PRESSURE_BUDGET.liveCap);', to: 'this.ai = new AIManager(ctx, this.world.squadSpawns, PRESSURE_BUDGET.liveCap);' },
  { name: 'AI simulation timers double-count a tick', file: 'src/game/ai.ts', from: 'this.stateTime += dt; this.lastSeenT += dt; this.coverAge += dt;', to: 'this.stateTime += dt * 2; this.lastSeenT += dt; this.coverAge += dt;' },
  { name: 'recycled actors keep old objective credit IDs', file: 'src/game/ai.ts', from: 'this.id = enemyCounter++;', to: 'this.id = this.id;' },
  { name: 'mission marker geometry exceeds budget', file: 'src/game/systems/mission-markers.ts', from: 'new THREE.RingGeometry(0.98, 1, 48)', to: 'new THREE.RingGeometry(0.98, 1, 512)' },
  { name: 'per-kill cash constant drifted', file: 'src/game/economy/rewards.ts', from: '{ kill: 100, headshot:', to: '{ kill: 101, headshot:' },
  { name: 'magazine multiplier applied before flat addition', file: 'src/game/economy/stats.ts', from: 'const magGrown = base.magSize + add(m => m.magAdd);', to: 'const magGrown = base.magSize * mul(m => m.magMul) + add(m => m.magAdd);' },
  { name: 'suppressor quiets 1% less', file: 'src/game/economy/catalog.ts', from: 'mods: { noiseRadiusMul: 0.3, damageMul: 0.92,', to: 'mods: { noiseRadiusMul: 0.31, damageMul: 0.92,' },
];

for (const mutation of mutations) {
  const original = readFileSync(mutation.file, 'utf8');
  if (original.split(mutation.from).length !== 2) throw new Error(`Mutation must match exactly once: ${mutation.name}`);
  let result;
  try {
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    result = run();
  } finally {
    writeFileSync(mutation.file, original);
  }
  if (result.status === 0) throw new Error(`SURVIVED: ${mutation.name}. The test did not detect the defect.`);
  if (!/ERR_ASSERTION|AssertionError/.test(result.stdout + result.stderr)) {
    console.error(result.stdout, result.stderr);
    throw new Error(`Invalid mutation result: ${mutation.name} failed without an assertion.`);
  }
  console.log(`KILLED: ${mutation.name}`);
}

const restored = run();
if (restored.status !== 0) {
  console.error(restored.stdout, restored.stderr);
  throw new Error('Restored sources did not pass.');
}
console.log(`${mutations.length} mutations detected; original sources restored; baseline passed again.`);