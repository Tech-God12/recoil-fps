// Recoil FPS — Procedural PBR material library.
//
// 2026-09-26 rebuild. What changed and why:
//  * bumpMap → normalMap. bumpMap makes the fragment shader take screen-space
//    derivatives of a height texture every pixel; it is both slower and mushier
//    than a real tangent-space normal map. Heights are now Sobel-differentiated
//    once at build time into a proper normal texture.
//  * Every surface gains a roughnessMap. A single scalar roughness is the number
//    one reason procedural materials read as "plastic": real stone has polished
//    wear lanes, damp mortar and dry grit all in one surface.
//  * Detail/mesoscale breakup: large-scale value noise is composited into the
//    diffuse so 20 m of wall no longer reads as one tiling swatch.
//  * A quality knob scales every canvas so a 16 GB laptop can drop texture memory
//    without touching the art.
import * as THREE from 'three';

export interface TextureSet {
  signage?: THREE.MeshStandardMaterial;
  stoneBlock?: THREE.MeshStandardMaterial;
  firedBrick?: THREE.MeshStandardMaterial;
  packedEarth?: THREE.MeshStandardMaterial;
  corrugatedMetal?: THREE.MeshStandardMaterial;
  roughTimber?: THREE.MeshStandardMaterial;
  terracePavers?: THREE.MeshStandardMaterial;
  cobbleLane?: THREE.MeshStandardMaterial;
  wadiBed?: THREE.MeshStandardMaterial;
  dirtPath?: THREE.MeshStandardMaterial;

  sand: THREE.MeshStandardMaterial;
  plaza: THREE.MeshStandardMaterial;
  adobeWall: THREE.MeshStandardMaterial;
  adobeWall2: THREE.MeshStandardMaterial;
  adobeBrick: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  rustedMetal: THREE.MeshStandardMaterial;
  sandbag: THREE.MeshStandardMaterial;
  tileFloor: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  whitewash: THREE.MeshStandardMaterial;
}

/** 1 = full 1024² hero textures, 0.5 = 512², 0.25 = 256². Set before getMaterials(). */
let quality = 1;
export function setTextureQuality(q: number) {
  const next = Math.min(1, Math.max(0.25, q));
  if (next !== quality) { disposeMaterials(); quality = next; }
}
export function getTextureQuality() { return quality; }
const res = (base: number) => Math.max(64, Math.round(base * quality / 64) * 64);

function cv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, rx: number, ry: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  // 4x is the sweet spot: almost all of the grazing-angle sharpness of 8x for
  // roughly half the sampling cost, which matters on integrated GPUs.
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Safely read pixels; the headless shim returns a 1×1 stub, so callers must cope. */
function readPixels(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8ClampedArray | null {
  try {
    const img = ctx.getImageData(0, 0, w, h);
    if (!img || !img.data || img.data.length < w * h * 4) return null;
    return img.data;
  } catch { return null; }
}

/**
 * Sobel-differentiate a greyscale height canvas into a tangent-space normal map.
 * `strength` is in height units per texel; higher = deeper relief.
 */
function normalFromHeight(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = height.width, h = height.height;
  const [out, octx] = cv(w, h);
  const src = readPixels(height.getContext('2d')!, w, h);
  if (!src) {
    // Flat normal (128,128,255) — correct, neutral fallback under stub canvases.
    octx.fillStyle = '#8080ff'; octx.fillRect(0, 0, w, h);
    return out;
  }
  const dst = new Uint8ClampedArray(w * h * 4);
  const at = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 3×3 Sobel — smoother and less aliased than a 2-tap difference.
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
               - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
               - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      dst[i] = (nx * 0.5 + 0.5) * 255;
      dst[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst[i + 2] = (nz * 0.5 + 0.5) * 255;
      dst[i + 3] = 255;
    }
  }
  try { octx.putImageData(new ImageData(dst, w, h), 0, 0); } catch { /* stub canvas */ }
  return out;
}

/**
 * Build a roughness map. `base` is the mid roughness; the height channel modulates
 * it by ±`spread` (raised areas polish, recesses stay matte when `polishPeaks`).
 */
function roughnessFromHeight(height: HTMLCanvasElement, base: number, spread: number, polishPeaks = true): HTMLCanvasElement {
  const w = height.width, h = height.height;
  const [out, octx] = cv(w, h);
  const src = readPixels(height.getContext('2d')!, w, h);
  const mid = Math.round(Math.min(1, Math.max(0, base)) * 255);
  if (!src) {
    octx.fillStyle = `rgb(${mid},${mid},${mid})`; octx.fillRect(0, 0, w, h);
    return out;
  }
  const dst = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const hv = src[i * 4] / 255 - 0.5;
    const v = Math.min(1, Math.max(0, base + (polishPeaks ? -hv : hv) * spread * 2));
    const b = v * 255;
    dst[i * 4] = b; dst[i * 4 + 1] = b; dst[i * 4 + 2] = b; dst[i * 4 + 3] = 255;
  }
  try { octx.putImageData(new ImageData(dst, w, h), 0, 0); } catch { /* stub canvas */ }
  return out;
}

interface MatOpts {
  /** Mid roughness; a roughnessMap modulates around it. */
  rough: number;
  metal?: number;
  /** Normal-map depth. 1 ≈ strong masonry relief, 0.3 ≈ fine plaster. */
  relief?: number;
  /** ± roughness variation baked into the roughnessMap. */
  roughSpread?: number;
  polishPeaks?: boolean;
  envIntensity?: number;
  side?: THREE.Side;
  color?: number;
}

function mat(diffuse: HTMLCanvasElement, height: HTMLCanvasElement, rx: number, ry: number, o: MatOpts): THREE.MeshStandardMaterial {
  const relief = o.relief ?? 0.8;
  const normal = normalFromHeight(height, relief * 5.5);
  const roughCanvas = roughnessFromHeight(height, o.rough, o.roughSpread ?? 0.16, o.polishPeaks ?? true);
  const nTex = tex(normal, rx, ry, false);
  const rTex = tex(roughCanvas, rx, ry, false);
  const m = new THREE.MeshStandardMaterial({
    map: tex(diffuse, rx, ry),
    normalMap: nTex,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap: rTex,
    roughness: 1,
    metalness: o.metal ?? 0,
    envMapIntensity: o.envIntensity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.color !== undefined) m.color.setHex(o.color);
  return m;
}

// value noise → soft cloudy variation (for baked AO / grime / color drift)
function valueNoise(ctx: CanvasRenderingContext2D, w: number, h: number, cells: number, alpha: number, dark = true) {
  const grid: number[][] = [];
  for (let y = 0; y <= cells; y++) { grid[y] = []; for (let x = 0; x <= cells; x++) grid[y][x] = Math.random(); }
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  if (d.length < w * h * 4) return; // stub canvas
  const lerp = (a: number, b: number, t: number) => a + (b - a) * (t * t * (3 - 2 * t));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * cells, gy = (y / h) * cells;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = gx - x0, ty = gy - y0;
      const top = lerp(grid[y0][x0], grid[y0][x0 + 1], tx);
      const bot = lerp(grid[y0 + 1][x0], grid[y0 + 1][x0 + 1], tx);
      let v = lerp(top, bot, ty);
      v = dark ? -(1 - v) : (v - 0.5);
      const i = (y * w + x) * 4;
      const shade = v * alpha * 255;
      d[i] += shade; d[i + 1] += shade; d[i + 2] += shade;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Multi-octave mottling drawn with soft radial blobs — cheap, and unlike
 *  valueNoise it survives the stub canvas (no getImageData round-trip). */
function mottle(ctx: CanvasRenderingContext2D, S: number, count: number, radius: number, colors: string[]) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = radius * (0.5 + Math.random());
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = colors[(Math.random() * colors.length) | 0];
    g.addColorStop(0, col);
    g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, cols: [string, number][], sMin = 1, sMax = 3) {
  for (let i = 0; i < n; i++) {
    const [c, a] = cols[(Math.random() * cols.length) | 0];
    ctx.globalAlpha = a; ctx.fillStyle = c;
    const s = sMin + Math.random() * (sMax - sMin);
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

function cracks(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, col: string, lw = 1.2) {
  ctx.strokeStyle = col; ctx.lineWidth = lw;
  for (let i = 0; i < n; i++) {
    let x = Math.random() * w, y = Math.random() * h;
    ctx.beginPath(); ctx.moveTo(x, y);
    const seg = 3 + (Math.random() * 5) | 0;
    for (let s = 0; s < seg; s++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.5) * 70; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

// chips the painted lines so they read as worn, not freshly painted
function noiseWear(ctx: CanvasRenderingContext2D, S: number) {
  for (let i = 0; i < 2600; i++) { ctx.fillStyle = 'rgba(68,64,58,0.7)'; ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, 1 + Math.random() * 3); }
}

const cached: Partial<TextureSet> = {};

/** Free every GPU texture this module owns (quality switch / engine teardown). */
export function disposeMaterials() {
  for (const key of Object.keys(cached) as (keyof TextureSet)[]) {
    const m = cached[key];
    if (!m) continue;
    m.map?.dispose(); m.normalMap?.dispose(); m.roughnessMap?.dispose();
    m.dispose();
    delete cached[key];
  }
}

function ctxHorizontalBands(c: CanvasRenderingContext2D, S: number) {
  c.strokeStyle = 'rgba(70,55,38,0.12)';
  c.lineWidth = Math.max(1, S / 340);
  for (let y = S / 16; y < S; y += S / 10.6) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke();
  }
}

export function getMaterials(): TextureSet {
  if (cached.sand) return cached as TextureSet;

  // ---------- SAND: wind ripples, grit, pebbles, wide dune shading ----------
  {
    const S = res(1024);
    const [d, c] = cv(S, S);
    const k = S / 1024;
    c.fillStyle = '#C6A86F'; c.fillRect(0, 0, S, S);
    valueNoise(c, S, S, 5, 0.18);
    // broad dune shading so a 22× tiled ground does not read as one swatch
    mottle(c, S, 26, S * 0.28, ['rgba(214,190,146,0.22)', 'rgba(150,120,74,0.18)', 'rgba(232,212,171,0.16)']);
    for (let y = -80 * k; y < S + 80 * k; y += 22 * k) {
      c.beginPath();
      for (let x = 0; x <= S; x += 6 * k) { const yy = y + Math.sin(x * 0.014 / k + y * 0.3 / k) * 7 * k + Math.sin(x * 0.041 / k) * 2.5 * k; x === 0 ? c.moveTo(x, yy) : c.lineTo(x, yy); }
      c.lineWidth = 9 * k; c.strokeStyle = 'rgba(140,110,66,0.18)'; c.stroke();
      c.lineWidth = 3 * k; c.strokeStyle = 'rgba(245,228,186,0.26)'; c.stroke();
    }
    speckle(c, S, S, Math.round(26000 * quality), [['#F0DEB4', 0.32], ['#96763F', 0.36], ['#B8965A', 0.28]], 1, 2 * k);
    for (let i = 0; i < Math.round(260 * quality); i++) {
      const x = Math.random() * S, y = Math.random() * S, r = (1.5 + Math.random() * 3) * k;
      c.fillStyle = Math.random() > 0.5 ? '#8E7A58' : '#A89370';
      c.beginPath(); c.ellipse(x, y, r, r * 0.7, Math.random() * 3, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, 7); c.fill();
    }
    const HS = res(512), hk = HS / 1024;
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#808080'; bc.fillRect(0, 0, HS, HS);
    for (let y = -80 * hk; y < HS + 80 * hk; y += 22 * hk) {
      bc.beginPath();
      for (let x = 0; x <= HS; x += 6 * hk) { const yy = y + Math.sin(x * 0.014 / hk + y * 0.3 / hk) * 7 * hk + Math.sin(x * 0.041 / hk) * 2.5 * hk; x === 0 ? bc.moveTo(x, yy) : bc.lineTo(x, yy); }
      bc.lineWidth = 9 * hk; bc.strokeStyle = 'rgba(60,60,60,0.45)'; bc.stroke();
      bc.lineWidth = 3 * hk; bc.strokeStyle = 'rgba(210,210,210,0.6)'; bc.stroke();
    }
    speckle(bc, HS, HS, Math.round(9000 * quality), [['#b8b8b8', 0.5], ['#505050', 0.5]], 1, 2);
    cached.sand = mat(d, b, 22, 22, { rough: 0.95, relief: 0.55, roughSpread: 0.06, envIntensity: 0.85 });
  }

  // ---------- PLAZA STONE: irregular flagstones, worn edges, grit in joints ----------
  {
    const S = res(1024), k = S / 1024;
    const [d, c] = cv(S, S);
    c.fillStyle = '#8B8069'; c.fillRect(0, 0, S, S);
    const n = 6, s = S / n;
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      const v = 164 + (Math.random() * 34) | 0;
      const inset = (4 + Math.random() * 3) * k;
      const x = gx * s + inset, y = gy * s + inset, w = s - inset * 2, h = s - inset * 2;
      c.fillStyle = `rgb(${v},${(v * 0.91) | 0},${(v * 0.75) | 0})`;
      c.fillRect(x, y, w, h);
      c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
      speckle(c, S, S, Math.round(280 * quality), [['#000000', 0.06], ['#ffffff', 0.07]], 1, 3 * k);
      mottle(c, S, 3, s * 0.4, ['rgba(120,104,78,0.10)', 'rgba(228,220,200,0.09)']);
      for (let j = 0; j < 3; j++) { const vx = x + Math.random() * w, vy = y + Math.random() * h; c.strokeStyle = 'rgba(80,70,50,0.16)'; c.lineWidth = 1.5 * k; c.beginPath(); c.moveTo(vx, vy); c.lineTo(vx + (Math.random() - 0.5) * 60 * k, vy + (Math.random() - 0.5) * 60 * k); c.stroke(); }
      c.restore();
      c.fillStyle = 'rgba(255,255,255,0.13)'; c.fillRect(x, y, w, 3 * k); c.fillRect(x, y, 3 * k, h);
      c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(x, y + h - 4 * k, w, 4 * k); c.fillRect(x + w - 4 * k, y, 4 * k, h);
    }
    cracks(c, S, S, 8, 'rgba(60,52,40,0.36)', 1.6 * k);
    valueNoise(c, S, S, 5, 0.12);
    const HS = res(512), hk = HS / 1024, hs = HS / n;
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#5c5c5c'; bc.fillRect(0, 0, HS, HS);
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      bc.fillStyle = '#cccccc'; bc.fillRect(gx * hs + 6 * hk, gy * hs + 6 * hk, hs - 12 * hk, hs - 12 * hk);
    }
    speckle(bc, HS, HS, Math.round(5000 * quality), [['#e8e8e8', 0.35], ['#a0a0a0', 0.35]], 1, 2);
    cached.plaza = mat(d, b, 8, 8, { rough: 0.74, relief: 1.05, roughSpread: 0.22, envIntensity: 1.0 });
  }

  // ---------- ADOBE PLASTER: troweled stucco with damp bases and sun bleaching ----------
  const makeAdobe = (base: string, tone = 0, repeatScale = 3) => {
    const S = res(512), k = S / 512;
    const [d, c] = cv(S, S);
    c.fillStyle = base; c.fillRect(0, 0, S, S);
    speckle(c, S, S, Math.round(12000 * quality), [['#000000', 0.03], ['#ffffff', 0.04], ['#8a6d48', 0.022]], 1, 2 * k);
    valueNoise(c, S, S, 4, 0.055);
    // Troweled sweeps: faint arcs left by the plasterer's float.
    for (let i = 0; i < 26; i++) {
      const cx2 = Math.random() * S, cy2 = Math.random() * S, r = (60 + Math.random() * 90) * k;
      c.strokeStyle = `rgba(255,255,255,${0.018 + Math.random() * 0.02})`;
      c.lineWidth = (5 + Math.random() * 12) * k;
      c.beginPath(); c.arc(cx2, cy2, r, Math.random() * 6, Math.random() * 6); c.stroke();
    }
    mottle(c, S, 10 + tone * 2, S * 0.22, ['rgba(96,78,54,0.07)', 'rgba(240,230,208,0.08)']);
    ctxHorizontalBands(c, S);
    const HS = res(256);
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#808080'; bc.fillRect(0, 0, HS, HS);
    speckle(bc, HS, HS, Math.round(8000 * quality), [['#a4a4a4', 0.35], ['#5c5c5c', 0.35]], 1, 2);
    for (let i = 0; i < 18; i++) {
      bc.strokeStyle = 'rgba(190,190,190,0.25)'; bc.lineWidth = 4;
      bc.beginPath(); bc.arc(Math.random() * HS, Math.random() * HS, 30 + Math.random() * 50, 0, 6); bc.stroke();
    }
    return mat(d, b, repeatScale, repeatScale, { rough: 0.91, relief: 0.42, roughSpread: 0.1, envIntensity: 0.9 });
  };
  cached.adobeWall = makeAdobe('#C2A87C', 0, 3);
  cached.adobeWall2 = makeAdobe('#B4956C', 1, 3);
  cached.plaster = makeAdobe('#CEBA98', 2, 2.5);
  cached.whitewash = makeAdobe('#DCD3BE', 3, 2.5);

  // ---------- ADOBE BRICK ----------
  {
    const S = res(1024), k = S / 1024;
    const [d, c] = cv(S, S);
    c.fillStyle = '#7A5E40'; c.fillRect(0, 0, S, S);
    speckle(c, S, S, Math.round(8000 * quality), [['#9A7E5A', 0.35], ['#5E4628', 0.35]], 1, 3 * k);
    const rows = 16, bh = S / rows, bw = S / 8;
    for (let r = 0; r < rows; r++) for (let col = -1; col <= 8; col++) {
      const ox = (r % 2) * (bw / 2) + col * bw;
      const v = 146 + (Math.random() * 46) | 0;
      const jx = (Math.random() - 0.5) * 3 * k, jy = (Math.random() - 0.5) * 2 * k;
      const x = ox + 4 * k + jx, y = r * bh + 4 * k + jy, w = bw - 8 * k, h = bh - 8 * k;
      c.fillStyle = `rgb(${v},${(v * 0.77) | 0},${(v * 0.52) | 0})`;
      c.fillRect(x, y, w, h);
      c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
      speckle(c, S, S, Math.round(45 * quality), [['#000000', 0.09], ['#ffffff', 0.08]], 1, 3 * k);
      c.restore();
      c.fillStyle = 'rgba(255,238,205,0.20)'; c.fillRect(x, y, w, 3 * k); c.fillRect(x, y, 3 * k, h);
      c.fillStyle = 'rgba(30,18,8,0.32)'; c.fillRect(x, y + h - 4 * k, w, 4 * k); c.fillRect(x + w - 4 * k, y, 4 * k, h);
      if (Math.random() < 0.18) { c.fillStyle = '#7A5E40'; c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w - 14 * k, y); c.lineTo(x + w, y + 12 * k); c.fill(); }
    }
    mottle(c, S, 14, S * 0.2, ['rgba(60,44,28,0.10)', 'rgba(220,200,168,0.08)']);
    valueNoise(c, S, S, 5, 0.12);
    const HS = res(512), hk = HS / 1024, hbh = HS / rows, hbw = HS / 8;
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#3a3a3a'; bc.fillRect(0, 0, HS, HS);
    for (let r = 0; r < rows; r++) for (let col = -1; col <= 8; col++) {
      const ox = (r % 2) * (hbw / 2) + col * hbw;
      bc.fillStyle = '#cfcfcf'; bc.fillRect(ox + 5 * hk, r * hbh + 5 * hk, hbw - 10 * hk, hbh - 10 * hk);
    }
    speckle(bc, HS, HS, Math.round(6000 * quality), [['#e0e0e0', 0.35], ['#909090', 0.35]], 1, 2);
    cached.adobeBrick = mat(d, b, 2, 2, { rough: 0.88, relief: 1.2, roughSpread: 0.16 });
  }

  // ---------- CONCRETE ----------
  {
    const S = res(1024), k = S / 1024;
    const [d, c] = cv(S, S);
    c.fillStyle = '#8D877B'; c.fillRect(0, 0, S, S);
    speckle(c, S, S, Math.round(22000 * quality), [['#ABA396', 0.4], ['#6A645A', 0.4], ['#7E776C', 0.36]], 1, 3 * k);
    for (let i = 0; i < Math.round(700 * quality); i++) { const x = Math.random() * S, y = Math.random() * S, r = (1 + Math.random() * 2.5) * k; c.fillStyle = 'rgba(50,46,40,0.4)'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.arc(x + r * 0.5, y + r * 0.5, r * 0.5, 0, 7); c.fill(); }
    mottle(c, S, 16, S * 0.13, ['rgba(60,54,46,0.18)', 'rgba(190,186,176,0.1)']);
    c.strokeStyle = 'rgba(50,46,40,0.42)'; c.lineWidth = 3 * k;
    for (let i = 0; i <= S; i += S / 4) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(S, i); c.stroke(); }
    cracks(c, S, S, 8, 'rgba(50,46,40,0.4)', 1.6 * k);
    valueNoise(c, S, S, 5, 0.12);
    const HS = res(512);
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#808080'; bc.fillRect(0, 0, HS, HS);
    speckle(bc, HS, HS, Math.round(12000 * quality), [['#c0c0c0', 0.4], ['#484848', 0.4]], 1, 3);
    bc.strokeStyle = '#3c3c3c'; bc.lineWidth = 3;
    for (let i = 0; i <= HS; i += HS / 4) { bc.beginPath(); bc.moveTo(i, 0); bc.lineTo(i, HS); bc.stroke(); bc.beginPath(); bc.moveTo(0, i); bc.lineTo(HS, i); bc.stroke(); }
    cached.concrete = mat(d, b, 5, 5, { rough: 0.78, relief: 0.62, roughSpread: 0.2 });
  }

  // ---------- ASPHALT ----------
  {
    const S = res(1024), k = S / 1024;
    const [d, c] = cv(S, S);
    c.fillStyle = '#403C36'; c.fillRect(0, 0, S, S);
    speckle(c, S, S, Math.round(30000 * quality), [['#6E695F', 0.4], ['#26221C', 0.5], ['#585349', 0.36]], 1, 2 * k);
    for (const x of [S * 0.3, S * 0.7]) { const g = c.createLinearGradient(x - 70 * k, 0, x + 70 * k, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.24)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - 70 * k, 0, 140 * k, S); }
    for (let i = 0; i < 8; i++) { const x = Math.random() * S, y = Math.random() * S, r = (30 + Math.random() * 70) * k; const g = c.createRadialGradient(x, y, 2, x, y, r); g.addColorStop(0, 'rgba(10,8,6,0.4)'); g.addColorStop(1, 'rgba(10,8,6,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
    for (let i = 0; i < 7; i++) { c.strokeStyle = 'rgba(12,10,8,0.8)'; c.lineWidth = 5 * k; let x = Math.random() * S, y = Math.random() * S; c.beginPath(); c.moveTo(x, y); for (let j = 0; j < 6; j++) { x += (Math.random() - .5) * 90 * k; y += (Math.random() - .5) * 90 * k; c.lineTo(x, y); } c.stroke(); }
    c.fillStyle = 'rgba(225,220,205,0.46)'; c.fillRect(S * 0.06, 0, 8 * k, S); c.fillRect(S * 0.94 - 8 * k, 0, 8 * k, S);
    for (let y = 0; y < S; y += 200 * k) c.fillRect(S / 2 - 7 * k, y + 20 * k, 14 * k, 110 * k);
    noiseWear(c, S);
    valueNoise(c, S, S, 5, 0.12);
    const HS = res(512);
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#808080'; bc.fillRect(0, 0, HS, HS);
    speckle(bc, HS, HS, Math.round(16000 * quality), [['#c8c8c8', 0.45], ['#404040', 0.45]], 1, 2);
    // Polished wheel tracks: lower relief AND lower roughness than the shoulder.
    for (const x of [HS * 0.3, HS * 0.7]) { bc.fillStyle = 'rgba(128,128,128,0.75)'; bc.fillRect(x - 34, 0, 68, HS); }
    cached.asphalt = mat(d, b, 1, 6, { rough: 0.82, relief: 0.5, roughSpread: 0.22, envIntensity: 1.1 });
  }

  // ---------- WOOD ----------
  {
    const S = res(512), k = S / 256;
    const [d, c] = cv(S, S);
    c.fillStyle = '#725234'; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      c.strokeStyle = Math.random() > 0.5 ? 'rgba(40,26,14,0.26)' : 'rgba(168,128,82,0.22)';
      c.lineWidth = (0.8 + Math.random() * 2) * k;
      c.beginPath(); const y = Math.random() * S; c.moveTo(0, y);
      for (let x = 0; x <= S; x += 16 * k) c.lineTo(x, y + Math.sin(x * 0.05 / k) * 3 * k);
      c.stroke();
    }
    // knots
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      for (let r = 14 * k; r > 0; r -= 2.2 * k) { c.strokeStyle = `rgba(48,30,16,${0.05 + r / (60 * k)})`; c.lineWidth = 1.3 * k; c.beginPath(); c.ellipse(x, y, r, r * 0.6, 0.4, 0, 7); c.stroke(); }
    }
    c.strokeStyle = '#33220f'; c.lineWidth = 4 * k;
    for (let x = 0; x <= S; x += 64 * k) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke(); }
    const HS = res(256), hk = HS / 256;
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#909090'; bc.fillRect(0, 0, HS, HS);
    for (let i = 0; i < 70; i++) { bc.strokeStyle = Math.random() > 0.5 ? 'rgba(60,60,60,0.35)' : 'rgba(200,200,200,0.3)'; bc.lineWidth = 1 + Math.random() * 2; bc.beginPath(); const y = Math.random() * HS; bc.moveTo(0, y); for (let x = 0; x <= HS; x += 16) bc.lineTo(x, y + Math.sin(x * 0.05) * 3); bc.stroke(); }
    for (let x = 0; x <= HS; x += 64 * hk) { bc.fillStyle = '#3a3a3a'; bc.fillRect(x - 2, 0, 4, HS); }
    cached.wood = mat(d, b, 1, 1, { rough: 0.84, relief: 0.6, roughSpread: 0.14 });
  }

  // ---------- RUSTED METAL ----------
  {
    const S = res(512), k = S / 256;
    const [d, c] = cv(S, S);
    c.fillStyle = '#653620'; c.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 12 * k) {
      const g = c.createLinearGradient(x, 0, x + 12 * k, 0);
      g.addColorStop(0, 'rgba(40,20,10,0.5)'); g.addColorStop(0.5, 'rgba(186,104,55,0.4)'); g.addColorStop(1, 'rgba(40,20,10,0.5)');
      c.fillStyle = g; c.fillRect(x, 0, 12 * k, S);
    }
    speckle(c, S, S, Math.round(3200 * quality), [['#c87a3a', 0.45], ['#3a1c0c', 0.45]], 1, 3 * k);
    mottle(c, S, 22, S * 0.1, ['rgba(140,66,28,0.24)', 'rgba(34,28,24,0.2)', 'rgba(196,140,96,0.12)']);
    valueNoise(c, S, S, 5, 0.18);
    const HS = res(256), hk = HS / 256;
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#808080'; bc.fillRect(0, 0, HS, HS);
    for (let x = 0; x < HS; x += 12 * hk) { bc.fillStyle = x % (24 * hk) === 0 ? '#3c3c3c' : '#c8c8c8'; bc.fillRect(x, 0, 12 * hk, HS); }
    speckle(bc, HS, HS, Math.round(2400 * quality), [['#dddddd', 0.3], ['#444444', 0.3]], 1, 3);
    cached.rustedMetal = mat(d, b, 2, 3, { rough: 0.72, metal: 0.42, relief: 0.85, roughSpread: 0.24, envIntensity: 1.2 });
  }

  // ---------- SANDBAG ----------
  {
    const S = res(512), k = S / 256;
    const [d, c] = cv(S, S);
    c.fillStyle = '#AA9469'; c.fillRect(0, 0, S, S);
    speckle(c, S, S, Math.round(4800 * quality), [['#CBB488', 0.45], ['#866E48', 0.45]], 1, 3 * k);
    // hessian weave
    for (let y = 0; y < S; y += 3 * k) { c.fillStyle = 'rgba(0,0,0,0.05)'; c.fillRect(0, y, S, 1.4 * k); }
    for (let x = 0; x < S; x += 3 * k) { c.fillStyle = 'rgba(255,255,255,0.045)'; c.fillRect(x, 0, 1.4 * k, S); }
    for (let y = 0; y < S; y += 42 * k) {
      c.fillStyle = 'rgba(255,255,255,0.09)'; c.fillRect(4 * k, y + 3 * k, S - 8 * k, 4 * k);
      c.fillStyle = 'rgba(0,0,0,0.17)'; c.fillRect(4 * k, y + 36 * k, S - 8 * k, 4 * k);
      c.strokeStyle = 'rgba(80,68,45,0.36)'; c.lineWidth = 2 * k; c.strokeRect(4 * k, y + 2 * k, S - 8 * k, 38 * k);
    }
    const HS = res(256), hk = HS / 256;
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#6a6a6a'; bc.fillRect(0, 0, HS, HS);
    for (let y = 0; y < HS; y += 42 * hk) { bc.fillStyle = '#c0c0c0'; bc.fillRect(6 * hk, y + 6 * hk, HS - 12 * hk, 30 * hk); }
    for (let y = 0; y < HS; y += 3) { bc.fillStyle = 'rgba(0,0,0,0.12)'; bc.fillRect(0, y, HS, 1.4); }
    cached.sandbag = mat(d, b, 1.5, 1.5, { rough: 0.95, relief: 0.95, roughSpread: 0.08, envIntensity: 0.8 });
  }

  // ---------- COURTYARD TILE ----------
  {
    const S = res(512), k = S / 256;
    const [d, c] = cv(S, S);
    c.fillStyle = '#BC9E6E'; c.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 64 * k) for (let x = 0; x < S; x += 64 * k) {
      c.strokeStyle = '#785C39'; c.lineWidth = 3 * k; c.strokeRect(x + 2 * k, y + 2 * k, 60 * k, 60 * k);
      c.fillStyle = (x + y) % (128 * k) === 0 ? 'rgba(150,75,50,0.30)' : 'rgba(60,105,115,0.30)';
      c.fillRect(x + 12 * k, y + 12 * k, 40 * k, 40 * k);
      c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = k; c.strokeRect(x + 12 * k, y + 12 * k, 40 * k, 40 * k);
      // glazed sheen varies per tile — the roughness map picks this up as gloss
      c.fillStyle = `rgba(255,252,240,${0.02 + Math.random() * 0.05})`;
      c.fillRect(x + 4 * k, y + 4 * k, 56 * k, 56 * k);
    }
    valueNoise(c, S, S, 4, 0.1);
    const HS = res(256), hk = HS / 256;
    const [b, bc] = cv(HS, HS); bc.fillStyle = '#7a7a7a'; bc.fillRect(0, 0, HS, HS);
    for (let y = 0; y < HS; y += 64 * hk) for (let x = 0; x < HS; x += 64 * hk) { bc.fillStyle = '#cfcfcf'; bc.fillRect(x + 4 * hk, y + 4 * hk, 56 * hk, 56 * hk); }
    cached.tileFloor = mat(d, b, 8, 8, { rough: 0.5, relief: 0.7, roughSpread: 0.26, envIntensity: 1.3 });
  }

  // District surfaces: deterministic hand-drawn masonry, grain and sediment.
  for (const [key, base, mortar, mode] of [
    ['stoneBlock', '#a19a85', '#605a4c', 'stone'],
    ['firedBrick', '#9E5A40', '#61473a', 'brick'],
    ['packedEarth', '#AB9370', '#877053', 'earth'],
    ['corrugatedMetal', '#6F7A78', '#3f504e', 'metal'],
    ['roughTimber', '#806D57', '#463d31', 'wood'],
    ['terracePavers', '#B0A68B', '#726b5a', 'paver'],
    ['cobbleLane', '#9B9179', '#63594d', 'cobble'],
    ['wadiBed', '#927F64', '#61503c', 'crack'],
  ] as const) {
    const S = res(512), k = S / 256;
    const [d, c] = cv(S, S), [b, bc] = cv(S, S);
    c.fillStyle = base; c.fillRect(0, 0, S, S);
    bc.fillStyle = '#aaaaaa'; bc.fillRect(0, 0, S, S);
    const line = (x: number, y: number, xx: number, yy: number, width = 2) => {
      for (const ctx of [c, bc]) {
        ctx.strokeStyle = ctx === c ? mortar : '#4a4a4a'; ctx.lineWidth = width * k;
        ctx.beginPath(); ctx.moveTo(x * k, y * k); ctx.lineTo(xx * k, yy * k); ctx.stroke();
      }
    };
    if (['stone', 'brick', 'paver', 'cobble'].includes(mode)) {
      const h = mode === 'brick' ? 20 : mode === 'cobble' ? 24 : 48;
      const w = mode === 'brick' ? 55 : mode === 'cobble' ? 38 : 88;
      for (let y = 0, row = 0; y < 256; y += h, row++) {
        line(0, y, 256, y, 3);
        for (let x = -(row % 2) * w / 2; x < 256; x += w) {
          line(x, y, x, y + h, 3);
          c.fillStyle = `rgba(255,247,221,${0.02 + ((row * 7 + x * 3) % 11) / 150})`;
          c.fillRect((x + 3) * k, (y + 3) * k, (w - 6) * k, (h - 6) * k);
          bc.fillStyle = `rgba(210,210,210,${0.5 + ((row * 5 + x) % 7) / 28})`;
          bc.fillRect((x + 3) * k, (y + 3) * k, (w - 6) * k, (h - 6) * k);
          line(x + 3, y + 4, x + w - 3, y + 4, 0.6);
        }
      }
    } else if (mode === 'metal' || mode === 'wood') {
      for (let x = 0; x < 256; x += mode === 'metal' ? 12 : 32) {
        line(x, 0, x, 256, 3); line(x + 3, 0, x + 3, 256, 1);
        if (mode === 'wood') { for (let j = 0; j < 7; j++) line(x + 5 + j * 3, 0, x + 6 + j * 3, 256, 0.4); }
        else {
          c.fillStyle = '#b7b2a0'; c.fillRect((x + 4) * k, 6 * k, 2 * k, 2 * k); c.fillRect((x + 4) * k, 246 * k, 2 * k, 2 * k);
          // corrugation reads as a smooth sine in the height map, not a square edge
          const g = bc.createLinearGradient(x * k, 0, (x + 12) * k, 0);
          g.addColorStop(0, '#5a5a5a'); g.addColorStop(0.5, '#e0e0e0'); g.addColorStop(1, '#5a5a5a');
          bc.fillStyle = g; bc.fillRect(x * k, 0, 12 * k, S);
        }
      }
    } else {
      for (let i = 0; i < 120; i++) {
        const x = (i * 67) % 256, y = (i * 101) % 256;
        line(x, y, x + 8 + Math.sin(i) * 7, y + Math.cos(i) * 13, mode === 'crack' ? 1.2 : 0.4);
      }
    }
    for (let i = 0; i < Math.round(2600 * quality); i++) {
      c.fillStyle = i % 2 ? 'rgba(36,29,21,.06)' : 'rgba(255,240,215,.07)';
      c.fillRect(((i * 73) % 256) * k, (((i * 131 + Math.floor(i / 256) * 17) % 256)) * k, k, 2 * k);
    }
    mottle(c, S, 12, S * 0.16, ['rgba(40,32,22,0.09)', 'rgba(230,220,196,0.07)']);
    cached[key] = mat(d, b, mode === 'wood' ? 1 : 2, 2, {
      rough: mode === 'metal' ? 0.6 : 0.9,
      metal: mode === 'metal' ? 0.35 : 0,
      relief: mode === 'crack' || mode === 'earth' ? 0.5 : 1.0,
      roughSpread: mode === 'metal' ? 0.24 : 0.16,
      envIntensity: mode === 'metal' ? 1.2 : 0.95,
    });
  }

  cached.dirtPath = cached.packedEarth;
  const SG = res(1024);
  const [signs, sc] = cv(SG, SG / 2);
  const sk = SG / 1024;
  const legends = ['Sandblast / Water 07', 'FORT / ARMORY  →', 'OLD SOUK  ↑', 'NOMAD / LANDING ZONE', 'CITADEL / SIGNAL  ↑', 'WEST GATE  ←', 'CARAVANSERAI', 'GRANARY / NO ACCESS', 'KILN QUARTER', 'TANNERY', 'POTTERS / EAST', 'DEPOT / FREIGHT'];
  legends.forEach((text, i) => {
    const x = (i % 2) * 512 * sk, y = Math.floor(i / 2) * 80 * sk;
    sc.fillStyle = i % 3 === 0 ? '#1d514f' : '#3a3930'; sc.fillRect(x, y, 512 * sk, 78 * sk);
    sc.strokeStyle = '#bda87c'; sc.lineWidth = 2 * sk; sc.strokeRect(x + 6 * sk, y + 6 * sk, 500 * sk, 66 * sk);
    sc.font = `bold ${28 * sk}px monospace`; sc.textBaseline = 'middle'; sc.textAlign = 'center';
    sc.fillStyle = '#ece0ba'; sc.fillText(text.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase()), x + 256 * sk, y + 39 * sk, 482 * sk);
    sc.globalAlpha = 0.18;
    for (let j = 0; j < 65; j++) { sc.fillStyle = j % 2 ? '#e6dbc2' : '#111b19'; sc.fillRect(x + ((j * 71) % 510) * sk, y + ((j * 31) % 78) * sk, (5 + j % 9) * sk, sk); }
    sc.globalAlpha = 1;
  });
  const signTexture = tex(signs, 1, 1);
  cached.signage = new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.72, metalness: 0.1, side: THREE.DoubleSide, envMapIntensity: 1.1 });
  return cached as TextureSet;
}
