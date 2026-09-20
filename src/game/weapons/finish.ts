import * as THREE from 'three';
import { makeDistressTexture } from './distress';
import steelColor from '../../assets/weapons/steel-color.webp';
import steelRoughness from '../../assets/weapons/steel-roughness.webp';
import walnutColor from '../../assets/weapons/walnut-color.webp';
import walnutRoughness from '../../assets/weapons/walnut-roughness.webp';

export type FinishKind = 'steel' | 'polymer' | 'wood' | 'checkeredWood' | 'grip' | 'rubber';
interface FinishStyle { kind: FinishKind; tile: number; wear: number; wearColor: number }

const pending: Promise<void>[] = [];
const distress = makeDistressTexture();
function imageTexture(url: string, srgb = false): THREE.Texture {
  const texture = new THREE.Texture();
  texture.name = url.split('/').pop()!;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  if (typeof document !== 'undefined' && typeof document.createElementNS === 'function') {
    pending.push(new Promise(resolve => {
      new THREE.ImageLoader().load(url, image => {
        texture.image = image; texture.needsUpdate = true; resolve();
      }, undefined, () => {
        // A readable neutral fallback, not a black/incomplete GPU texture.
        texture.image = { data: new Uint8Array([190, 190, 190, 255]), width: 1, height: 1 };
        Object.assign(texture, { isDataTexture: true });
        texture.needsUpdate = true; resolve();
      });
    }));
  }
  return texture;
}

function microSurface(checkered: boolean): THREE.DataTexture {
  const size = 512, bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = (Math.imul(x + 23, 374761393) ^ Math.imul(y + 7, 668265263)) >>> 0;
    const noise = (h % 1024) / 1024;
    const diamond = Math.max(0, 1 - Math.abs((x % 32) / 16 - 1) - Math.abs((y % 32) / 16 - 1));
    const value = checkered ? 85 + Math.min(1, diamond * 1.9) * 145 + noise * 9 : 218 + noise * 31;
    const i = (y * size + x) * 4;
    bytes[i] = bytes[i + 1] = bytes[i + 2] = value; bytes[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size);
  texture.name = checkered ? 'cut diamond checkering' : 'fine moulded polymer stipple';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}

const metal = imageTexture(steelColor, true), metalRough = imageTexture(steelRoughness);
const walnut = imageTexture(walnutColor, true), walnutRough = imageTexture(walnutRoughness);
const stipple = microSurface(false), diamonds = microSurface(true);
const woodDiamonds = diamonds.clone(); woodDiamonds.repeat.setScalar(8);
let texturesReady = false;
export const weaponTexturesReady = Promise.all(pending).then(() => { texturesReady = true; });
export function areWeaponTexturesReady(): boolean { return texturesReady; }

/** Physical finish with geometry-local, broken edge wear. Prototype hooks survive clone().
 * The wear mask comes only from real bevels — never a bright outline painted over the gun.
 * PBR lighting, skin changes, transparency and the normal Three material lifecycle still work.
 */
export class WeaponFinish extends THREE.MeshStandardMaterial {
  constructor(parameters: THREE.MeshStandardMaterialParameters = {}, kind: FinishKind = 'steel') {
    super(parameters);
    const wood = kind === 'wood' || kind === 'checkeredWood';
    const grip = kind === 'grip' || kind === 'checkeredWood';
    this.map = wood ? walnut : kind === 'grip' || kind === 'rubber' ? stipple : metal;
    this.roughnessMap = wood ? walnutRough : metalRough;
    this.bumpMap = kind === 'checkeredWood' ? woodDiamonds : grip ? diamonds : wood ? walnutRough : kind === 'steel' ? metalRough : stipple;
    this.bumpScale = kind === 'checkeredWood' ? 0.00032 : grip ? 0.00020 : wood ? 0.00008 : kind === 'steel' ? 0.00011 : 0.000065;
    this.userData.finish = {
      kind, tile: wood ? 0.22 : grip ? 0.026 : kind === 'steel' ? 0.14 : 0.17,
      wear: kind === 'steel' ? 0.72 : wood ? 0.16 : kind === 'rubber' ? 0.05 : 0.15,
      wearColor: kind === 'steel' ? 0x9d9b91 : wood ? 0x9c7148 : 0x77756b,
    } satisfies FinishStyle;
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    const style = this.userData.finish as FinishStyle;
    shader.uniforms.weaponWearColor = { value: new THREE.Color(style.wearColor) };
    shader.uniforms.weaponDistress = { value: distress };
    shader.uniforms.weaponScuffAmount = { value: style.kind === 'steel' ? .20 : style.kind === 'polymer' ? .12 : .04 };
    shader.uniforms.weaponWearAmount = { value: style.wear };
    shader.uniforms.weaponCheckering = { value: style.kind === 'checkeredWood' ? 1 : style.kind === 'grip' ? 0.55 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float weaponCavity;\nvarying float vWeaponCavity;\nattribute vec2 weaponSurface;\nvarying vec2 vWeaponSurface;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeaponSurface = weaponSurface;\nvWeaponCavity = weaponCavity;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWeaponCavity;\nvarying vec2 vWeaponSurface;\nuniform vec3 weaponWearColor;\nuniform float weaponWearAmount;\nuniform float weaponCheckering;\nuniform sampler2D weaponDistress;\nuniform float weaponScuffAmount;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (weaponCheckering > 0.0) {
          float cutDiamond = texture2D( bumpMap, vBumpMapUv ).r;
          diffuseColor.rgb *= mix(1.0, 0.46 + 0.54 * cutDiamond, weaponCheckering);
        }
        float scuff = texture2D(weaponDistress, vMapUv * 0.78).r;
        diffuseColor.rgb = mix(diffuseColor.rgb, weaponWearColor, scuff * weaponScuffAmount);
        float finishGrain = texture2D( roughnessMap, vRoughnessMapUv * 2.71 + vec2(0.17, 0.63) ).g;
        float finishBreakup = smoothstep(0.74, 0.83, finishGrain);
        float finishWear = clamp(vWeaponSurface.x, 0.0, 1.0) * weaponWearAmount * (0.16 + 0.84 * finishBreakup);
        diffuseColor.rgb *= mix(0.78, 1.05, clamp(vWeaponSurface.y, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, weaponWearColor, finishWear);
      `)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(0.25, 1.0, vWeaponCavity);\nreflectedLight.indirectSpecular *= mix(0.42, 1.0, vWeaponCavity);')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = max(0.24, roughnessFactor - finishWear * 0.19 - scuff * .12);
      `);
  }

  override customProgramCacheKey(): string { return 'weapon-machined-finish-v4'; }
}

export function finish(parameters: THREE.MeshStandardMaterialParameters, kind: FinishKind = 'steel'): WeaponFinish {
  return new WeaponFinish(parameters, kind);
}
