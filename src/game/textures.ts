// Recoil FPS — Rich procedural PBR materials (diffuse + bump), higher fidelity
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
  /** District-specific surfaces used by the authored Arena maps. */
  limestoneCourse?: THREE.MeshStandardMaterial;
  marketTile?: THREE.MeshStandardMaterial;
  oilStainedConcrete?: THREE.MeshStandardMaterial;
  industrialSteel?: THREE.MeshStandardMaterial;
  warehouseBrick?: THREE.MeshStandardMaterial;
  hazardPaint?: THREE.MeshStandardMaterial;

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

function cv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, rx: number, ry: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Texture generation is part of the world build, so it must not make screenshots or
// map previews vary from one process to the next. Keep this local instead of touching
// the application's runtime random stream.
let textureRandomState = 0x6d2b79f5;
function textureRandom(): number {
  textureRandomState = Math.imul(textureRandomState ^ (textureRandomState >>> 15), 1 | textureRandomState);
  textureRandomState ^= textureRandomState + Math.imul(textureRandomState ^ (textureRandomState >>> 7), 61 | textureRandomState);
  return ((textureRandomState ^ (textureRandomState >>> 14)) >>> 0) / 4294967296;
}

function mat(diffuse: HTMLCanvasElement, bump: HTMLCanvasElement, rx: number, ry: number, rough: number, metal: number, bumpScale: number): THREE.MeshStandardMaterial {
  const b = tex(bump, rx, ry, false);
  return new THREE.MeshStandardMaterial({
    map: tex(diffuse, rx, ry),
    bumpMap: b,
    bumpScale,
    roughness: rough,
    metalness: metal,
  });
}

// value noise → soft cloudy variation (for baked AO / grime / color drift)
function valueNoise(ctx: CanvasRenderingContext2D, w: number, h: number, cells: number, alpha: number, dark = true) {
  const grid: number[][] = [];
  for (let y = 0; y <= cells; y++) { grid[y] = []; for (let x = 0; x <= cells; x++) grid[y][x] = textureRandom(); }
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
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

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, cols: [string, number][], sMin = 1, sMax = 3) {
  for (let i = 0; i < n; i++) {
    const [c, a] = cols[(textureRandom() * cols.length) | 0];
    ctx.globalAlpha = a; ctx.fillStyle = c;
    const s = sMin + textureRandom() * (sMax - sMin);
    ctx.fillRect(textureRandom() * w, textureRandom() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

function cracks(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, col: string, lw = 1.2) {
  ctx.strokeStyle = col; ctx.lineWidth = lw;
  for (let i = 0; i < n; i++) {
    let x = textureRandom() * w, y = textureRandom() * h;
    ctx.beginPath(); ctx.moveTo(x, y);
    const seg = 3 + (textureRandom() * 5) | 0;
    for (let s = 0; s < seg; s++) { x += (textureRandom() - 0.5) * 70; y += (textureRandom() - 0.5) * 70; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

// chips the painted lines so they read as worn, not freshly painted
function noiseWear(ctx: CanvasRenderingContext2D, S: number) {
  // scatter asphalt-colored flecks over everything so painted lines look chipped/worn
  for (let i = 0; i < 2600; i++) { ctx.fillStyle = 'rgba(68,64,58,0.7)'; ctx.fillRect(textureRandom() * S, textureRandom() * S, 2 + textureRandom() * 4, 1 + textureRandom() * 3); }
}

const cached: Partial<TextureSet> = {};

function ctxHorizontalBands(c: CanvasRenderingContext2D, S: number) {
  c.strokeStyle = 'rgba(70,55,38,0.12)';
  c.lineWidth = 1.5;
  for (let y = 32; y < S; y += 48) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke();
  }
}

export function getMaterials(): TextureSet {
  if (cached.sand) return cached as TextureSet;

  // ---------- SAND (1024px: wind ripples, grit, pebbles, footprint-scale detail) ----------
  {
    const S = 1024;
    const [d, c] = cv(S, S);
    c.fillStyle = '#CDAE72'; c.fillRect(0, 0, S, S);
    // large soft tonal patches (dune shading)
    valueNoise(c, S, S, 5, 0.16);
    // wind ripples — two crossing frequencies so it never looks like stripes
    for (let y = -80; y < S + 80; y += 22) {
      c.beginPath();
      for (let x = 0; x <= S; x += 6) { const yy = y + Math.sin(x * 0.014 + y * 0.3) * 7 + Math.sin(x * 0.041) * 2.5; x === 0 ? c.moveTo(x, yy) : c.lineTo(x, yy); }
      c.lineWidth = 9; c.strokeStyle = 'rgba(140,110,66,0.20)'; c.stroke();
      c.lineWidth = 3; c.strokeStyle = 'rgba(245,228,186,0.28)'; c.stroke();
    }
    // grit — dense fine speckle for actual texture at close range
    speckle(c, S, S, 26000, [['#F0DEB4', 0.35], ['#96763F', 0.4], ['#B8965A', 0.3]], 1, 2);
    // scattered pebbles
    for (let i = 0; i < 260; i++) {
      const x = textureRandom() * S, y = textureRandom() * S, r = 1.5 + textureRandom() * 3;
      c.fillStyle = textureRandom() > 0.5 ? '#8E7A58' : '#A89370';
      c.beginPath(); c.ellipse(x, y, r, r * 0.7, textureRandom() * 3, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, 7); c.fill();
    }
    const [b, bc] = cv(S, S); bc.fillStyle = '#808080'; bc.fillRect(0, 0, S, S);
    for (let y = -80; y < S + 80; y += 22) {
      bc.beginPath();
      for (let x = 0; x <= S; x += 6) { const yy = y + Math.sin(x * 0.014 + y * 0.3) * 7 + Math.sin(x * 0.041) * 2.5; x === 0 ? bc.moveTo(x, yy) : bc.lineTo(x, yy); }
      bc.lineWidth = 9; bc.strokeStyle = 'rgba(60,60,60,0.5)'; bc.stroke();
      bc.lineWidth = 3; bc.strokeStyle = 'rgba(200,200,200,0.6)'; bc.stroke();
    }
    speckle(bc, S, S, 14000, [['#b8b8b8', 0.5], ['#505050', 0.5]], 1, 2);
    cached.sand = mat(d, b, 22, 22, 0.96, 0, 0.07);
  }

  // ---------- PLAZA STONE (1024px: irregular flagstones, worn edges, grit in joints) ----------
  {
    const S = 1024;
    const [d, c] = cv(S, S);
    c.fillStyle = '#8F836A'; c.fillRect(0, 0, S, S); // joint/grout
    const n = 6, s = S / n;
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      const v = 168 + (textureRandom() * 34) | 0;
      const inset = 4 + textureRandom() * 3;
      const x = gx * s + inset, y = gy * s + inset, w = s - inset * 2, h = s - inset * 2;
      c.fillStyle = `rgb(${v},${(v * 0.9) | 0},${(v * 0.73) | 0})`;
      c.fillRect(x, y, w, h);
      // stone grain inside each flag
      c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
      speckle(c, S, S, 260, [['#000000', 0.07], ['#ffffff', 0.08]], 1, 3);
      for (let k = 0; k < 3; k++) { const vx = x + textureRandom() * w, vy = y + textureRandom() * h; c.strokeStyle = 'rgba(80,70,50,0.18)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(vx, vy); c.lineTo(vx + (textureRandom() - 0.5) * 60, vy + (textureRandom() - 0.5) * 60); c.stroke(); }
      c.restore();
      // bevel edges
      c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(x, y, w, 3); c.fillRect(x, y, 3, h);
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x, y + h - 4, w, 4); c.fillRect(x + w - 4, y, 4, h);
    }
    cracks(c, S, S, 8, 'rgba(60,52,40,0.4)', 1.6);
    valueNoise(c, S, S, 5, 0.12);
    const [b, bc] = cv(S, S); bc.fillStyle = '#6a6a6a'; bc.fillRect(0, 0, S, S);
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) { bc.fillStyle = '#cccccc'; bc.fillRect(gx * s + 6, gy * s + 6, s - 12, s - 12); }
    speckle(bc, S, S, 6000, [['#e8e8e8', 0.4], ['#a0a0a0', 0.4]], 1, 2);
    cached.plaza = mat(d, b, 8, 8, 0.82, 0, 0.1);
  }

  // ---------- ADOBE PLASTER: Clean, modern tactical stucco (uniform grain, no leopard splotches) ----------
  const makeAdobe = (base: string, _tone = 0, repeatScale = 3) => {
    const S = 512;
    const [d, c] = cv(S, S);
    c.fillStyle = base; c.fillRect(0, 0, S, S);
    // Fine, uniform sand/plaster grain
    speckle(c, S, S, 12000, [['#000000', 0.035], ['#ffffff', 0.045], ['#8a6d48', 0.025]], 1, 2);
    // Very gentle tonal variation across wall surface
    valueNoise(c, S, S, 4, 0.05);
    // Architectural masonry trowel grooves
    ctxHorizontalBands(c, S);
    const [b, bc] = cv(S, S); bc.fillStyle = '#808080'; bc.fillRect(0, 0, S, S);
    speckle(bc, S, S, 8000, [['#b0b0b0', 0.35], ['#505050', 0.35]], 1, 2);
    return mat(d, b, repeatScale, repeatScale, 0.93, 0, 0.03);
  };
  cached.adobeWall = makeAdobe('#C6AA7B', 0, 3);
  cached.adobeWall2 = makeAdobe('#B89569', 1, 3);
  cached.plaster = makeAdobe('#D2BD97', 2, 2.5);
  cached.whitewash = makeAdobe('#E0D5BE', 3, 2.5);

  // ---------- ADOBE BRICK (1024px: recessed mortar, chipped edges, per-brick grit) ----------
  {
    const S = 1024;
    const [d, c] = cv(S, S);
    c.fillStyle = '#7E6040'; c.fillRect(0, 0, S, S); // mortar
    speckle(c, S, S, 8000, [['#9A7E5A', 0.4], ['#5E4628', 0.4]], 1, 3);
    const rows = 16, bh = S / rows, bw = S / 8;
    for (let r = 0; r < rows; r++) for (let col = -1; col <= 8; col++) {
      const ox = (r % 2) * (bw / 2) + col * bw;
      const v = 148 + (textureRandom() * 46) | 0;
      const jx = (textureRandom() - 0.5) * 3, jy = (textureRandom() - 0.5) * 2;
      const x = ox + 4 + jx, y = r * bh + 4 + jy, w = bw - 8, h = bh - 8;
      c.fillStyle = `rgb(${v},${(v * 0.76) | 0},${(v * 0.5) | 0})`;
      c.fillRect(x, y, w, h);
      // per-brick surface grit
      c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
      speckle(c, S, S, 40, [['#000000', 0.1], ['#ffffff', 0.09]], 1, 3);
      c.restore();
      // bevel: bright top/left, dark bottom/right → reads as real relief
      c.fillStyle = 'rgba(255,238,205,0.22)'; c.fillRect(x, y, w, 3); c.fillRect(x, y, 3, h);
      c.fillStyle = 'rgba(30,18,8,0.36)'; c.fillRect(x, y + h - 4, w, 4); c.fillRect(x + w - 4, y, 4, h);
      // occasional chipped corner
      if (textureRandom() < 0.18) { c.fillStyle = '#7E6040'; c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w - 14, y); c.lineTo(x + w, y + 12); c.fill(); }
    }
    valueNoise(c, S, S, 5, 0.12);
    const [b, bc] = cv(S, S); bc.fillStyle = '#404040'; bc.fillRect(0, 0, S, S);
    for (let r = 0; r < rows; r++) for (let col = -1; col <= 8; col++) {
      const ox = (r % 2) * (bw / 2) + col * bw;
      bc.fillStyle = '#c8c8c8'; bc.fillRect(ox + 5, r * bh + 5, bw - 10, bh - 10);
    }
    speckle(bc, S, S, 6000, [['#e0e0e0', 0.4], ['#909090', 0.4]], 1, 2);
    cached.adobeBrick = mat(d, b, 2, 2, 0.84, 0, 0.12);
  }

  // ---------- CONCRETE (1024px: aggregate, pitting, form-panel seams, stains) ----------
  {
    const S = 1024;
    const [d, c] = cv(S, S);
    c.fillStyle = '#918A7D'; c.fillRect(0, 0, S, S);
    speckle(c, S, S, 22000, [['#ABA396', 0.45], ['#6A645A', 0.45], ['#7E776C', 0.4]], 1, 3);
    // air-bubble pitting
    for (let i = 0; i < 700; i++) { const x = textureRandom() * S, y = textureRandom() * S, r = 1 + textureRandom() * 2.5; c.fillStyle = 'rgba(50,46,40,0.45)'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.arc(x + r * 0.5, y + r * 0.5, r * 0.5, 0, 7); c.fill(); }
    // stains
    for (let i = 0; i < 14; i++) {
      const x = textureRandom() * S, y = textureRandom() * S, r = 60 + textureRandom() * 120;
      const g = c.createRadialGradient(x, y, 4, x, y, r);
      g.addColorStop(0, 'rgba(60,54,46,0.28)'); g.addColorStop(1, 'rgba(60,54,46,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
    // form-panel seams
    c.strokeStyle = 'rgba(50,46,40,0.5)'; c.lineWidth = 3;
    for (let i = 0; i <= S; i += 256) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(S, i); c.stroke(); }
    cracks(c, S, S, 8, 'rgba(50,46,40,0.45)', 1.6);
    valueNoise(c, S, S, 5, 0.12);
    const [b, bc] = cv(S, S); bc.fillStyle = '#808080'; bc.fillRect(0, 0, S, S);
    speckle(bc, S, S, 12000, [['#c8c8c8', 0.45], ['#3c3c3c', 0.45]], 1, 3);
    bc.strokeStyle = '#404040'; bc.lineWidth = 3;
    for (let i = 0; i <= S; i += 256) { bc.beginPath(); bc.moveTo(i, 0); bc.lineTo(i, S); bc.stroke(); bc.beginPath(); bc.moveTo(0, i); bc.lineTo(S, i); bc.stroke(); }
    cached.concrete = mat(d, b, 5, 5, 0.8, 0, 0.08);
  }

  // ---------- ASPHALT (1024px: coarse aggregate, tyre-wear lanes, patched cracks, faded edge line) ----------
  {
    const S = 1024;
    const [d, c] = cv(S, S);
    c.fillStyle = '#44403A'; c.fillRect(0, 0, S, S);
    speckle(c, S, S, 30000, [['#6E695F', 0.45], ['#26221C', 0.55], ['#585349', 0.4]], 1, 2);
    // tyre-polished wheel tracks (darker, smoother bands)
    for (const x of [S * 0.3, S * 0.7]) { const g = c.createLinearGradient(x - 70, 0, x + 70, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - 70, 0, 140, S); }
    // oil stains
    for (let i = 0; i < 8; i++) { const x = textureRandom() * S, y = textureRandom() * S, r = 30 + textureRandom() * 70; const g = c.createRadialGradient(x, y, 2, x, y, r); g.addColorStop(0, 'rgba(10,8,6,0.4)'); g.addColorStop(1, 'rgba(10,8,6,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
    // tar-sealed cracks
    for (let i = 0; i < 7; i++) { c.strokeStyle = 'rgba(12,10,8,0.85)'; c.lineWidth = 5; let x = textureRandom() * S, y = textureRandom() * S; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (textureRandom() - .5) * 90; y += (textureRandom() - .5) * 90; c.lineTo(x, y); } c.stroke(); }
    // faded white edge lines + centre dash (worn)
    c.fillStyle = 'rgba(225,220,205,0.5)'; c.fillRect(S * 0.06, 0, 8, S); c.fillRect(S * 0.94 - 8, 0, 8, S);
    for (let y = 0; y < S; y += 200) c.fillRect(S / 2 - 7, y + 20, 14, 110);
    noiseWear(c, S);
    valueNoise(c, S, S, 5, 0.12);
    const [b, bc] = cv(S, S); bc.fillStyle = '#808080'; bc.fillRect(0, 0, S, S);
    speckle(bc, S, S, 16000, [['#c8c8c8', 0.5], ['#404040', 0.5]], 1, 2);
    cached.asphalt = mat(d, b, 1, 6, 0.86, 0, 0.05);
  }

  // ---------- WOOD ----------
  {
    const [d, c] = cv(256, 256);
    c.fillStyle = '#795737'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) {
      c.strokeStyle = textureRandom() > 0.5 ? 'rgba(40,26,14,0.3)' : 'rgba(160,120,76,0.25)';
      c.lineWidth = 1 + textureRandom() * 2;
      c.beginPath(); const y = textureRandom() * 256; c.moveTo(0, y);
      for (let x = 0; x <= 256; x += 16) c.lineTo(x, y + Math.sin(x * 0.05) * 3);
      c.stroke();
    }
    c.strokeStyle = '#3a2818'; c.lineWidth = 4;
    for (let x = 0; x <= 256; x += 64) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke(); }
    const [b, bc] = cv(256, 256); bc.fillStyle = '#808080'; bc.fillRect(0, 0, 256, 256);
    for (let x = 0; x <= 256; x += 64) { bc.fillStyle = '#606060'; bc.fillRect(x - 2, 0, 4, 256); }
    cached.wood = mat(d, b, 1, 1, 0.85, 0, 0.05);
  }

  // ---------- RUSTED METAL ----------
  {
    const [d, c] = cv(256, 256);
    c.fillStyle = '#6E3A22'; c.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 12) {
      const g = c.createLinearGradient(x, 0, x + 12, 0);
      g.addColorStop(0, 'rgba(40,20,10,0.5)'); g.addColorStop(0.5, 'rgba(190,105,55,0.4)'); g.addColorStop(1, 'rgba(40,20,10,0.5)');
      c.fillStyle = g; c.fillRect(x, 0, 12, 256);
    }
    speckle(c, 256, 256, 1600, [['#c87a3a', 0.5], ['#3a1c0c', 0.5]], 1, 3);
    valueNoise(c, 256, 256, 5, 0.18);
    const [b, bc] = cv(256, 256); bc.fillStyle = '#808080'; bc.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 12) { bc.fillStyle = x % 24 === 0 ? '#4a4a4a' : '#c0c0c0'; bc.fillRect(x, 0, 12, 256); }
    cached.rustedMetal = mat(d, b, 2, 3, 0.62, 0.5, 0.06);
  }

  // ---------- SANDBAG ----------
  {
    const [d, c] = cv(256, 256);
    c.fillStyle = '#B09A70'; c.fillRect(0, 0, 256, 256);
    speckle(c, 256, 256, 2400, [['#CBB488', 0.5], ['#866E48', 0.5]], 1, 3);
    for (let y = 0; y < 256; y += 42) {
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(4, y + 3, 248, 4);
      c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(4, y + 36, 248, 4);
      c.strokeStyle = 'rgba(80,68,45,0.4)'; c.lineWidth = 2; c.strokeRect(4, y + 2, 248, 38);
    }
    const [b, bc] = cv(256, 256); bc.fillStyle = '#707070'; bc.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 42) { bc.fillStyle = '#b8b8b8'; bc.fillRect(6, y + 6, 244, 30); }
    cached.sandbag = mat(d, b, 1.5, 1.5, 0.92, 0, 0.09);
  }

  // ---------- COURTYARD TILE ----------
  {
    const [d, c] = cv(256, 256);
    c.fillStyle = '#C0A170'; c.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
      c.strokeStyle = '#7A5E3A'; c.lineWidth = 3; c.strokeRect(x + 2, y + 2, 60, 60);
      c.fillStyle = (x + y) % 128 === 0 ? 'rgba(150,75,50,0.32)' : 'rgba(60,105,115,0.32)';
      c.fillRect(x + 12, y + 12, 40, 40);
      c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 1; c.strokeRect(x + 12, y + 12, 40, 40);
    }
    valueNoise(c, 256, 256, 4, 0.1);
    const [b, bc] = cv(256, 256); bc.fillStyle = '#909090'; bc.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) { bc.fillStyle = '#c8c8c8'; bc.fillRect(x + 4, y + 4, 56, 56); }
    cached.tileFloor = mat(d, b, 8, 8, 0.8, 0, 0.05);
  }

  // District surfaces: deterministic hand-drawn masonry, grain and sediment. Small
  // 256px diffuse/bump pairs are bundled procedurally; no external texture downloads.
  for (const [key, base, mortar, mode] of [
    ['stoneBlock', '#a8a18b', '#655f50', 'stone'],
    ['firedBrick', '#a65e43', '#654a3b', 'brick'],
    ['packedEarth', '#b29a74', '#8d7355', 'earth'],
    ['corrugatedMetal', '#788380', '#435452', 'metal'],
    ['roughTimber', '#87735b', '#4a4033', 'wood'],
    ['terracePavers', '#b8ad91', '#77705e', 'paver'],
    ['cobbleLane', '#a29881', '#685f51', 'cobble'],
    ['wadiBed', '#998669', '#65533f', 'crack'],
  ] as const) {
    const [d,c] = cv(256,256), [b,bc] = cv(256,256);
    c.fillStyle = base; c.fillRect(0,0,256,256);
    bc.fillStyle = '#aaaaaa'; bc.fillRect(0,0,256,256);
    const line = (x: number,y: number,xx: number,yy: number,width = 2) => {
      for (const ctx of [c,bc]) {
        ctx.strokeStyle = ctx === c ? mortar : '#555555'; ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(xx,yy); ctx.stroke();
      }
    };
    if (['stone','brick','paver','cobble'].includes(mode)) {
      const h = mode === 'brick' ? 20 : mode === 'cobble' ? 24 : 48;
      const w = mode === 'brick' ? 55 : mode === 'cobble' ? 38 : 88;
      for(let y=0,row=0;y<256;y+=h,row++) {
        line(0,y,256,y,3);
        for(let x=-(row%2)*w/2;x<256;x+=w) {
          line(x,y,x,y+h,3);
          c.fillStyle = `rgba(255,247,221,${0.025+((row*7+x*3)%11)/140})`;
          c.fillRect(x+3,y+3,w-6,h-6);
          line(x+3,y+4,x+w-3,y+4,0.6);
        }
      }
    } else if (mode === 'metal' || mode === 'wood') {
      for(let x=0;x<256;x+=mode==='metal'?12:32) {
        line(x,0,x,256,3); line(x+3,0,x+3,256,1);
        if(mode==='wood') for(let j=0;j<7;j++) line(x+5+j*3,0,x+6+j*3,256,0.4);
        else {c.fillStyle='#b7b2a0';c.fillRect(x+4,6,2,2);c.fillRect(x+4,246,2,2);}
      }
    } else {
      for(let i=0;i<120;i++) {
        const x=(i*67)%256,y=(i*101)%256;
        line(x,y,x+8+Math.sin(i)*7,y+Math.cos(i)*13,mode==='crack'?1.2:0.4);
      }
    }
    // Subtle granular weathering, deterministic to keep screenshots reproducible.
    for(let i=0;i<1800;i++) {
      c.fillStyle=i%2?'rgba(36,29,21,.07)':'rgba(255,240,215,.08)';
      c.fillRect((i*73)%256,(i*131+Math.floor(i/256)*17)%256,1,2);
    }
    cached[key] = mat(d,b,mode==='wood'?1:2,2,mode==='metal'?0.63:0.94,mode==='metal'?0.35:0,0.07);
  }

  // Map-specific finish families. These stay in the same procedural cache as the
  // older surfaces: builders can ask for a limestone plinth or an oil-darkened
  // warehouse floor without allocating a material for every building.
  const makeFinish = (base: string, accent: string, mode: 'stone' | 'tile' | 'oil' | 'steel' | 'brick' | 'paint') => {
    const [d, dc] = cv(256, 256), [b, bc] = cv(256, 256);
    dc.fillStyle = base; dc.fillRect(0, 0, 256, 256);
    bc.fillStyle = '#969696'; bc.fillRect(0, 0, 256, 256);
    if (mode === 'stone' || mode === 'brick') {
      const row = mode === 'brick' ? 22 : 52, col = mode === 'brick' ? 58 : 92;
      for (let y = 0, r = 0; y < 256; y += row, r++) for (let x = -(r % 2) * col / 2; x < 256; x += col) {
        dc.fillStyle = accent; dc.fillRect(x + 3, y + 3, col - 6, row - 6);
        dc.strokeStyle = 'rgba(40,30,20,.45)'; dc.lineWidth = 3; dc.strokeRect(x, y, col, row);
        bc.fillStyle = '#d0d0d0'; bc.fillRect(x + 4, y + 4, col - 8, row - 8);
      }
    } else if (mode === 'tile') {
      for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) {
        dc.fillStyle = ((x / 32 + y / 32) % 2) ? accent : base;
        dc.fillRect(x + 2, y + 2, 28, 28);
        dc.strokeStyle = '#594c40'; dc.lineWidth = 2; dc.strokeRect(x + 1, y + 1, 30, 30);
        bc.fillStyle = '#bdbdbd'; bc.fillRect(x + 3, y + 3, 26, 26);
      }
    } else if (mode === 'steel') {
      for (let x = 0; x < 256; x += 16) {
        dc.fillStyle = x % 32 ? base : accent; dc.fillRect(x, 0, 11, 256);
        dc.strokeStyle = 'rgba(20,25,24,.6)'; dc.lineWidth = 2; dc.strokeRect(x + 2, 0, 8, 256);
        bc.fillStyle = x % 32 ? '#a4a4a4' : '#606060'; bc.fillRect(x + 3, 0, 7, 256);
      }
    } else {
      // Oil is represented by broad stains and tyre-polished tracks in the albedo,
      // with a low-relief bump so it remains readable under a hard sun.
      for (let i = 0; i < 9; i++) {
        const x = (i * 71) % 240, y = (i * 43) % 220, r = 10 + (i % 4) * 8;
        const g = dc.createRadialGradient(x, y, 1, x, y, r);
        g.addColorStop(0, 'rgba(20,17,13,.48)'); g.addColorStop(1, 'rgba(20,17,13,0)');
        dc.fillStyle = g; dc.beginPath(); dc.arc(x, y, r, 0, Math.PI * 2); dc.fill();
        bc.fillStyle = '#686868'; bc.fillRect(x - r / 2, y - 2, r, 4);
      }
    }
    for (let i = 0; i < 900; i++) {
      dc.fillStyle = i % 2 ? 'rgba(255,255,255,.08)' : 'rgba(20,18,15,.08)';
      dc.fillRect((i * 37) % 256, (i * 83) % 256, 1 + i % 2, 1);
    }
    return mat(d, b, mode === 'steel' ? 2.5 : 3, 3, mode === 'steel' ? 0.64 : 0.88, mode === 'steel' ? 0.36 : 0, mode === 'tile' ? 0.06 : 0.08);
  };
  cached.limestoneCourse = makeFinish('#b9b09b', '#d9d0b8', 'stone');
  cached.marketTile = makeFinish('#b87d5b', '#6d9ba1', 'tile');
  cached.oilStainedConcrete = makeFinish('#726e65', '#2d2924', 'oil');
  cached.industrialSteel = makeFinish('#64716f', '#3f4b4a', 'steel');
  cached.warehouseBrick = makeFinish('#8b5943', '#a66e50', 'brick');
  cached.hazardPaint = makeFinish('#c28b29', '#302a20', 'paint');

  // Packed earth serves both rendered walls and trampled service paths in one batch.
  cached.dirtPath = cached.packedEarth;
  const [signs, sc] = cv(1024, 512);
  const legends = ['Sandblast / Water 07', 'FORT / ARMORY  →', 'OLD SOUK  ↑', 'NOMAD / LANDING ZONE', 'CITADEL / SIGNAL  ↑', 'WEST GATE  ←', 'CARAVANSERAI', 'GRANARY / NO ACCESS', 'KILN QUARTER', 'TANNERY', 'POTTERS / EAST', 'DEPOT / FREIGHT'];
  legends.forEach((text, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 80;
    sc.fillStyle = i % 3 === 0 ? '#1d514f' : '#3a3930'; sc.fillRect(x,y,512,78);
    sc.strokeStyle = '#bda87c'; sc.lineWidth = 2; sc.strokeRect(x+6,y+6,500,66);
    sc.font = 'bold 28px monospace'; sc.textBaseline = 'middle'; sc.textAlign = 'center';
    sc.fillStyle = '#ece0ba'; sc.fillText(text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),x+256,y+39,482);
    sc.globalAlpha = 0.18;
    for (let j=0;j<65;j++) {sc.fillStyle=j%2?'#e6dbc2':'#111b19';sc.fillRect(x+(j*71)%510,y+(j*31)%78,5+j%9,1);}
    sc.globalAlpha = 1;
  });
  const signTexture = tex(signs,1,1); signTexture.minFilter = THREE.LinearMipmapLinearFilter;
  cached.signage = new THREE.MeshStandardMaterial({map:signTexture,roughness:0.9,side:THREE.DoubleSide});
  return cached as TextureSet;
}
