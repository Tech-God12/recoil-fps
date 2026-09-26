import '../tests/helpers/register-json.js';

/* Headless PERFORMANCE probe. Boots the real Engine on every map against the stub
 * WebGL2 context from headless-shim.ts and measures what the CPU/driver side of a
 * frame costs: draw calls, triangles, shadow-pass calls, scene-graph size, JS time
 * per frame split into sim/render, worst-frame spikes, and hud() poll cost.
 * GPU fill cost is NOT measurable here — draw calls, triangle counts and shadow
 * re-render frequency are the proxies. NOT part of the app.
 *   node --import ./tests/helpers/register-json.js scripts/perf-probe.ts [frames=600] [json-out] */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { takeRaf, makeCanvas } from './headless-shim.ts';
import { writeFileSync } from 'node:fs';

async function main() {
  const frames = Number(process.argv[2] ?? 600);
  const out = process.argv[3];
  let seed = 4242;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  // Re-seeded per map (below) so each map's numbers are independent of run order.
  const THREE = await import('three');
  const { Engine, DEFAULT_SETTINGS } = await import('../src/game/engine');
  const { DEFAULT_PROFILE, buildForWeapon } = await import('../src/game/economy/profile');
  const builds = Object.fromEntries(DEFAULT_PROFILE.ownedWeapons.map((id: any) => [id, buildForWeapon(DEFAULT_PROFILE, id)]));
  const results: Record<string, any> = {};
  const maps = (process.argv[4]?.split(',') ?? ['alrasul', 'kasbah', 'arena', 'sirocco']) as ('alrasul' | 'kasbah' | 'arena' | 'sirocco')[];
  for (const map of maps) {
    seed = 4242;
    const canvas = makeCanvas();
    const pump = setInterval(() => { for (const fn of takeRaf()) fn(performance.now()); }, 1);
    const t0 = performance.now();
    const opts: any = map === 'sirocco' ? { side: 'attack', format: 'short', builds } : {};
    const engine: any = await Engine.create(canvas, 'Normal', () => {}, map, DEFAULT_PROFILE.loadout, 1, opts);
    clearInterval(pump);
    const boot = performance.now() - t0;
    engine.applySettings(DEFAULT_SETTINGS);
    engine.start();
    (globalThis as any).document.pointerLockElement = canvas;
    engine.setPaused(false);
    const r = engine.renderer as any;
    r.info.autoReset = false;
    // Split sim vs render time by wrapping the private methods.
    let simMs = 0, renderMs = 0;
    const upd = engine.update.bind(engine), ren = engine.render.bind(engine);
    engine.update = (dt: number) => { const a = performance.now(); upd(dt); simMs += performance.now() - a; };
    engine.render = () => { const a = performance.now(); ren(); renderMs += performance.now() - a; };
    let now = performance.now();
    const calls: number[] = [], tris: number[] = [], frameMs: number[] = [];
    // Warm-up (shader "compile", first shadow render) excluded from stats.
    for (let i = 0; i < 30; i++) { now += 1000 / 60; for (const fn of takeRaf()) fn(now); }
    simMs = 0; renderMs = 0;
    for (let i = 0; i < frames; i++) {
      now += 1000 / 60;
      r.info.reset();
      const a = performance.now();
      for (const fn of takeRaf()) fn(now);
      frameMs.push(performance.now() - a);
      calls.push(r.info.render.calls); tris.push(r.info.render.triangles);
    }
    let hudMs = 0; const hudN = 200;
    { const a = performance.now(); for (let i = 0; i < hudN; i++) engine.hud(); hudMs = (performance.now() - a) / hudN; }
    let meshes = 0, visible = 0, shadowCasters = 0, lights = 0; const mats = new Set<any>();
    engine.scene.traverse((o: any) => {
      if (o.isLight) lights++;
      if (o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine) { meshes++; if (o.visible) visible++; if (o.castShadow) shadowCasters++; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => mats.add(m)); }
    });
    const sorted = [...frameMs].sort((x, y) => x - y);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const res = {
      bootMs: Math.round(boot),
      callsMedian: [...calls].sort((x, y) => x - y)[calls.length >> 1], callsMax: Math.max(...calls),
      trisMedian: [...tris].sort((x, y) => x - y)[tris.length >> 1], trisMax: Math.max(...tris),
      frameMsMean: +(frameMs.reduce((s, v) => s + v, 0) / frames).toFixed(3), frameMsP50: +pct(0.5).toFixed(3), frameMsP99: +pct(0.99).toFixed(3), frameMsMax: +sorted[sorted.length - 1].toFixed(3),
      simMsMean: +(simMs / frames).toFixed(3), renderMsMean: +(renderMs / frames).toFixed(3), hudMs: +hudMs.toFixed(3),
      meshes, visible, shadowCasters, materials: mats.size, lights, programs: r.info.programs?.length ?? 0,
      geometries: r.info.memory.geometries, textures: r.info.memory.textures,
    };
    results[map] = res;
    console.log(map.padEnd(8), JSON.stringify(res));
    engine.dispose();
    void THREE;
  }
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
