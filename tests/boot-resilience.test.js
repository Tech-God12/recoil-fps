// The Warehouse deploy hung on "Loading world…" with nothing in the console. Both ways
// that could happen are on the launch path and neither was visible to the headless
// harness: rAF stops firing when a tab is hidden (every stage of Engine.init awaits it),
// and compileAsync only resolves when the GPU reports each program ready (the stub GL
// reports "extension unavailable", so it short-circuits and never polls).
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic imports: the TypeScript loader is registered by the line above, and a static
// import would be resolved before that registration runs.
const { takeRaf, makeCanvas } = await import('../scripts/headless-shim.ts');
const { Engine } = await import('../src/game/engine.ts');
const { DEFAULT_PROFILE } = await import('../src/game/economy/profile.ts');

/** Pump rAF until `p` settles, then stop. */
const pumpUntil = async (p, ms = 60000) => {
  const timer = setInterval(() => { for (const fn of takeRaf()) fn(performance.now()); }, 1);
  try {
    return await Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)),
    ]);
  } finally {
    clearInterval(timer);
  }
};

const bootArena = (opts = {}) => Engine.create(
  makeCanvas(), 'Normal', () => {}, 'arena', DEFAULT_PROFILE.loadout, 1, { mode: 'tdm', ...opts },
);

test('the boot still finishes when the browser stops calling requestAnimationFrame', { timeout: 120000 }, async () => {
  // Nothing pumps the rAF queue here, exactly as in a hidden or occluded tab.
  const engine = await bootArena();
  try {
    assert.equal(engine.bootStage, 'Ready', 'boot reached the final stage');
    assert.ok(engine.tdm, 'Warehouse TDM manager was built');
  } finally {
    engine.dispose();
  }
});

test('a shader precompile that never reports ready cannot own the boot', { timeout: 60000 }, async () => {
  const engine = await pumpUntil(bootArena());
  try {
    // three.js assigns compileAsync on the instance, not the prototype.
    const original = engine.renderer.compileAsync;
    engine.renderer.compileAsync = () => new Promise(() => { /* the GPU never answers */ });
    try {
      const started = Date.now();
      await engine.compileShaders('test scene', engine.scene, engine.camera, 120);
      const waited = Date.now() - started;
      assert.ok(waited >= 110, `waited out the full budget (waited ${waited} ms)`);
      assert.ok(waited < 5000, `gave up instead of hanging forever (waited ${waited} ms)`);
    } finally {
      engine.renderer.compileAsync = original;
    }
  } finally {
    engine.dispose();
  }
});

test('a failing shader precompile falls through instead of rejecting the launch', { timeout: 60000 }, async () => {
  const engine = await pumpUntil(bootArena());
  try {
    const original = engine.renderer.compileAsync;
    engine.renderer.compileAsync = () => Promise.reject(new Error('GL_OUT_OF_MEMORY'));
    try {
      const started = Date.now();
      await engine.compileShaders('test scene', engine.scene, engine.camera, 5000);
      assert.ok(Date.now() - started < 1000, 'a rejected precompile falls through at once');
    } finally {
      engine.renderer.compileAsync = original;
    }
  } finally {
    engine.dispose();
  }
});

test('the boot reports every stage it runs, in order', { timeout: 120000 }, async () => {
  const seen = [];
  const engine = await pumpUntil(bootArena({ onStage: s => seen.push(s) }));
  try {
    for (const stage of ['Starting renderer', 'Building the world', 'Lighting', 'Tactical map',
      'Reflections', 'Weapons', 'Deploying both squads', 'Compiling shaders', 'Ready']) {
      assert.ok(seen.includes(stage), `reported "${stage}" (got: ${seen.join(' → ')})`);
    }
    assert.equal(seen[seen.length - 1], 'Ready', 'Ready is the last stage reported');
  } finally {
    engine.dispose();
  }
});
