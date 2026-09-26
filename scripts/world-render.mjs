/*
 * Deterministic offline map preview. The production project deliberately does not
 * depend on a native WebGL or image package, so this renderer uses the real world
 * builder and writes a lightweight top-down elevation plate from its authored
 * collision/landmark data. It is useful for checking silhouette, lane coverage and
 * spawn safety in CI as well as in a browser.
 *
 * Usage: node scripts/world-render.mjs arena
 *        node scripts/world-render.mjs sirocco -elevation
 */
import { tsImport } from 'tsx/esm/api';
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Small canvas shim: texture generation still runs, but this script never opens a
// window or asks a GPU to render. Returning correctly sized image data matters for
// the procedural bump maps in textures.ts.
const contextHandler = {
  get(target, key) {
    if (key === 'canvas') return target.canvas;
    if (key === 'getImageData') return (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (key === 'measureText') return () => ({ width: 1 });
    if (key in target) return target[key];
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; },
};
function canvas() {
  const c = { width: 0, height: 0, getContext: () => new Proxy({ canvas: c }, contextHandler) };
  return c;
}
globalThis.document = { createElement: tag => tag === 'canvas' ? canvas() : { style: {} } };

const THREE = await tsImport('three', import.meta.url);
const { buildWorld } = await tsImport('../src/game/world.ts', import.meta.url);
const { SIROCCO_OPEN } = await tsImport('../src/game/maps/sirocco.ts', import.meta.url);

const id = process.argv[2] ?? 'arena';
if (!['arena', 'sirocco'].includes(id)) throw new Error(`Unknown map: ${id}`);
const scene = new THREE.Scene();
const world = buildWorld(scene, id, undefined, true);
const W = 1200, H = 1200, pixels = new Uint8Array(W * H * 4);
const put = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4; pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
};
const fill = (r, g, b) => { for (let i = 0; i < pixels.length; i += 4) { pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255; } };
const half = world.half;
const px = x => Math.round((x + half) / (half * 2) * (W - 1));
const py = z => Math.round((half - z) / (half * 2) * (H - 1));
const rect = (x0, z0, x1, z1, colour) => {
  const xa = Math.max(0, Math.min(px(x0), px(x1))), xb = Math.min(W - 1, Math.max(px(x0), px(x1)));
  const ya = Math.max(0, Math.min(py(z0), py(z1))), yb = Math.min(H - 1, Math.max(py(z0), py(z1)));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) put(x, y, ...colour);
};
const line = (x0, y0, x1, y1, colour) => {
  let x = x0, y = y0, dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy;
  for (;;) { put(x, y, ...colour); if (x === x1 && y === y1) break; const e = 2 * err; if (e >= dy) { err += dy; x += sx; } if (e <= dx) { err += dx; y += sy; } }
};
const disk = (cx, cy, radius, colour) => { for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) if (x * x + y * y <= radius * radius) put(cx + x, cy + y, ...colour); };

fill(...(id === 'arena' ? [37, 42, 42] : [83, 64, 45]));
// Authored floor fields provide the same lane vocabulary as the 3D map.
if (id === 'arena') {
  rect(-55, -55, 55, 55, [57, 60, 57]);
  rect(-44, -55, -18, 55, [67, 64, 57]); rect(18, -55, 44, 55, [67, 64, 57]);
  rect(-18, 27, 18, 55, [83, 74, 55]); rect(-18, -55, 18, -27, [83, 74, 55]);
  rect(-18, -11, 18, 11, [71, 70, 66]);
} else {
  for (const area of SIROCCO_OPEN) rect(area.rect.x0, area.rect.z0, area.rect.x1, area.rect.z1, area.floor === 'concrete' ? [80, 84, 82] : area.floor === 'tile' ? [111, 88, 69] : area.floor === 'pavers' ? [139, 119, 88] : [126, 101, 70]);
}
// Draw taller solids first, then a crisp ground-level edge for architecture.
const solids = [...world.solids].sort((a, b) => a.minY - b.minY);
for (const b of solids) {
  const depth = Math.max(0, Math.min(35, b.maxY - b.minY));
  const base = id === 'arena' ? [95, 101, 98] : [178, 157, 118];
  const shade = Math.max(28, Math.round(118 - depth * 5));
  const c = [Math.min(255, base[0] + shade), Math.min(255, base[1] + shade), Math.min(255, base[2] + shade)];
  rect(b.minX, b.minZ, b.maxX, b.maxZ, c);
  line(px(b.minX), py(b.minZ), px(b.maxX), py(b.minZ), [30, 28, 24]);
}
// Cover, authored sightline anchors and glazing are deliberately visible in the plate.
for (const p of world.coverNodes) disk(px(p.x), py(p.z), 4, [211, 139, 47]);
for (const w of world.windows) { const x = px(w.x), y = py(w.z); rect(w.x - 0.18, w.z - 0.18, w.x + 0.18, w.z + 0.18, [88, 145, 154]); if (w.y > 3) put(x, y, 184, 214, 210); }
for (const landmark of world.landmarks) {
  const x = px(landmark.at.x), y = py(landmark.at.z);
  disk(x, y, 7, id === 'arena' ? [55, 190, 184] : [232, 106, 52]);
  line(x - 12, y, x + 12, y, [245, 229, 182]); line(x, y - 12, x, y + 12, [245, 229, 182]);
}
// Spawn and centre markers make this an elevation review rather than a generic map.
disk(px(world.playerSpawn.x), py(world.playerSpawn.z), 9, [67, 207, 188]);
disk(px(0), py(0), 6, [240, 210, 94]);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type), body = Buffer.concat([t, data]);
  const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length); return out;
}
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(pixels.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', (() => { const h = Buffer.alloc(13); h.writeUInt32BE(W, 0); h.writeUInt32BE(H, 4); h[8] = 8; h[9] = 6; return h; })()), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
const out = `docs/screenshots/maps/${id}-elevation.png`;
mkdirSync('docs/screenshots/maps', { recursive: true });
writeFileSync(out, png);
console.log(`${id}: ${out} (${png.length} bytes, ${world.solids.length} solids, ${world.landmarks.length} landmarks)`);
