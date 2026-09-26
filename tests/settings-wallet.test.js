import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { DEFAULT_SETTINGS, sanitizeSettings } = await import('../src/game/engine.ts');
const { DEFAULT_PROFILE, developmentCashGrant, migrateProfile, resetCurrentCash } = await import('../src/game/economy/profile.ts');

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('settings sanitizer clamps numeric ranges, validates choices and restores invalid fields to defaults', () => {
  const settings = sanitizeSettings({
    sensitivity: -20,
    adsSensitivity: Number.POSITIVE_INFINITY,
    invertY: 'yes',
    autoSprint: 'yes',
    autoReload: 1,
    fov: 999,
    difficulty: 'Nightmare',
    map: 'missing-map',
    resolutionScale: 1,
    shadowQuality: 'ultra',
    bloomStrength: -1,
    vignette: 900,
    brightness: 200,
    cameraShake: -2,
    masterVolume: 101,
    effectsVolume: -1,
    footstepVolume: 110,
    ambienceVolume: Number.POSITIVE_INFINITY,
    hudScale: 999,
    colorVision: 'laser-rainbow',
    reducedMotion: 'true',
    voices: 0,
    crosshairColor: 'url(javascript:alert(1))',
    crosshairSize: 0,
    crosshairGap: 100,
    crosshairThickness: -3,
    showFps: true,
    unrecognizedSetting: 'must not survive',
  });

  assert.equal(settings.sensitivity, 0.5);
  assert.equal(settings.adsSensitivity, DEFAULT_SETTINGS.adsSensitivity);
  assert.equal(settings.invertY, DEFAULT_SETTINGS.invertY);
  assert.equal(settings.autoSprint, DEFAULT_SETTINGS.autoSprint);
  assert.equal(settings.autoReload, DEFAULT_SETTINGS.autoReload);
  assert.equal(settings.fov, 120);
  assert.equal(settings.difficulty, DEFAULT_SETTINGS.difficulty);
  assert.equal(settings.map, DEFAULT_SETTINGS.map);
  assert.equal(settings.resolutionScale, 50);
  assert.equal(settings.shadowQuality, DEFAULT_SETTINGS.shadowQuality);
  assert.equal(settings.bloomStrength, 0);
  assert.equal(settings.vignette, 70);
  assert.equal(settings.brightness, 170);
  assert.equal(settings.cameraShake, 0);
  assert.equal(settings.masterVolume, 100);
  assert.equal(settings.effectsVolume, 0);
  assert.equal(settings.footstepVolume, 100);
  assert.equal(settings.ambienceVolume, DEFAULT_SETTINGS.ambienceVolume);
  assert.equal(settings.hudScale, 125);
  assert.equal(settings.colorVision, DEFAULT_SETTINGS.colorVision);
  assert.equal(settings.reducedMotion, DEFAULT_SETTINGS.reducedMotion);
  assert.equal(settings.voices, DEFAULT_SETTINGS.voices);
  assert.equal(settings.crosshairColor, DEFAULT_SETTINGS.crosshairColor);
  assert.equal(settings.crosshairSize, 3);
  assert.equal(settings.crosshairGap, 26);
  assert.equal(settings.crosshairThickness, 1);
  assert.equal(settings.showFps, true);
  assert.equal(settings.autoReload, DEFAULT_SETTINGS.autoReload);
  assert.equal(settings.crouchToggle, DEFAULT_SETTINGS.crouchToggle);
  assert.equal(settings.reducedMotion, DEFAULT_SETTINGS.reducedMotion);
  assert.equal(settings.compactHud, DEFAULT_SETTINGS.compactHud);
  assert.equal(settings.highContrastHud, DEFAULT_SETTINGS.highContrastHud);
  assert.equal('unrecognizedSetting' in settings, false);
});

test('settings sanitizer accepts a valid JSON save and safely handles malformed or non-object input', () => {
  const settings = sanitizeSettings('{"sensitivity":2.25,"difficulty":"Hard","map":"kasbah","crosshairColor":"#12aBcD","voices":false,"autoSprint":true,"autoReload":false,"effectsVolume":64,"footstepVolume":72,"ambienceVolume":48,"hudScale":115,"colorVision":"deuteranopia","reducedMotion":true}');
  assert.equal(settings.sensitivity, 2.25);
  assert.equal(settings.difficulty, 'Hard');
  assert.equal(settings.map, 'kasbah');
  assert.equal(settings.crosshairColor, '#12aBcD');
  assert.equal(settings.autoSprint, true);
  assert.equal(settings.autoReload, false);
  assert.equal(settings.effectsVolume, 64);
  assert.equal(settings.footstepVolume, 72);
  assert.equal(settings.ambienceVolume, 48);
  assert.equal(settings.hudScale, 115);
  assert.equal(settings.colorVision, 'deuteranopia');
  assert.equal(settings.reducedMotion, true);
  assert.equal(settings.voices, false);
  assert.deepEqual(sanitizeSettings('{broken'), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings([1, 2, 3]), DEFAULT_SETTINGS);
});

test('normal startup preserves saved wallets and the optional hash grant is development-only', () => {
  assert.equal(DEFAULT_PROFILE.cash, 0);
  assert.equal(developmentCashGrant('#cash=50000', false), 0);
  assert.equal(developmentCashGrant('#cash=50000', true), 50000);
  assert.equal(developmentCashGrant('#cash=999999999999999999', true), 999999);
  assert.equal(developmentCashGrant(`#cash=${'9'.repeat(400)}`, true), 999999);
  assert.equal(developmentCashGrant('#cash=nope', true), 0);
  assert.equal(developmentCashGrant('#cash=50000', true), 50000);

  const existing = migrateProfile({ ...DEFAULT_PROFILE, cash: 9_999_999, lifetimeCash: 10_000_123 });
  assert.equal(existing.cash, 9_999_999, 'existing balances are preserved, not topped up or wiped');
  assert.equal(existing.lifetimeCash, 10_000_123);
  assert.doesNotMatch(appSource, /DEV_WALLET|loadRichProfile/);
  assert.match(appSource, /useState<PlayerProfile>\(loadProfile\)/);
  assert.match(appSource, /developmentCashGrant\(window\.location\.hash, import\.meta\.env\.DEV\)/);
});

test('opt-in legacy balance reset changes current cash only and preserves purchases and lifetime earnings', () => {
  const profile = migrateProfile({
    ...DEFAULT_PROFILE, cash: 9_999_999, lifetimeCash: 10_000_123,
    ownedWeapons: ['m4a1', 'm1911', 'ak47'],
  });
  const reset = resetCurrentCash(profile);
  assert.equal(profile.cash, 9_999_999, 'reset is immutable until explicitly applied');
  assert.equal(reset.cash, 0);
  assert.equal(reset.lifetimeCash, 10_000_123);
  assert.deepEqual(reset.ownedWeapons, profile.ownedWeapons);
  assert.ok(appSource.includes("window.confirm('Set current cash to $0?"));
  assert.ok(appSource.includes('updateProfile(resetCurrentCash(profileRef.current))'));
  assert.match(appSource, /profile\.cash >= LEGACY_WALLET_NOTICE_THRESHOLD/);
  assert.match(appSource, /showLegacyWalletNotice && phase === 'menu'/);
});

test('saved settings and UI patches are both routed through the sanitizer', () => {
  assert.match(appSource, /sanitizeSettings\(localStorage\.getItem\(SETTINGS_KEY\)\)/);
  assert.match(appSource, /sanitizeSettings\(\{ \.\.\.previous, \.\.\.patch \}\)/);
});


test('quality-of-life accessibility preferences are persisted as strict booleans', () => {
  const enabled = sanitizeSettings({
    autoReload: false, autoSprint: true, crouchToggle: false,
    reducedMotion: true, compactHud: true, highContrastHud: true,
  });
  assert.deepEqual(
    [enabled.autoReload, enabled.autoSprint, enabled.crouchToggle, enabled.reducedMotion, enabled.compactHud, enabled.highContrastHud],
    [false, true, false, true, true, true],
  );
  const invalid = sanitizeSettings({ autoReload: 'no', autoSprint: 1, crouchToggle: null, reducedMotion: 'yes', compactHud: [], highContrastHud: {} });
  assert.deepEqual(
    [invalid.autoReload, invalid.autoSprint, invalid.crouchToggle, invalid.reducedMotion, invalid.compactHud, invalid.highContrastHud],
    [DEFAULT_SETTINGS.autoReload, DEFAULT_SETTINGS.autoSprint, DEFAULT_SETTINGS.crouchToggle, DEFAULT_SETTINGS.reducedMotion, DEFAULT_SETTINGS.compactHud, DEFAULT_SETTINGS.highContrastHud],
  );
});
