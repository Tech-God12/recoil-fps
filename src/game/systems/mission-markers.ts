import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AABB, World } from '../world';
import type { MissionDefinition, MissionPhase } from './mission';

export const MISSION_VISUAL_BUDGET = { draws: 4, triangles: 512 } as const;

/** One cache and one ground perimeter. No new lights, post effects, or per-frame geometry. */
export class MissionMarkers {
  readonly group = new THREE.Group();
  readonly cache: THREE.Mesh;
  private bands: THREE.Mesh;
  private perimeter: THREE.Mesh;
  private cacheBounds: AABB;

  constructor(scene: THREE.Scene, world: World, definition: MissionDefinition) {
    const phase = definition.phases.find(p => p.type === 'destroy')!;
    this.cache = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 1.1), new THREE.MeshStandardMaterial({ color: 0x343c34, roughness: 0.88 }));
    this.cache.position.set(phase.at[0], phase.at[1] + 0.53, phase.at[2]);
    this.cache.receiveShadow = true;
    this.cache.userData.missionCache = true;
    const strips = [-0.55, 0.55].map(x => new THREE.BoxGeometry(0.1, 1.065, 1.115).translate(x, 0, 0));
    this.bands = new THREE.Mesh(mergeGeometries(strips)!, new THREE.MeshStandardMaterial({ color: 0xc6a45a, roughness: 0.84 }));
    for (const strip of strips) strip.dispose();
    this.bands.position.copy(this.cache.position);
    this.perimeter = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 48), new THREE.MeshBasicMaterial({ color: 0xf2c678, transparent: true, opacity: 0.34, depthWrite: false }));
    this.perimeter.rotation.x = -Math.PI / 2;
    this.perimeter.visible = false;
    this.group.add(this.cache, this.bands, this.perimeter);
    scene.add(this.group);
    this.cacheBounds = {
      minX: phase.at[0] - 0.9, maxX: phase.at[0] + 0.9,
      minY: phase.at[1], maxY: phase.at[1] + 1.06,
      minZ: phase.at[2] - 0.55, maxZ: phase.at[2] + 0.55,
    };
    world.solids.push(this.cacheBounds);
    world.occluders.push(this.cache);
    this.group.updateMatrixWorld(true);
  }

  setPhase(phase: MissionPhase) {
    this.perimeter.visible = true;
    this.perimeter.position.set(phase.at[0], phase.at[1] + 0.06, phase.at[2]);
    this.perimeter.scale.setScalar(phase.radius);
    (this.perimeter.material as THREE.MeshBasicMaterial).color.setHex(phase.type === 'extract' ? 0x8cdbc2 : 0xf2c678);
    this.perimeter.updateMatrixWorld(true);
  }

  destroyCache(world: World) {
    this.cache.visible = false; this.bands.visible = false;
    const i = world.occluders.indexOf(this.cache);
    if (i !== -1) world.occluders.splice(i, 1);
    // Keep spatial-hash references valid while disabling this collision box.
    this.cacheBounds.minY = 10000;
    this.cacheBounds.maxY = 10001;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) material.dispose();
    });
  }
}