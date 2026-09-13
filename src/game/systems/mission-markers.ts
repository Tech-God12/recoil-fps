import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AABB, World } from '../world';
import type { MissionDefinition, MissionPhase } from './mission';

export const MISSION_VISUAL_BUDGET = { draws: 5, triangles: 640 } as const;

/** One cache and one ground perimeter. No new lights, post effects, or per-frame geometry. */
export class MissionMarkers {
  readonly group = new THREE.Group();
  readonly cache: THREE.Mesh;
  readonly charge: THREE.Mesh;
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
    const chargeParts=[
      new THREE.BoxGeometry(0.44,0.26,0.12),
      new THREE.BoxGeometry(0.14,0.12,0.035).translate(0.08,0.02,0.075),
      new THREE.BoxGeometry(0.035,0.29,0.14).translate(-0.15,0,0),
      new THREE.BoxGeometry(0.035,0.29,0.14).translate(0.15,0,0),
    ];
    for(let i=0;i<4;i++) chargeParts.push(new THREE.BoxGeometry(0.014,0.018,0.004).translate(0.034+i*0.03,0.02,0.096));
    chargeParts.forEach((geometry,index)=>{
      const color=new THREE.Color(index===0?0x697354:index===1?0x0c171b:index<4?0x30363b:0xff8647);
      const colors=new Float32Array(geometry.attributes.position.count*3);
      for(let i=0;i<colors.length;i+=3) {colors[i]=color.r;colors[i+1]=color.g;colors[i+2]=color.b;}
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    });
    this.charge=new THREE.Mesh(mergeGeometries(chargeParts)!,new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.7,emissive:0xff713b,emissiveIntensity:0}));
    chargeParts.forEach(g=>g.dispose());
    this.charge.position.set(phase.at[0],phase.at[1]+0.74,phase.at[2]+0.64);
    this.charge.visible=false; this.charge.name='Placed demolition charge';
    this.group.add(this.charge);
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
    const defense = definition.phases.find(p => p.type === 'defend');
    if (defense) {
      const parts = [
        new THREE.BoxGeometry(1.2,0.55,0.8).translate(0,0.28,0),
        new THREE.BoxGeometry(0.8,0.5,0.5).translate(0,0.8,0),
        new THREE.CylinderGeometry(0.025,0.035,2.4,6).translate(0.4,1.6,0),
        new THREE.BoxGeometry(0.7,0.06,0.06).translate(0.4,2.7,0),
      ];
      const relay = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({color:0x488d88,roughness:0.65,metalness:0.25}));
      parts.forEach(g => g.dispose());
      relay.position.set(...defense.at); relay.castShadow = true;
      this.group.add(relay); world.occluders.push(relay);
      world.solids.push({minX:defense.at[0]-.6,maxX:defense.at[0]+.6,minY:defense.at[1],maxY:defense.at[1]+1.05,minZ:defense.at[2]-.4,maxZ:defense.at[2]+.4});
    }
    this.group.updateMatrixWorld(true);
  }

  setPhase(phase: MissionPhase) {
    this.perimeter.visible = true;
    this.perimeter.position.set(phase.at[0], phase.at[1] + 0.06, phase.at[2]);
    this.perimeter.scale.setScalar(phase.radius);
    (this.perimeter.material as THREE.MeshBasicMaterial).color.setHex(phase.type === 'extract' ? 0x8cdbc2 : phase.type === 'destroy' ? 0xff8b50 : phase.type === 'defend' ? 0x62b9e2 : phase.type === 'clear' ? 0xe2bb79 : 0xbddde0);
    this.perimeter.updateMatrixWorld(true);
  }

  setCharge(progress: number, armed: boolean, elapsed: number) {
    if (!this.cache.visible) { this.charge.visible=false; return; }
    this.charge.visible=progress>0 || armed;
    this.charge.scale.setScalar(0.75+Math.min(1,progress)*0.25);
    const material=this.charge.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity=armed ? 0.06+Math.sin(elapsed*8)*0.025 : 0;
    (this.bands.material as THREE.MeshStandardMaterial).color.setHex(armed?0xe4783a:0xc6a45a);
  }

  setContested(contested: boolean) {
    (this.perimeter.material as THREE.MeshBasicMaterial).color.setHex(contested ? 0xff654b : 0x8cdbc2);
  }

  destroyCache(world: World) {
    this.cache.visible = false; this.bands.visible = false; this.charge.visible=false;
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