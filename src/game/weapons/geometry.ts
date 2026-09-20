// Continuous, bevelled solids instead of stacks of intersecting detail boxes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { MeshBVH } from 'three-mesh-bvh';
import { Brush, Evaluator, HalfEdgeMap, SUBTRACTION } from 'three-bvh-csg';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A side-profile point in gun coordinates: [Z (rearward), Y (up)]. */
export type Profile = readonly (readonly [number, number])[];
export type Point3 = readonly [number, number, number];

export interface MillCut {
  x: number; y: number; z: number; w: number; h: number; d: number;
  radius?: number; bore?: boolean; path?: Profile; rx?: number; ry?: number; rz?: number;
}
// The CSG package still uses the deprecated maxLeafSize spelling. Our single-threaded,
// single-material brushes use the current BVH API without patching global/library code.
class MillingBrush extends Brush {
  override prepareGeometry(): void {
    const geometry = this.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH; halfEdges?: HalfEdgeMap; groupIndices?: Uint16Array };
    if (geometry.boundsTree && geometry.halfEdges) return;
    geometry.boundsTree = new MeshBVH(geometry, { targetLeafSize: 3, indirect: true });
    geometry.halfEdges = new HalfEdgeMap(); geometry.halfEdges.updateFrom(geometry);
    geometry.groupIndices = new Uint16Array((geometry.index?.count ?? geometry.attributes.position.count) / 3);
  }
}
const machinedCache = new Map<string, THREE.BufferGeometry>();
const milling = new Evaluator();
milling.useGroups = false;
milling.attributes = ['position', 'normal', 'uv', 'weaponSurface', 'weaponCavity'];
function cavityAttribute(geometry: THREE.BufferGeometry, value = 1): void {
  geometry.setAttribute('weaponCavity', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(value), 1));
}

interface Piece {
  start: number;
  count: number;
  name: string;
  bounds: number[];
}

/** Round only real corners, retaining long straight runs and sampled magazine curves. */
function roundedPath(points: readonly THREE.Vector2[], radius: number, shape = false): THREE.Path {
  const path = shape ? new THREE.Shape() : new THREE.Path();
  const corners = points.map((p, i) => {
    const a = points[(i + points.length - 1) % points.length].clone().sub(p);
    const b = points[(i + 1) % points.length].clone().sub(p);
    const r = Math.min(radius, a.length() * 0.22, b.length() * 0.22);
    const curved = a.clone().normalize().dot(b.clone().normalize()) > -0.94 && r > 0.0001;
    return { p, in: curved ? p.clone().add(a.normalize().multiplyScalar(r)) : p,
      out: curved ? p.clone().add(b.normalize().multiplyScalar(r)) : p, curved };
  });
  path.moveTo(corners[0].in.x, corners[0].in.y);
  for (const c of corners) {
    path.lineTo(c.in.x, c.in.y);
    if (c.curved) path.quadraticCurveTo(c.p.x, c.p.y, c.out.x, c.out.y);
  }
  path.closePath();
  return path;
}

/** Precise smoothing for millimetre-scale bevels (the stock utility quantizes at 1 cm). */
function smoothBevels(geometry: THREE.BufferGeometry): void {
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const adjacent = new Map<string, { x: number; y: number; z: number; weight: number }[]>();
  const key = (i: number) => `${Math.round(position.getX(i) * 1e6)},${Math.round(position.getY(i) * 1e6)},${Math.round(position.getZ(i) * 1e6)}`;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    va.fromBufferAttribute(position, i); vb.fromBufferAttribute(position, i + 1); vc.fromBufferAttribute(position, i + 2);
    const weight = Math.sqrt(vb.sub(va).cross(vc.sub(va)).length());
    for (let j = i; j < i + 3; j++) {
      const k = key(j), list = adjacent.get(k) ?? [];
      list.push({ x: normal.getX(j), y: normal.getY(j), z: normal.getZ(j), weight }); adjacent.set(k, list);
    }
  }
  const result = new Float32Array(normal.count * 3);
  for (let i = 0; i < position.count; i++) {
    let x = 0, y = 0, z = 0;
    for (const n of adjacent.get(key(i))!) {
      if (n.x * normal.getX(i) + n.y * normal.getY(i) + n.z * normal.getZ(i) < 0.48) continue;
      x += n.x * n.weight; y += n.y * n.weight; z += n.z * n.weight;
    }
    const length = Math.hypot(x, y, z) || 1;
    result.set([x / length, y / length, z / length], i * 3);
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(result, 3));
}

/** Bake a mask on the bevel faces only; large flat faces must not turn into silver plates. */
function wearMask(geometry: THREE.BufferGeometry, axis: 'x' | 'y' | 'box' | 'none'): void {
  const n = geometry.attributes.normal, values = new Float32Array(n.count * 2);
  for (let i = 0; i < n.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    const c = axis === 'x' ? nx : ny;
    values[i * 2] = axis === 'none' ? 0 : axis === 'box' ? Math.min(1, (1 - Math.max(nx, ny, nz)) * 3.2) : 4 * c * (1 - c);
    values[i * 2 + 1] = 0.82;
  }
  geometry.setAttribute('weaponSurface', new THREE.BufferAttribute(values, 2));
}

/** One draw per material per moving assembly. Source-piece ranges support geometry QA. */
export class GunBuilder {
  private buckets = new Map<THREE.Material, { geometry: THREE.BufferGeometry; name: string }[]>();
  private partName = '';
  private latest: { geometry: THREE.BufferGeometry; name: string } | null = null;
  name(name: string): this { this.partName = name; return this; }

  private put(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, preserveUV = false) {
    if (geometry.index) {
      const indexed = geometry;
      geometry = indexed.toNonIndexed();
      indexed.dispose();
    }
    if (!geometry.hasAttribute('weaponCavity')) cavityAttribute(geometry);
    if (!geometry.hasAttribute('weaponSurface')) wearMask(geometry, 'none');
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    if (!preserveUV && material.userData.finish) {
      let seed = 17;
      for (const c of this.partName) seed = Math.imul(seed, 31) ^ c.charCodeAt(0);
      const shade = 0.63 + ((seed >>> 0) % 101) / 101 * 0.35;
      const surface = geometry.attributes.weaponSurface;
      for (let i = 0; i < surface.count; i++) surface.setY(i, shade);
    }
    // World-density box projection: no stretched grain on narrow stock/receiver faces.
    if (!preserveUV && material.userData.finish) {
      const pos = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
      const style = material.userData.finish as { tile: number; kind: string };
      geometry.computeBoundingBox();
      const size = geometry.boundingBox!.getSize(new THREE.Vector3());
      const uprightWood = style.kind.includes('Wood') || (style.kind === 'wood' && size.y > size.z * 1.3);
      const tile = style.tile;
      for (let i = 0; i < pos.count; i += 3) {
        const nx = Math.abs(normal.getX(i) + normal.getX(i + 1) + normal.getX(i + 2));
        const ny = Math.abs(normal.getY(i) + normal.getY(i + 1) + normal.getY(i + 2));
        const nz = Math.abs(normal.getZ(i) + normal.getZ(i + 1) + normal.getZ(i + 2));
        for (let j = i; j < i + 3; j++) {
          if (nx >= ny && nx >= nz) uv.setXY(j, (uprightWood ? -pos.getY(j) : -pos.getZ(j)) / tile, (uprightWood ? pos.getZ(j) : pos.getY(j)) / tile);
          else if (ny >= nz) uv.setXY(j, -pos.getZ(j) / tile, pos.getX(j) / tile);
          else uv.setXY(j, pos.getX(j) / tile, pos.getY(j) / tile);
        }
      }
    }
    let bucket = this.buckets.get(material);
    if (!bucket) { bucket = []; this.buckets.set(material, bucket); }
    this.latest = { geometry, name: this.partName || geometry.type };
    bucket.push(this.latest);
    return this;
  }

  /** True blind pockets / through cuts. Cached per source shape, never recomputed while orbiting. */
  mill(cuts: readonly MillCut[]): this {
    if (!this.latest || cuts.length === 0) return this;
    const entry = this.latest, original = entry.geometry;
    let hash = 2166136261;
    for (const value of original.attributes.position.array) hash = Math.imul(hash ^ Math.round(value * 1e7), 16777619);
    for (const value of original.attributes.uv.array) hash = Math.imul(hash ^ Math.round(value * 1e6), 16777619);
    const key = `${entry.name}:${hash}:${JSON.stringify(cuts)}`;
    const cached = machinedCache.get(key);
    if (cached) { entry.geometry = cached.clone(); original.dispose(); return this; }
    let solid = new MillingBrush(original.clone()); solid.updateMatrixWorld(true);
    for (const cut of cuts) {
      const r = cut.radius ?? Math.min(cut.w, cut.h, cut.d) * 0.18;
      const geo = cut.path
        ? new THREE.ExtrudeGeometry(roundedPath(cut.path.map(([z,y])=>new THREE.Vector2(-z,y)),r,true) as THREE.Shape, {depth:cut.w,bevelEnabled:true,bevelSize:r*.35,bevelThickness:r*.35,bevelSegments:2,curveSegments:4}).translate(0,0,-cut.w/2).rotateY(Math.PI/2)
        : cut.bore
        ? new THREE.CylinderGeometry(cut.h / 2, cut.h / 2, cut.w, 24).rotateZ(Math.PI / 2)
        : new RoundedBoxGeometry(cut.w, cut.h, cut.d, r >= .003 ? 2 : 1, r);
      wearMask(geo, cut.path ? 'x' : 'box'); cavityAttribute(geo, 0.38);
      const tool = new MillingBrush(geo); tool.position.set(cut.x, cut.y, cut.z);
      tool.rotation.set(cut.rx ?? 0, cut.ry ?? 0, cut.rz ?? 0); tool.updateMatrixWorld(true);
      const previous = solid; solid = milling.evaluate(solid, tool, SUBTRACTION, new MillingBrush()); solid.updateMatrixWorld(true);
      previous.disposeCacheData(); previous.geometry.dispose(); tool.disposeCacheData(); geo.dispose();
    }
    const result = solid.geometry.index ? solid.geometry.toNonIndexed() : solid.geometry.clone();
    result.clearGroups();
    // Re-project cutter walls at the same density as the parent surface.
    const p = result.attributes.position, n = result.attributes.normal, uv = result.attributes.uv;
    const originalP = original.attributes.position, originalUV = original.attributes.uv;
    let density = 1;
    for (let i = 1; i < originalP.count; i++) {
      const dz = originalP.getZ(i) - originalP.getZ(0);
      if (Math.abs(dz) > 0.01) { density = Math.abs((originalUV.getX(i) - originalUV.getX(0)) / dz) || 1; break; }
    }
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(n.getX(i)) > Math.abs(n.getY(i)) && Math.abs(n.getX(i)) > Math.abs(n.getZ(i))) uv.setXY(i, -p.getZ(i) * density, p.getY(i) * density);
      else if (Math.abs(n.getY(i)) > Math.abs(n.getZ(i))) uv.setXY(i, -p.getZ(i) * density, p.getX(i) * density);
      else uv.setXY(i, p.getX(i) * density, p.getY(i) * density);
    }
    solid.disposeCacheData(); solid.geometry.dispose(); original.dispose();
    result.computeBoundingBox(); result.computeBoundingSphere();
    if (machinedCache.size >= 128) {
      const oldest = machinedCache.keys().next().value!;
      machinedCache.get(oldest)!.dispose(); machinedCache.delete(oldest);
    }
    machinedCache.set(key, result.clone()); entry.geometry = result;
    return this;
  }

  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    const radius = Math.min(w, h, d, 0.020) * 0.16;
    const geo = Math.max(w, h, d) < 0.012 || Math.min(w, h, d) < 0.0012
      ? new THREE.BoxGeometry(w, h, d)
      : new RoundedBoxGeometry(w, h, d, Math.min(w, h, d) >= 0.010 ? 3 : Math.min(w, h, d) >= 0.006 ? 2 : 1, radius);
    wearMask(geo, 'box');
    return this.put(geo, mat, x, y, z, rx, ry, rz);
  }

  cyl(rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, seg = 28, open = false) {
    const segments = Math.max(seg, Math.max(rt, rb) >= 0.009 ? 36 : seg);
    const edge = Math.min(rt, rb, h * 0.2, 0.0007);
    const geo = !open && edge > 0.0003
      ? new THREE.LatheGeometry([[0, -h / 2], [rb - edge, -h / 2], [rb, -h / 2 + edge], [rt, h / 2 - edge], [rt - edge, h / 2], [0, h / 2]].map(([r, y]) => new THREE.Vector2(r, y)), segments)
      : new THREE.CylinderGeometry(rt, rb, h, segments, 1, open);
    wearMask(geo, 'y');
    return this.put(geo, mat, x, y, z, rx, ry, rz);
  }

  sph(r: number, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
    const geo = new THREE.SphereGeometry(r, 16, 10);
    geo.scale(sx, sy, sz);
    return this.put(geo, mat, x, y, z);
  }

  /** Extruded side outline, with optional real holes (guards / skeleton stocks). */
  profile(points: Profile, width: number, mat: THREE.Material, x = 0, bevel = 0.0008, holes: readonly Profile[] = []) {
    const outline = (points: Profile) => points.map(([z, y]) => new THREE.Vector2(-z, y));
    const edge = Math.min(bevel, width * 0.2);
    const shape = roundedPath(outline(points), edge * 1.8, true) as THREE.Shape;
    for (const hole of holes) shape.holes.push(roundedPath(outline(hole), edge * 1.25));
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: width - edge * 2, steps: 1, bevelEnabled: edge > 0,
      bevelThickness: edge, bevelSize: edge, bevelSegments: edge > 0.0006 ? 3 : 1, curveSegments: 4,
    });
    // Extrusion Z becomes thickness X. Shape X becomes gun -Z.
    geo.translate(0, 0, -width / 2 + edge);
    geo.rotateY(Math.PI / 2);
    wearMask(geo, 'x');
    if (edge > 0.0006) smoothBevels(geo);
    return this.put(geo, mat, x, 0, 0);
  }

  /** Sculpted furniture: a continuous, smoothly varying rounded cross-section, not a flat extrusion.
   * Stations are [Z, top, bottom, full width]. The Y variant maps Z to downward grip travel.
   */
  loft(stations: readonly (readonly [number, number, number, number])[], mat: THREE.Material, exponent = 0.45, x = 0, axis: 'z' | 'y' = 'z') {
    const rings: number[][] = [], sides = 32, subdivisions = 4;
    for (let i = 0; i < stations.length - 1; i++) {
      for (let j = 0; j < subdivisions; j++) {
        const t = j / subdivisions, u = t * t * (3 - 2 * t);
        rings.push(stations[i].map((v, k) => THREE.MathUtils.lerp(v, stations[i + 1][k], k === 0 ? t : u)));
      }
    }
    rings.push([...stations[stations.length - 1]]);
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const point = (px: number, py: number, pz: number) => {
      positions.push(px, axis === 'y' ? -pz : py, axis === 'y' ? py : pz);
      uvs.push(-pz, py);
    };
    for (const [z, top, bottom, width] of rings) {
      for (let j = 0; j < sides; j++) {
        const theta = j / sides * Math.PI * 2, c = Math.cos(theta), s = Math.sin(theta);
        point(Math.sign(c) * Math.pow(Math.abs(c), exponent) * width / 2,
          (top + bottom) / 2 + Math.sign(s) * Math.pow(Math.abs(s), exponent) * (top - bottom) / 2, z);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides, c = b + sides, d = a + sides;
      indices.push(a, b, d, b, c, d);
    }
    for (const [ring, forward] of [[0, false], [rings.length - 1, true]] as const) {
      const [z, top, bottom] = rings[ring], center = positions.length / 3;
      point(0, (top + bottom) / 2, z);
      for (let j = 0; j < sides; j++) {
        const a = ring * sides + j, b = ring * sides + (j + 1) % sides;
        indices.push(center, forward ? a : b, forward ? b : a);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(indices);
    geo.computeVertexNormals(); wearMask(geo, 'none');
    return this.put(geo, mat, x, 0, 0);
  }

  /** A machined cross-section extruded along Z (slides / octagonal receivers). */
  section(points: readonly (readonly [number, number])[], length: number, mat: THREE.Material, x: number, y: number, z: number, bore?: { y: number; radius: number }) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    if (bore) {
      const hole = new THREE.Path();
      hole.absarc(0, bore.y, bore.radius, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const edge = Math.min(0.00065, length * 0.08);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: length - 2 * edge, steps: 1, bevelEnabled: true, bevelThickness: edge, bevelSize: edge, bevelSegments: edge > 0.0006 ? 3 : 1, curveSegments: bore && bore.radius > .014 ? 12 : 20 });
    geo.translate(0, 0, -length / 2 + edge);
    // Keep the mounting envelope unchanged despite the bevel expansion.
    geo.computeBoundingBox();
    const bb = geo.boundingBox!, desired = new THREE.Box2().setFromPoints(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const extent = bb.getSize(new THREE.Vector3());
    const center = bb.getCenter(new THREE.Vector3()), ds = desired.getSize(new THREE.Vector2()), dc = desired.getCenter(new THREE.Vector2());
    geo.translate(-center.x, -center.y, 0);
    geo.scale(ds.x / extent.x, ds.y / extent.y, 1);
    geo.translate(dc.x, dc.y, 0);
    wearMask(geo, 'box');
    smoothBevels(geo);
    return this.put(geo, mat, x, y, z);
  }

  /** A closed-walled hollow tube, including annular end faces; never a capped bore. */
  tube(outer: number, inner: number, length: number, mat: THREE.Material, x: number, y: number, z: number, rx = Math.PI / 2, ry = 0, rz = 0, segments = 24) {
    const h = length / 2, edge = Math.min((outer - inner) * 0.22, length * 0.1, 0.0005);
    const points = [[inner, -h + edge], [inner + edge, -h], [outer - edge, -h], [outer, -h + edge], [outer, h - edge], [outer - edge, h], [inner + edge, h], [inner, h - edge], [inner, -h + edge]];
    const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), Math.max(segments, outer > 0.012 ? 40 : outer > 0.006 ? 28 : 16));
    wearMask(geo, 'y');
    return this.put(geo, mat, x, y, z, rx, ry, rz);
  }

  /** Turned profile along the barrel axis: [radius, Z], useful for bell-shaped optics. */
  turned(points: readonly (readonly [number, number])[], mat: THREE.Material, x: number, y: number, z: number, segments = 28) {
    const geo = new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(r, z)), Math.max(segments, 40));
    wearMask(geo, 'y');
    return this.put(geo, mat, x, y, z, Math.PI / 2);
  }

  /** Endpoint-defined strut: both ends seat on their pivots, even on angled parts. */
  rod(a: Point3, b: Point3, radius: number, mat: THREE.Material, endRadius = radius, segments = 12) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const geo = new THREE.CylinderGeometry(endRadius, radius, direction.length(), segments);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    const center = start.add(end).multiplyScalar(0.5);
    return this.put(geo, mat, center.x, center.y, center.z);
  }

  /** Allows UV-mapped surface engravings to share the same batching path. */
  surface(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    return this.put(geo, mat, x, y, z, rx, ry, rz, true);
  }

  build(parent: THREE.Object3D) {
    for (const [mat, entries] of this.buckets) {
      const pieces: Piece[] = [];
      let start = 0;
      for (const { geometry, name } of entries) {
        const positions = geometry.attributes.position;
        const sources = geometry.userData.pieces as Piece[] | undefined;
        if (sources?.length) {
          // Rebatching (e.g. coupled magazines) must retain EACH original solid.
          // Recompute bounds because the source assembly may have been transformed.
          const point = new THREE.Vector3();
          for (const piece of sources) {
            const box = new THREE.Box3();
            for (let i = piece.start; i < piece.start + piece.count; i++) box.expandByPoint(point.fromBufferAttribute(positions, i));
            pieces.push({ ...piece, start: start + piece.start, bounds: [...box.min.toArray(), ...box.max.toArray()] });
          }
        } else {
          geometry.computeBoundingBox();
          const box = geometry.boundingBox!;
          pieces.push({ start, count: positions.count, name, bounds: [...box.min.toArray(), ...box.max.toArray()] });
        }
        start += positions.count;
      }
      const merged = mergeGeometries(entries.map(e => e.geometry), false)!;
      for (const { geometry } of entries) geometry.dispose();
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      merged.userData.pieces = pieces;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${parent.name || 'weapon'} / ${mat.name || mat.type}`;
      parent.add(mesh);
    }
    this.buckets.clear();
  }
}

/** Batch a rigid arm without changing its animation pivot or sharing owned geometry. */
export function batchRigidGroup(root: THREE.Group): void {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const b = new GunBuilder();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    b.surface(geo, mesh.material, 0, 0, 0);
    mesh.geometry.dispose();
  });
  root.clear();
  b.build(root);
}

/** Gun-local bounds of rendered geometry only; hidden arms/stock cannot shrink the showcase. */
export function weaponBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || o.userData.arm) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.computeBoundingBox();
      const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));
    }
    o.children.forEach(visit);
  };
  visit(root);
  return bounds;
}
