import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { TDMManager } = await import('../src/game/tdm.ts');
const { AIManager } = await import('../src/game/ai.ts');

// Exercise the audit harness itself, not a mock cleanup function: throw once
// while nine arena bots are live, and again while mission AI is live.
test('headless playtest frees bots and built-world geometry even when a measurement throws', async () => {
  const log = console.log;
  const tdmDispose = TDMManager.prototype.dispose;
  const aiDispose = AIManager.prototype.dispose;
  const geometryDispose = THREE.BufferGeometry.prototype.dispose;
  const originalRandom = Math.random;
  const originalDocument = globalThis.document;
  let tdmFreed = 0, aiFreed = 0, geometriesFreed = 0;
  TDMManager.prototype.dispose = function (...args) { tdmFreed++; return tdmDispose.apply(this, args); };
  AIManager.prototype.dispose = function (...args) { aiFreed++; return aiDispose.apply(this, args); };
  THREE.BufferGeometry.prototype.dispose = function (...args) { geometriesFreed++; return geometryDispose.apply(this, args); };
  try {
    for (const [point, name] of [['SPAWN_STRESS', 'spawn'], ['MISSION_AI_SIM', 'ai']]) {
      let beforeFailure = 0;
      console.log = (kind) => {
        if (kind === point) { beforeFailure = geometriesFreed; throw new Error(`forced ${name} failure`); }
      };
      await assert.rejects(import(`../scripts/audit-play.mjs?cleanup-${name}`), new RegExp(`forced ${name} failure`));
      assert.ok(geometriesFreed > beforeFailure, `${name}: world geometry is disposed in finally`);
      assert.equal(Math.random, originalRandom, `${name}: seeded randomness is restored`);
      assert.equal(globalThis.document, originalDocument, `${name}: the canvas stub is restored`);
    }
    assert.equal(tdmFreed, 2, 'the live TDM manager is freed on early failure and on normal completion');
    assert.equal(aiFreed, 1, 'mission AI is freed when its diagnostic throws');
  } finally {
    console.log = log;
    TDMManager.prototype.dispose = tdmDispose;
    AIManager.prototype.dispose = aiDispose;
    THREE.BufferGeometry.prototype.dispose = geometryDispose;
  }
});
