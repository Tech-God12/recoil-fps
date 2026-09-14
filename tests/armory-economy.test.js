import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const catalog = await import('../src/game/economy/catalog.ts');
const stats = await import('../src/game/economy/stats.ts');
const rewards = await import('../src/game/economy/rewards.ts');
const profile = await import('../src/game/economy/profile.ts');
const loadout = await import('../src/game/economy/loadout.ts');
const skins = await import('../src/game/economy/skins.ts');

const { WEAPON_CATALOG, ATTACHMENT_CATALOG, weaponById, attachmentById } = catalog;
const { resolveWeaponStats, STAT_BAR_RANGES, statBarFrac } = stats;
const { REWARDS, gradeFor, gradeBonus, streakBonus, streakAward, difficultyMultiplier } = rewards;

const m4base = () => weaponById('m4a1').base;
const modsOf = (...ids) => ids.map(id => attachmentById(id).mods);

test('catalog ships 10 weapons and 32 attachments', () => {
  assert.equal(WEAPON_CATALOG.length, 10);
  assert.equal(ATTACHMENT_CATALOG.length, 32);
  assert.deepEqual(WEAPON_CATALOG.map(w => w.id).sort(), [
    'ak47', 'awm', 'deagle', 'm1911', 'm249', 'm4a1', 'mp7', 'scar_h', 'spas12', 'vector',
  ]);
});

test('every weapon exposes sockets its slot can actually fill', () => {
  for (const w of WEAPON_CATALOG) {
    assert.ok(w.slots.length >= 4, `${w.id} needs a useful socket set`);
    for (const s of w.slots) assert.ok(catalog.attachmentsFor(w.id, s).length > 0, `${w.id}.${s} has no parts`);
  }
});

test('every attachment observably changes resolved stats or flags', () => {
  for (const part of ATTACHMENT_CATALOG) {
    const weapon = part.compat.map(id => weaponById(id)).find(w => w && w.slots.includes(part.slot));
    assert.ok(weapon, `${part.id} fits nothing it claims`);
    const before = resolveWeaponStats(weapon.base, []);
    const after = resolveWeaponStats(weapon.base, [part.mods]);
    // Whole-block compare: numerics, per-axis spread, sway, flash, flags, reticle.
    assert.notDeepEqual(after, before, `${part.id} is a stat no-op`);
  }
});

test('magAdd applies before magMul (order pinned)', () => {
  assert.equal(resolveWeaponStats(m4base(), [{ magAdd: 15 }, { magMul: 1.5 }]).magSize, 68); // (30+15)*1.5 = 67.5 -> 68
  assert.equal(resolveWeaponStats(m4base(), [{ magMul: 1.5 }, { magAdd: 15 }]).magSize, 68); // mod order is irrelevant
});

test('suppressor quiets the M4 to exactly 19.5 m', () => {
  const s = resolveWeaponStats(m4base(), modsOf('muz_suppressor'));
  assert.equal(s.noiseRadius, 19.5);
  assert.equal(s.suppressed, true);
});

test('reward constants and bonus curves are pinned', () => {
  assert.equal(REWARDS.kill, 100);
  assert.equal(REWARDS.headshot, 150);
  assert.equal(streakBonus(2), 0);
  assert.equal(streakBonus(3), 50);
  assert.equal(streakBonus(4), 100);
  assert.equal(streakBonus(9), 0);
  assert.equal(gradeBonus('S'), 600);
  assert.equal(gradeBonus('A'), 400);
  assert.equal(gradeBonus('B'), 200);
  assert.equal(gradeBonus('C'), 100);
  assert.equal(gradeBonus('D'), 0);
  assert.equal(difficultyMultiplier('Easy'), 0.8);
  assert.equal(difficultyMultiplier('Normal'), 1.0);
  assert.equal(difficultyMultiplier('Hard'), 1.25);
  assert.equal(difficultyMultiplier('Nightmare'), 1.0);
  assert.equal(REWARDS.phase, 200);
  assert.equal(REWARDS.extraction, 750);
});

test('streak awards pay each mark once per chain under a run cap', () => {
  assert.equal(streakAward(2, 0, 500), 0);
  assert.equal(streakAward(3, 0, 500), 50);
  assert.equal(streakAward(3, 3, 500), 0, 'mark 3 already paid this chain');
  assert.equal(streakAward(4, 3, 500), 100);
  assert.equal(streakAward(5, 4, 500), 150);
  assert.equal(streakAward(6, 5, 500), 0, 'no payout past mark 5');
  assert.equal(streakAward(5, 4, 40), 40, 'run cap clamps the award');
  assert.equal(streakAward(5, 4, 0), 0);
});

test('grade thresholds match the results stamp', () => {
  assert.equal(gradeFor({ win: true, kills: 12, shots: 100, hits: 100 }).grade, 'S'); // 60+20+20 = 100
  assert.equal(gradeFor({ win: true, kills: 5, shots: 100, hits: 60 }).grade, 'A'); // 60+10+12 = 82
  assert.equal(gradeFor({ win: true, kills: 0, shots: 100, hits: 50 }).grade, 'B'); // 60+0+10 = 70
  assert.equal(gradeFor({ win: false, kills: 10, shots: 100, hits: 100 }).grade, 'C'); // 0+20+20 = 40
  assert.equal(gradeFor({ win: false, kills: 0, shots: 10, hits: 0 }).grade, 'D'); // 0
  assert.equal(gradeFor({ win: true, kills: 12, shots: 100, hits: 100 }).tint, '#3FD68E');
});

test('competent first run pays ≈ $3,350 and full unlock takes 15–20 runs', () => {
  // 15 kills (3 headshots), two streaks, 3 phases, extraction, B grade, Normal.
  const run = 12 * REWARDS.kill + 3 * REWARDS.headshot
    + streakBonus(3) + streakBonus(4) + 3 * REWARDS.phase + REWARDS.extraction;
  const total = Math.round(run * difficultyMultiplier('Normal')) + gradeBonus('B');
  assert.ok(total >= 3000 && total <= 3700, `run pays $${total}`);
  const catalogValue = WEAPON_CATALOG.reduce((a, w) => a + w.price, 0)
    + ATTACHMENT_CATALOG.reduce((a, x) => a + x.price, 0);
  assert.ok(catalogValue >= 55000 && catalogValue <= 66000, `catalog worth $${catalogValue}`);
  const runs = catalogValue / total;
  assert.ok(runs >= 15 && runs <= 20, `${runs.toFixed(1)} runs to full unlock`);
});

test('stat bar normalisation is pinned', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(STAT_BAR_RANGES).map(([k, r]) => [k, [r.min, r.max, r.invert]])),
    {
      damage: [0, 80, false], rpm: [0, 1200, false], range: [0, 60, false],
      control: [0.4, 2.4, true], handling: [0.08, 0.9, true], noise: [4, 95, true],
      mobility: [0.9, 1.06, false],
    },
  );
  const bare = resolveWeaponStats(m4base(), []);
  assert.equal(statBarFrac('damage', bare), bare.damage / 80);
  const loud = statBarFrac('noise', bare);
  const quiet = statBarFrac('noise', resolveWeaponStats(m4base(), modsOf('muz_suppressor')));
  assert.ok(quiet > loud, 'suppressor raises the (inverted) noise bar');
});

test('buyWeapon rejects unknown, duplicate and unaffordable guns', () => {
  const rich = { ...profile.DEFAULT_PROFILE, cash: 99999 };
  assert.equal(profile.buyWeapon(rich, 'nope').ok, false);
  assert.equal(profile.buyWeapon(rich, 'm4a1').error, 'ALREADY_OWNED');
  assert.equal(profile.buyWeapon(profile.DEFAULT_PROFILE, 'awm').error, 'INSUFFICIENT_FUNDS');
  const bought = profile.buyWeapon(rich, 'awm');
  assert.equal(bought.ok, true);
  assert.equal(bought.value.cash, 99999 - weaponById('awm').price);
  assert.ok(bought.value.builds.awm);
});

test('attachment ownership is per weapon and buying auto-equips', () => {
  const flush = { ...profile.DEFAULT_PROFILE, cash: 99999, ownedWeapons: ['m4a1', 'm1911', 'ak47'] };
  const bought = profile.buyAttachment(flush, 'm4a1', 'mag_extended');
  assert.equal(bought.ok, true);
  const next = bought.value;
  assert.ok(next.ownedAttachments.m4a1.includes('mag_extended'));
  assert.ok(!(next.ownedAttachments.ak47 ?? []).includes('mag_extended'));
  assert.equal(next.builds.m4a1.attachments.magazine, 'mag_extended');
  assert.equal(profile.buyAttachment(next, 'm4a1', 'mag_extended').error, 'ALREADY_OWNED');
  assert.equal(profile.buyAttachment(profile.DEFAULT_PROFILE, 'm4a1', 'mag_extended').error, 'INSUFFICIENT_FUNDS');
});

test('equipAttachment enforces ownership and compatibility', () => {
  const flush = { ...profile.DEFAULT_PROFILE, cash: 99999 };
  assert.equal(profile.equipAttachment(flush, 'm4a1', 'mag_extended', 'magazine').error, 'NOT_OWNED');
  assert.equal(profile.equipAttachment(flush, 'm4a1', 'mag_sr_10', 'magazine').error, 'INCOMPATIBLE');
  const owned = profile.buyAttachment(flush, 'm4a1', 'mag_extended').value;
  const stripped = profile.equipAttachment(owned, 'm4a1', null, 'magazine');
  assert.equal(stripped.ok, true);
  assert.equal(stripped.value.builds.m4a1.attachments.magazine, undefined);
  // The fielded loadout mirrors the saved build.
  assert.equal(stripped.value.loadout.primary.attachments.magazine, undefined);
});

test('class rule: a Deagle can never take the primary slot', () => {
  const flush = { ...profile.DEFAULT_PROFILE, cash: 99999 };
  const withDeagle = profile.buyWeapon(flush, 'deagle').value;
  assert.equal(profile.setLoadoutWeapon(withDeagle, 'primary', 'deagle').error, 'WRONG_SLOT');
  const fielded = profile.setLoadoutWeapon(withDeagle, 'secondary', 'deagle');
  assert.equal(fielded.ok, true);
  assert.equal(fielded.value.loadout.secondary.weapon, 'deagle');
});

test('DEFAULT_LOADOUT is valid for starters and repairLoadout fixes garbage', () => {
  assert.equal(loadout.isValidLoadout(loadout.DEFAULT_LOADOUT, ['m4a1', 'm1911']), true);
  assert.equal(loadout.isValidLoadout(loadout.DEFAULT_LOADOUT, ['m4a1']), false);
  const fixed = loadout.repairLoadout({ primary: { weapon: 'awm' } }, ['m4a1', 'm1911']);
  assert.equal(fixed.primary.weapon, 'm4a1');
  assert.equal(fixed.secondary.weapon, 'm1911');
});

test('grantCash is immutable and never drops below zero', () => {
  const before = { ...profile.DEFAULT_PROFILE, cash: 50 };
  const after = profile.grantCash(before, -9999, 'TEST');
  assert.equal(before.cash, 50);
  assert.equal(after.cash, 0);
  assert.equal(profile.grantCash(before, 100, 'TEST').lifetimeCash, before.lifetimeCash + 100);
});

test('profile survives a save/load round-trip and corrupt data migrates clean', () => {
  const store = new Map();
  const memory = { getItem: k => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } };
  const flush = { ...profile.DEFAULT_PROFILE, cash: 99999 };
  const p = profile.buyAttachment(flush, 'm4a1', 'opt_reddot').value;
  profile.saveProfile(p, memory);
  const back = profile.loadProfile(memory);
  assert.equal(back.builds.m4a1.attachments.optic, 'opt_reddot');
  assert.ok(back.cash < 99999);
  assert.deepEqual(profile.migrateProfile('{{{nope').ownedWeapons, ['m4a1', 'm1911']);
  const dropped = profile.migrateProfile(JSON.stringify({ ownedWeapons: ['m4a1', 'm1911', 'nope'], cash: 5 }));
  assert.deepEqual(dropped.ownedWeapons, ['m4a1', 'm1911']);
});

test('finish picker: set, validate and resolve skins', () => {
  assert.ok(skins.SKIN_CATALOG.length >= 1, 'catalog ships at least the Factory finish');
  assert.equal(skins.DEFAULT_SKIN, 'factory');
  const p = profile.DEFAULT_PROFILE;
  assert.equal(profile.skinFor(p, 'm4a1'), 'factory');
  assert.equal(profile.setWeaponSkin(p, 'm4a1', 'hyper_beast').ok, false);
  assert.equal(profile.setWeaponSkin(p, 'nope', 'factory').ok, false);
  const res = profile.setWeaponSkin(p, 'm4a1', 'factory');
  assert.equal(res.ok, true);
  assert.equal(profile.skinFor(res.value, 'm4a1'), 'factory');
  assert.equal(res.value.loadout.primary.skin, 'factory', 'fielded slot carries the finish to the engine');
  assert.equal(profile.setWeaponSkin(p, 'awm', 'factory').ok, true, 'locked guns can still pick');
});

test('profile migration keeps valid finishes and drops unknown ids', () => {
  const back = profile.migrateProfile(JSON.stringify({
    ownedWeapons: ['m4a1', 'm1911'],
    skins: { m4a1: 'factory', m1911: 'nope', awm: 'factory' },
  }));
  assert.equal(back.skins.m4a1, 'factory');
  assert.equal(back.skins.m1911, undefined);
  assert.equal(back.skins.awm, undefined, 'skins for unowned guns are dropped');
  const repaired = loadout.repairLoadout({
    primary: { weapon: 'm4a1', attachments: {}, skin: 'factory' },
    secondary: { weapon: 'm1911', attachments: {}, skin: 'nope' },
  }, ['m4a1', 'm1911']);
  assert.equal(repaired.primary.skin, 'factory');
  assert.equal(repaired.secondary.skin, undefined);
});

test('catalog uses full real-steel display names with stable ids and shorts', () => {
  const names = {
    m4a1: ['Colt M4A1', 'M4A1'], ak47: ['Kalashnikov AK-47', 'AK-47'],
    m1911: ['Colt M1911', '1911'], awm: ['AI AWM .338', 'AWM'],
    mp7: ['H&K MP7A1', 'MP7'], vector: ['KRISS Vector .45', 'VECTOR'],
    spas12: ['Franchi SPAS-12', 'SPAS-12'], scar_h: ['FN SCAR-H', 'SCAR-H'],
    deagle: ['Desert Eagle .50 AE', 'DEAGLE'], m249: ['FN M249 SAW', 'M249'],
  };
  assert.deepEqual(Object.keys(names).sort(), WEAPON_CATALOG.map(w => w.id).sort());
  for (const w of WEAPON_CATALOG) {
    assert.deepEqual([w.name, w.short], names[w.id], `${w.id} display name drifted`);
  }
});
