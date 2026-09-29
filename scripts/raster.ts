/**
 * Recoil FPS — a tiny software rasteriser.
 *
 * There is no browser and no GPU in this sandbox, so the only way to actually LOOK at
 * the procedural geometry is to rasterise it on the CPU and write a PNG. This is not a
 * renderer for the game; it is a verification tool. It exists so that "the magazine has
 * no gap where it meets the well" can be checked by looking rather than asserted by
 * hoping.
 *
 * Deliberately flat-shaded and orthographic: perspective hides exactly the seams you are
 * hunting for, and a specular highlight will happily paper over a 2 mm crack.
 */
import * as THREE from 'three';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- PNG encoding

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode straight RGBA bytes as a PNG. */
export function encodePNG(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- rasterising

export type ViewName = 'elevation' | 'top' | 'front' | 'iso';

export interface RenderOpts {
  width?: number;
  height?: number;
  view?: ViewName;
  /** Look from -X instead of +X (elevation only): shows the other side of the weapon. */
  flip?: boolean;
  background?: [number, number, number];
  /** Draw a faint grid every N metres so gaps can be measured by eye. */
  gridStep?: number;
  /** Override the fitted bounds (metres). Useful for zooming into a joint. */
  focus?: { center: THREE.Vector3; span: number };
  /**
   * Clay mode (default). Ignores material colours and shades every face the same
   * neutral grey. Weapon finishes are near-black OD green and gunmetal, which swallow
   * exactly the seams this tool exists to find — a uniform clay makes a 2 mm step
   * visible as a shading break instead of hiding it in a dark patch.
   */
  clay?: boolean;
  /**
   * Perspective camera. When present the orthographic fit is bypassed entirely and the
   * scene is rendered from `eye` looking at `target`. This is what map renders use:
   * an architectural massing view is the only way to judge whether a street reads as
   * a place or as a pile of boxes, and there is no browser here to take a screenshot.
   */
  camera?: { eye: [number, number, number]; target: [number, number, number]; fov?: number };
  /** Vertical background gradient (top, bottom). Falls back to flat `background`. */
  sky?: { top: [number, number, number]; bottom: [number, number, number] };
  /** Fade geometry toward the sky between these view depths, in metres. */
  haze?: { start: number; end: number };
  /**
   * Directional sun instead of the two-sided studio rig. Roofs catch the light, walls
   * fall off by orientation and shaded faces stay readable on a sky-blue ambient —
   * which is what makes a massing model legible. Weapon renders keep the studio rig.
   */
  sun?: { dir: [number, number, number]; strength?: number; ambient?: number };
}

interface VView { x: number; y: number; z: number }

/** Sutherland-Hodgman against the single near plane z >= near. */
function clipNear(poly: VView[], near: number): VView[] {
  const out: VView[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prv = poly[(i + poly.length - 1) % poly.length];
    const curIn = cur.z >= near, prvIn = prv.z >= near;
    if (curIn !== prvIn) {
      const t = (near - prv.z) / (cur.z - prv.z);
      out.push({ x: prv.x + (cur.x - prv.x) * t, y: prv.y + (cur.y - prv.y) * t, z: near });
    }
    if (curIn) out.push(cur);
  }
  return out;
}

interface Tri {
  /** Screen-space x, y plus view-space depth for each vertex. */
  sx: [number, number, number];
  sy: [number, number, number];
  sz: [number, number, number];
  r: number; g: number; b: number;
}

/** Camera basis per view. `fwd` points from the camera toward the subject. */
function basis(view: ViewName, flip: boolean) {
  switch (view) {
    // Side elevation. This is the view that actually finds gaps.
    case 'elevation': return flip
      ? { right: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(1, 0, 0) }
      : { right: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(-1, 0, 0) };
    case 'top': return { right: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(1, 0, 0), fwd: new THREE.Vector3(0, -1, 0) };
    case 'front': return { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, 1) };
    case 'iso': {
      const fwd = new THREE.Vector3(-0.8, -0.45, -0.6).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      return { right, up, fwd };
    }
  }
}

/**
 * Rasterise an object tree to RGBA bytes.
 *
 * Flat shading from a single key light plus a fill, so faces read as distinct planes.
 * Backfaces are kept — a missing backface is itself a modelling bug worth seeing.
 */
export function render(root: THREE.Object3D, opts: RenderOpts = {}): { rgba: Uint8Array; width: number; height: number } {
  const width = opts.width ?? 1200;
  const height = opts.height ?? 700;
  const view = opts.view ?? 'elevation';
  const bg = opts.background ?? [26, 28, 33];
  const cam = opts.camera;
  let right: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3;
  const eye = cam ? new THREE.Vector3(...cam.eye) : null;
  if (cam && eye) {
    fwd = new THREE.Vector3(...cam.target).sub(eye).normalize();
    right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-9) right.set(1, 0, 0); else right.normalize();
    up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  } else {
    ({ right, up, fwd } = basis(view, opts.flip ?? false));
  }

  root.updateWorldMatrix(true, true);

  // ---- gather world-space triangles
  const tris: Tri[] = [];
  const bounds = new THREE.Box3();
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3();
  // Three-point-ish rig: a key, a weaker fill from the opposite side, and an ambient
  // floor. Enough to read form without a specular that papers over cracks.
  const key = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();
  const fill = new THREE.Vector3(0.66, 0.22, -0.55).normalize();
  const clay = opts.clay ?? true;

  const collected: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; col: THREE.Color }[] = [];
  root.traverseVisible(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const g = mesh.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const col = (mat as THREE.MeshStandardMaterial)?.color?.clone() ?? new THREE.Color(0xAAAAAA);
    const idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      pa.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      pb.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      pc.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      collected.push({ a: pa.clone(), b: pb.clone(), c: pc.clone(), col });
      bounds.expandByPoint(pa); bounds.expandByPoint(pb); bounds.expandByPoint(pc);
    }
  });
  if (!collected.length) return { rgba: new Uint8Array(width * height * 4), width, height };

  // ---- fit an orthographic window
  const center = opts.focus?.center ?? bounds.getCenter(new THREE.Vector3());
  let halfW: number, halfH: number;
  if (opts.focus) {
    halfW = opts.focus.span / 2;
    halfH = halfW * height / width;
  } else {
    const size = bounds.getSize(new THREE.Vector3());
    const extentX = Math.abs(size.x * right.x) + Math.abs(size.y * right.y) + Math.abs(size.z * right.z);
    const extentY = Math.abs(size.x * up.x) + Math.abs(size.y * up.y) + Math.abs(size.z * up.z);
    const margin = 1.08;
    halfW = Math.max(extentX * margin, extentY * margin * width / height) / 2;
    halfH = halfW * height / width;
  }
  const rel = new THREE.Vector3();
  const project = (p: THREE.Vector3, out: [number, number, number]) => {
    rel.copy(p).sub(center);
    out[0] = (rel.dot(right) / halfW * 0.5 + 0.5) * width;
    out[1] = (0.5 - rel.dot(up) / halfH * 0.5) * height;
    out[2] = rel.dot(fwd);
  };

  const sunDir = opts.sun ? new THREE.Vector3(...opts.sun.dir).normalize() : null;
  const sunPow = opts.sun?.strength ?? 0.78;
  const sunAmb = opts.sun?.ambient ?? 0.26;
  const shadeOf = (a: THREE.Vector3, b2: THREE.Vector3, c: THREE.Vector3): number | null => {
    ab.subVectors(b2, a); ac.subVectors(c, a);
    nrm.crossVectors(ab, ac);
    if (nrm.lengthSq() < 1e-18) return null;
    nrm.normalize();
    if (sunDir) {
      // Hemisphere ambient (sky above, warm bounce below) plus a one-sided sun.
      // Winding is not reliable across the world builders, so the sun term is
      // absolute — but the hemisphere term uses the real up-facing component, which
      // is what separates roof from wall from ground.
      const hemi = sunAmb * (0.62 + 0.38 * (Math.abs(nrm.y) * 0.5 + 0.5));
      return hemi + sunPow * Math.abs(nrm.dot(sunDir)) * (0.55 + 0.45 * (nrm.y * 0.5 + 0.5));
    }
    return 0.30 + 0.62 * Math.abs(nrm.dot(key)) + 0.24 * Math.abs(nrm.dot(fill));
  };
  const paint = (tri: Tri, shade: number, col: THREE.Color) => {
    if (clay) {
      const v = Math.min(255, 214 * shade);
      tri.r = v; tri.g = v * 0.985; tri.b = v * 0.95;
    } else {
      const gg = (c: number) => Math.min(255, 255 * Math.pow(Math.min(1, c * shade * 1.35), 1 / 1.45));
      tri.r = gg(col.r); tri.g = gg(col.g); tri.b = gg(col.b);
    }
  };

  if (cam && eye) {
    // ---- perspective path: view-space, near-clip, then divide.
    // Depth is stored as -1/z, which is linear in screen space, so the existing
    // "smaller wins" z-test stays perspective-correct without touching the scanline loop.
    const focal = 1 / Math.tan((cam.fov ?? 62) * Math.PI / 360);
    const aspect = width / height;
    const NEAR = 0.08;
    const rv = new THREE.Vector3();
    const toView = (p: THREE.Vector3): VView => {
      rv.copy(p).sub(eye);
      return { x: rv.dot(right), y: rv.dot(up), z: rv.dot(fwd) };
    };
    for (const t of collected) {
      const shade = shadeOf(t.a, t.b, t.c);
      if (shade === null) continue;
      const poly = clipNear([toView(t.a), toView(t.b), toView(t.c)], NEAR);
      if (poly.length < 3) continue;
      const sxs: number[] = [], sys: number[] = [], szs: number[] = [];
      for (const v of poly) {
        sxs.push((v.x / v.z * focal / aspect * 0.5 + 0.5) * width);
        sys.push((0.5 - v.y / v.z * focal * 0.5) * height);
        szs.push(-1 / v.z);
      }
      for (let k = 1; k + 1 < poly.length; k++) {
        const tri: Tri = { sx: [sxs[0], sxs[k], sxs[k + 1]], sy: [sys[0], sys[k], sys[k + 1]], sz: [szs[0], szs[k], szs[k + 1]], r: 0, g: 0, b: 0 };
        paint(tri, shade, t.col);
        tris.push(tri);
      }
    }
  } else {

  const tmp: [number, number, number] = [0, 0, 0];
  for (const t of collected) {
    ab.subVectors(t.b, t.a); ac.subVectors(t.c, t.a);
    nrm.crossVectors(ab, ac);
    if (nrm.lengthSq() < 1e-18) continue;
    nrm.normalize();
    // Two-sided lambert: a face pointing away is lit by the fill, not left black.
    const shade = 0.30 + 0.62 * Math.abs(nrm.dot(key)) + 0.24 * Math.abs(nrm.dot(fill));
    const tri: Tri = { sx: [0, 0, 0], sy: [0, 0, 0], sz: [0, 0, 0], r: 0, g: 0, b: 0 };
    project(t.a, tmp); tri.sx[0] = tmp[0]; tri.sy[0] = tmp[1]; tri.sz[0] = tmp[2];
    project(t.b, tmp); tri.sx[1] = tmp[0]; tri.sy[1] = tmp[1]; tri.sz[1] = tmp[2];
    project(t.c, tmp); tri.sx[2] = tmp[0]; tri.sy[2] = tmp[1]; tri.sz[2] = tmp[2];
    if (clay) {
      const v = Math.min(255, 214 * shade);
      tri.r = v; tri.g = v * 0.985; tri.b = v * 0.95;   // faintly warm, so it is not flat grey
    } else {
      // Lift dark finishes into a visible range rather than rendering a black blob.
      const g = (c: number) => Math.min(255, 255 * Math.pow(Math.min(1, c * shade * 1.35), 1 / 1.45));
      tri.r = g(t.col.r); tri.g = g(t.col.g); tri.b = g(t.col.b);
    }
    tris.push(tri);
  }

  }

  // ---- z-buffer scan conversion
  const rgba = new Uint8Array(width * height * 4);
  const skyAt = (y: number): [number, number, number] => {
    if (!opts.sky) return bg;
    const f = y / Math.max(1, height - 1);
    return [
      opts.sky.top[0] + (opts.sky.bottom[0] - opts.sky.top[0]) * f,
      opts.sky.top[1] + (opts.sky.bottom[1] - opts.sky.top[1]) * f,
      opts.sky.top[2] + (opts.sky.bottom[2] - opts.sky.top[2]) * f,
    ];
  };
  for (let y = 0; y < height; y++) {
    const c = skyAt(y);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
    }
  }
  if (!cam && opts.gridStep && opts.gridStep > 0) {
    const step = opts.gridStep;
    for (let gx = Math.ceil(-halfW / step) * step; gx <= halfW; gx += step) {
      const px = Math.round((gx / halfW * 0.5 + 0.5) * width);
      if (px < 0 || px >= width) continue;
      for (let y = 0; y < height; y++) {
        const o = (y * width + px) * 4;
        rgba[o] = 46; rgba[o + 1] = 49; rgba[o + 2] = 56;
      }
    }
    for (let gy = Math.ceil(-halfH / step) * step; gy <= halfH; gy += step) {
      const py = Math.round((0.5 - gy / halfH * 0.5) * height);
      if (py < 0 || py >= height) continue;
      for (let x = 0; x < width; x++) {
        const o = (py * width + x) * 4;
        rgba[o] = 46; rgba[o + 1] = 49; rgba[o + 2] = 56;
      }
    }
  }

  const haze = cam ? opts.haze : undefined;
  const depth = new Float32Array(width * height).fill(Infinity);
  for (const t of tris) {
    const minX = Math.max(0, Math.floor(Math.min(t.sx[0], t.sx[1], t.sx[2])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(t.sx[0], t.sx[1], t.sx[2])));
    const minY = Math.max(0, Math.floor(Math.min(t.sy[0], t.sy[1], t.sy[2])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(t.sy[0], t.sy[1], t.sy[2])));
    if (minX > maxX || minY > maxY) continue;
    const x0 = t.sx[0], y0 = t.sy[0], x1 = t.sx[1], y1 = t.sy[1], x2 = t.sx[2], y2 = t.sy[2];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-12) continue;
    const inv = 1 / area;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * t.sz[0] + w1 * t.sz[1] + w2 * t.sz[2];
        const o = y * width + x;
        if (z >= depth[o]) continue;
        depth[o] = z;
        let cr = t.r, cg = t.g, cb = t.b;
        if (haze) {
          // z is -1/viewZ on the perspective path, so recover metres and fade to sky.
          const vz = -1 / z;
          const f = Math.max(0, Math.min(1, (vz - haze.start) / (haze.end - haze.start)));
          if (f > 0) {
            const sc = skyAt(y);
            cr += (sc[0] - cr) * f; cg += (sc[1] - cg) * f; cb += (sc[2] - cb) * f;
          }
        }
        rgba[o * 4] = cr; rgba[o * 4 + 1] = cg; rgba[o * 4 + 2] = cb; rgba[o * 4 + 3] = 255;
      }
    }
  }
  return { rgba, width, height };
}
