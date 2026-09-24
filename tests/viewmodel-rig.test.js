// The viewmodel rig is verified geometrically, no renderer needed: every gun's
// muzzle and sight line are checked against the rig pose in gun-local space
// (gun-local: +Y up, −Z forward; the vmCamera near plane is 0.01, far is 5).
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
const { VIEWMODEL_RIG } = await import('../src/game/engine.ts');
const { WEAPON_BUILDERS } = await import('../src/game/weapons/index.ts');

const RIG = VIEWMODEL_RIG;
const S = RIG.scale;

test('rig reads as a shouldered weapon, not a toy', () => {
  assert.ok(S > 1, `viewmodel scale must exceed 1.0 (got ${S})`);
  assert.ok(RIG.vmFovHip > RIG.vmFovAds, 'ADS must narrow the viewmodel FOV (zoom-in)');
  assert.ok(RIG.vmFovAds >= 50, `ADS FOV ${RIG.vmFovAds} would tunnel the sight picture`);
  assert.ok(RIG.adsDepth > RIG.hip.z, 'ADS pulls the gun slightly toward the eye');
  assert.ok(Math.abs(RIG.adsDepth - RIG.hip.z) <= 0.1, 'ADS travel must not lurch through the camera');
});

for (const [id, build] of Object.entries(WEAPON_BUILDERS)) {
  test(`ADS geometry holds for the ${id}`, () => {
    const model = build();
    assert.ok(model.sightY > 0, `${id}: sightY must be positive or ADS centers the barrel`);
    const adsLift = model.sightY * S;
    assert.ok(adsLift < 0.3, `${id}: ADS lift ${adsLift.toFixed(3)} would shove the gun off-screen`);
    // At full ADS the gun sits at adsDepth; the muzzle must stay ahead of the
    // viewmodel near plane (0.01) and inside the far plane (5).
    const muzzleZ = RIG.adsDepth + model.muzzle.position.z * S;
    assert.ok(muzzleZ < -0.05, `${id}: muzzle at ${muzzleZ.toFixed(3)} clips the ADS camera`);
    assert.ok(muzzleZ > -5, `${id}: muzzle at ${muzzleZ.toFixed(3)} escapes the vm frustum`);
    // At the hip the sight line must sit below screen center so the gun never
    // covers the crosshair while firing unaimed.
    const hipSight = RIG.hip.y + model.sightY * S;
    assert.ok(hipSight < -0.02, `${id}: hip sight line ${hipSight.toFixed(3)} covers the crosshair`);
  });
}
