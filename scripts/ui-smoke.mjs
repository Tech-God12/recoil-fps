/* Headless UI smoke: drives the real built bundle in jsdom through the Warehouse
 * (arena TDM) flows a player can take, and fails on any console/uncaught error.
 *   node scripts/ui-smoke.mjs [dist-uitest/index.html]
 * Build first:  npx vite build --config vite.uitest.config.ts && node scripts/move-uitest-script.mjs
 * NOT part of the app. */
import { boot } from './ui-harness.mjs';

const FILE = process.argv[2] ?? 'dist-uitest/index.html';
let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; console.log(`  ${cond ? '✓' : '✗ FAIL'} ${msg}`); if (!cond) failures++; };

async function toArenaMenu(ui) {
  await ui.sleep(700);
  if (!ui.document.querySelector('.arena2-root')) { await ui.click('ARENA MODE'); await ui.sleep(400); }
  await ui.click('WAREHOUSE');
  await ui.sleep(300);
}

async function main() {
  /* ================= 1. Warehouse via the loadout screen ================= */
  {
    console.log('\n===== 1. ARENA MODE → WAREHOUSE → "Set up loadout" =====');
    const ui = boot(FILE);
    await ui.sleep(800);
    check(ui.has('MISSIONS'), 'home menu rendered');
    await toArenaMenu(ui);
    check(ui.has('TEAM DEATHMATCH') && ui.document.querySelector('.map2-title')?.textContent === 'WAREHOUSE', 'Warehouse card selected');
    const before = ui.errors.length;
    await ui.click('Set up loadout');
    await ui.sleep(1500);
    check(ui.errors.length === before, `loadout screen rendered with no errors (${ui.errors.length - before} new)`);
    check(ui.has('PREPARE FOR DEPLOYMENT') || ui.has('BRAVO SQUAD'), 'TDM loadout screen is on screen');
    check(ui.has('ARMOR'), 'armor picker present');
    console.log('  screen:', ui.screenText().slice(0, 260));
    for (const e of ui.errors.slice(before, before + 3)) console.log('  ERR:', e);
    // armor change + weapon pick must not throw
    const b2 = ui.errors.length;
    await ui.click('HEAVY', { optional: true });
    await ui.sleep(300);
    check(ui.errors.length === b2, 'switching armor is clean');
    // now deploy from the loadout screen
    const b3 = ui.errors.length;
    await ui.click('PLAY', { optional: true });
    const w = await ui.waitBoot();
    check(w.gone, `match launched from the loadout screen (boot cleared after ${w.ms} ms)`);
    check(!!ui.document.querySelector('.tdm-scoreboard'), 'TDM scoreboard is live');
    check(ui.errors.length === b3, `no errors during launch (${ui.errors.length - b3} new)`);
    console.log('  HUD:', ui.screenText().slice(0, 220));
    for (const e of ui.errors.slice(b3, b3 + 3)) console.log('  ERR:', e);
    ui.window.close();
  }

  /* ================= 2. Warehouse straight from the card ================= */
  {
    console.log('\n===== 2. ARENA MODE → WAREHOUSE → Play (and let the match run) =====');
    const ui = boot(FILE);
    await ui.sleep(800);
    await toArenaMenu(ui);
    const before = ui.errors.length;
    await ui.click('Play');
    const w = await ui.waitBoot();
    check(w.gone, `boot cleared after ${w.ms} ms`);
    check(ui.errors.length === before, `launch produced no errors (${ui.errors.length - before} new)`);
    const clockAt = () => ui.document.querySelector('.tdm-score-clock b')?.textContent ?? 'none';
    const t0 = clockAt();
    await ui.sleep(6000);
    const t1 = clockAt();
    check(t0 !== t1, `match clock is running (${t0} → ${t1})`);
    const score0 = ui.document.querySelector('.tdm-score-team.alpha .num')?.textContent;
    await ui.sleep(20000);
    const score1 = ui.document.querySelector('.tdm-score-team.alpha .num')?.textContent;
    const bravo1 = ui.document.querySelector('.tdm-score-team.bravo .num')?.textContent;
    console.log(`  score after ~26 s of live play: ALPHA ${score0} → ${score1}, BRAVO ${bravo1}, clock ${clockAt()}`);
    check(ui.errors.length === before, `no errors during 26 s of play (${ui.errors.length - before} new)`);
    for (const e of ui.errors.slice(before, before + 3)) console.log('  ERR:', e);
    ui.window.close();
  }

  /* ================= 3. Abilities menu (the other thing on the home screen) ================= */
  {
    console.log('\n===== 3. ABILITIES menu =====');
    const ui = boot(FILE);
    await ui.sleep(800);
    const before = ui.errors.length;
    await ui.click('ABILITIES');
    await ui.sleep(1500);
    check(ui.errors.length === before, `ABILITIES screen rendered with no errors (${ui.errors.length - before} new)`);
    check(ui.has('One ability per game'), 'the abilities screen explains itself');
    check(!/\bKits?\b/.test(ui.screenText()), 'no leftover "kit" wording on the abilities screen');
    console.log('  screen:', ui.screenText().slice(0, 260));
    for (const e of ui.errors.slice(before, before + 3)) console.log('  ERR:', e);
    ui.window.close();
  }

  /* ================= 4. A whole Warehouse match, through to the debrief ================= */
  {
    console.log('\n===== 4. Full 2:30 Warehouse match → results screen =====');
    const ui = boot(FILE);
    await ui.sleep(800);
    await toArenaMenu(ui);
    await ui.click('Play');
    const w = await ui.waitBoot();
    check(w.gone, 'match started');
    const before = ui.errors.length;
    const clockAt = () => ui.document.querySelector('.tdm-score-clock b')?.textContent ?? 'none';
    for (let t = 0; t < 45; t++) {
      await ui.sleep(5000);
      if (ui.document.querySelector('.results-root')) break;
    }
    check(!!ui.document.querySelector('.results-root'), `results screen appeared (clock last read ${clockAt()})`);
    check(ui.errors.length === before, `no errors across the whole match (${ui.errors.length - before} new)`);
    console.log('  debrief:', ui.screenText().slice(0, 300));
    for (const e of ui.errors.slice(before, before + 3)) console.log('  ERR:', e);
    ui.window.close();
  }

  console.log(`\n${failures === 0 ? `ALL UI CHECKS PASSED — ${checks}/${checks}` : `${failures} of ${checks} UI CHECKS FAILED`}`);
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error('UI SMOKE FAIL:', e.message); process.exit(1); });
