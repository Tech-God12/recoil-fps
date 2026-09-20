// Geometry-level assembly checks: not just parent/child membership or overlapping AABBs.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const identity = new THREE.Matrix4();

function visitSolids(root, callback) {
  const visit = object => {
    if (!object.visible || object.userData.arm || object.userData.adsHide) return;
    if (object.isMesh) callback(object);
    object.children.forEach(visit);
  };
  root.updateWorldMatrix(true, true);
  visit(root);
}

/** Extract the actual pre-batch solids, preserving their current assembly transforms. */
export function solidPieces(root) {
  const pieces = [];
  visitSolids(root, mesh => {
    for (const part of mesh.geometry.userData.pieces ?? []) {
      if (part.name === 'surface engraving') continue;
      const geometry = new THREE.BufferGeometry();
      const vertices = mesh.geometry.attributes.position.array.slice(part.start * 3, (part.start + part.count) * 3);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.applyMatrix4(mesh.matrixWorld);
      geometry.computeBoundingBox();
      geometry.boundsTree = new MeshBVH(geometry, { targetLeafSize: 12 });
      pieces.push({
        name: `${mesh.parent.name}: ${part.name}`, geometry, bounds: geometry.boundingBox,
        probe: new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, 0),
      });
    }
  });
  return pieces;
}

function boundsGap(a, b) {
  return Math.hypot(
    Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x),
    Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y),
    Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z),
  );
}

/** Returns solid pieces without a physical connection to the rest of the weapon.
 * 0.55 mm accommodates bevel/float precision, not centimetre-sized floating fixtures.
 * Enclosed pieces (e.g. a seated pin) count as mounted. Optical/decal surfaces and arms
 * are intentionally outside this solid-contact test.
 */
export function disconnectedSolids(root, tolerance = 0.00055) {
  const pieces = solidPieces(root);
  try {
    if (!pieces.length) return ['no solid weapon geometry'];
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0.923, 0.371, 0.103).normalize());
    const inside = (point, solid) => {
      if (!solid.bounds.containsPoint(point)) return false;
      ray.origin.copy(point);
      const hit = solid.geometry.boundsTree.raycastFirst(ray, THREE.DoubleSide, 1e-7);
      return hit && hit.face.normal.dot(ray.direction) > 0;
    };
    const touches = (a, b) => {
      if (boundsGap(a.bounds, b.bounds) > tolerance) return false;
      // Symmetric narrow phase avoids one-sided pruning at coplanar annular contacts.
      const near = a.geometry.boundsTree.closestPointToGeometry(b.geometry, identity, {}, {}, tolerance);
      if (near && near.distance <= tolerance) return true;
      const reverse = b.geometry.boundsTree.closestPointToGeometry(a.geometry, identity, {}, {}, tolerance);
      return (reverse && reverse.distance <= tolerance) || inside(a.probe, b) || inside(b.probe, a);
    };
    const rootPiece = pieces.reduce((a, b) => a.bounds.getSize(new THREE.Vector3()).lengthSq() > b.bounds.getSize(new THREE.Vector3()).lengthSq() ? a : b);
    const connected = new Set([rootPiece]), queue = [rootPiece];
    for (const piece of queue) {
      for (const candidate of pieces) if (!connected.has(candidate) && touches(piece, candidate)) {
        connected.add(candidate); queue.push(candidate);
      }
    }
    return pieces.filter(piece => !connected.has(piece)).map(piece => piece.name);
  } finally {
    pieces.forEach(piece => piece.geometry.dispose());
  }
}

function assemblyGeometry(root) {
  const parts = [];
  visitSolids(root, mesh => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', mesh.geometry.attributes.position.clone());
    if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
    geometry.applyMatrix4(mesh.matrixWorld);
    if (geometry.index) {
      parts.push(geometry.toNonIndexed()); geometry.dispose();
    } else parts.push(geometry);
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach(geometry => geometry.dispose());
  merged.computeBoundingBox();
  return merged;
}

/** Deliberate seating overlaps are tested elsewhere. This is for unrelated attachments. */
export function assembliesInterfere(a, b) {
  const ga = assemblyGeometry(a), gb = assemblyGeometry(b);
  try {
    const overlap = ga.boundingBox.clone().intersect(gb.boundingBox).getSize(new THREE.Vector3());
    if (Math.min(overlap.x, overlap.y, overlap.z) <= 0.001) return false;
    return new MeshBVH(ga).intersectsGeometry(gb, identity);
  } finally {
    ga.dispose(); gb.dispose();
  }
}

export function disposeWeapon(model) {
  model.group.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
}
