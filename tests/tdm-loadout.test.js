// Recoil FPS — the Warehouse TDM loadout screen.
//
// This file mostly asserts what must NOT render. When a change is "remove this", a test
// that asserts the absence is the only thing that stops it drifting back in: the armor
// picker, the enemy squad panel, the rules wall and the second Play button were all
// removed by explicit request, and every one of them is the kind of thing a later pass
// re-adds "for completeness".
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installCanvasStub } from './helpers/geometry.js';

installCanvasStub();
const inert = new Proxy(function () {}, {
  get(_t, p) {
    if (p === 'currentTime') return 0;
    if (p === 'state') return 'running';
    if (p === 'sampleRate') return 44100;
    if (p === 'getChannelData') return () => new Float32Array(64);
    if (p === 'then') return undefined;
    if (p === Symbol.toPrimitive) return () => 0;
    return inert;
  },
  apply() { return inert; }, construct() { return inert; }, set() { return true; },
});
globalThis.window = globalThis;
globalThis.AudioContext = inert;

const { default: TdmSetup } = await import('../src/ui/TdmSetup.tsx');
const { DEFAULT_PROFILE } = await import('../src/game/economy/profile.ts');

const noop = () => {};
const render = (profile = DEFAULT_PROFILE) => renderToStaticMarkup(
  React.createElement(TdmSetup, { profile, onProfile: noop, onBack: noop, kit: 'mine', onKits: noop }),
);

test('the TDM loadout screen carries one idea: five things were removed and must stay removed', () => {
  const html = render();

  // 1. The armor picker. Every combatant fields the same standard plating now, so the
  //    three-way radio, the HP figures and the damage-reduction percentages all go.
  assert.doesNotMatch(html, /Choose armor/, 'no armor radiogroup');
  assert.doesNotMatch(html, /tdm2-armor/, 'no armor rows');
  assert.doesNotMatch(html, />ARMOR</, 'no ARMOR section heading');
  assert.doesNotMatch(html, /HEAVY|LIGHT ARMOR/, 'no armor tiers');

  // 2. The enemy squad panel. It existed only to preview armor; with no armor choice it
  //    says nothing actionable.
  assert.doesNotMatch(html, /BRAVO SQUAD/, 'no enemy roster');
  assert.doesNotMatch(html, /tdm2-enemy/, 'no enemy rows');
  assert.doesNotMatch(html, /HEAVIER TARGETS/, 'and not its hint either');

  // 3. The rules wall. The match teaches all of it in thirty seconds.
  assert.doesNotMatch(html, /LOADOUT RULES/, 'no rules box');
  assert.doesNotMatch(html, /tx-rulebox/);
  assert.doesNotMatch(html, /3 frags \+ 1 flash/);

  // 4. The whole footer, including the SECOND Play button. You arrive from Arena Mode and
  //    you go back there to play, so Play belongs there, once.
  assert.doesNotMatch(html, /tdm2-foot/, 'no footer');
  assert.doesNotMatch(html, /OrangeDeploy|tx-deploy/, 'no deploy button');
  assert.doesNotMatch(html, />PLAY</, 'no Play button anywhere on this screen');

  // 5. The primary/sidearm tabs that used to be buried below the 3-D viewer.
  assert.doesNotMatch(html, /tdm2-tabs/, 'no slot tabs');
});

test('what replaced them: loadout slot cards, the ability card, THIS BUILD, and where Play went', () => {
  const html = render();

  // Left column is the loadout itself — both slots as cards you can click onto the bench.
  assert.match(html, />YOUR LOADOUT</);
  assert.equal((html.match(/tdm2-slot"/g) ?? []).length + (html.match(/tdm2-slot on"/g) ?? []).length, 2,
    'exactly two weapon slots');
  assert.match(html, /ON THE BENCH/, 'the active one is flagged');
  assert.match(html, /PRIMARY|ASSAULT RIFLE|SIDEARM|PISTOL/i, 'each card states its class');

  // The ability card, under its own heading.
  assert.match(html, />ABILITY</);
  assert.match(html, /ONE PER MATCH/);
  assert.match(html, /abil-tall/, 'the tall ability card');
  assert.match(html, /Change ability/);

  // THIS BUILD took the rules box's place, and the trait chips moved off the centre stage
  // where they had been squeezing the 3-D viewer into a third of the width.
  assert.match(html, />THIS BUILD</);
  assert.match(html, /tdm2-build-tag/, 'trait chips');
  assert.doesNotMatch(html, /tdm2-desc/, 'and are no longer on the stage');

  // Removing a Play button without saying where Play went is how you confuse a player.
  assert.match(html, /Changes save as you make them/);
  assert.match(html, /Go back to Arena Mode to start the match/);
});

test('an operator with no ability equipped still gets a readable card', () => {
  const html = renderToStaticMarkup(
    React.createElement(TdmSetup, { profile: DEFAULT_PROFILE, onProfile: noop, onBack: noop, kit: null, onKits: noop }),
  );
  assert.match(html, /NOTHING SELECTED/);
  assert.match(html, /Choose an ability/);
  assert.doesNotMatch(html, /PRESS/, 'no key prompt when there is no key to press');
});
