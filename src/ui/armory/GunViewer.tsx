// Recoil FPS — Armory 3D gun viewer: orbit showcase, click-to-fit sockets, live attach flash.
// Own renderer/scene; materials are cloned per viewer so fade/flash never leak into the game's WM.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WEAPON_BUILDERS, applySkin, type WeaponModel } from '../../game/models';
import { weaponBounds } from '../../game/weapons/geometry';
import { areWeaponTexturesReady } from '../../game/weapons/finish';
import { applyBuild } from '../../game/attachments';
import { weaponById, type AttachSlot, type WeaponId } from '../../game/economy/catalog';
import type { WeaponBuild } from '../../game/economy/loadout';
import { skinById, type SkinId } from '../../game/economy/skins';

export const SLOT_LABELS: Record<AttachSlot, string> = {
  muzzle: 'MUZZLE',
  optic: 'OPTIC',
  magazine: 'MAG',
  underbarrel: 'GRIP',
  stock: 'STOCK',
  rail: 'RAIL',
  barrel: 'BARREL',
};

const REDUCED_MOTION = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface GunViewerProps {
  weapon: WeaponId;
  skin: SkinId;
  build: WeaponBuild;
  /** Bump `key` to pulse the slot's freshly attached part. */
  flashSlot: { slot: AttachSlot; key: number } | null;
  /** Click (not drag) on/near a socket opens that slot's parts. */
  onHotspot: (slot: AttachSlot) => void;
}

interface ViewerApi {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  fitGroup: THREE.Group;
  model: WeaponModel | null;
  yaw: number; pitch: number; targetYaw: number; targetPitch: number;
  zoom: number; targetZoom: number;
  lastInput: number;
  transition: { group: THREE.Group; mats: THREE.MeshStandardMaterial[]; t: number } | null;
  incoming: { group: THREE.Group; t: number } | null;
  flashes: { mats: THREE.MeshStandardMaterial[]; t: number }[];
  ownedMats: THREE.Material[];
  slots: AttachSlot[];
  raf: number;
  disposed: boolean;
}

const FIT_RADIUS = 0.42;
// Keep a complete assembly in frame even when the stage is narrow or a long can is fitted.
function showcaseDistance(aspect: number): number {
  const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(16)) * Math.min(1.35, aspect));
  return FIT_RADIUS / Math.sin(halfFov) * 1.08;
}

function hideArms(model: WeaponModel): void {
  model.group.traverse(o => {
    if (o.userData.arm) o.visible = false;
  });
  // Legacy models tag only lArm; the right arm rides in the main group — the
  // per-model `arm` tags above cover both once builders set them.
  if (model.lArm) model.lArm.visible = false;
}

function collectMats(root: THREE.Object3D, out: THREE.Material[]): void {
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (m && !out.includes(m)) out.push(m);
    }
  });
}

function disposeGroup(root: THREE.Object3D): void {
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
  });
}

function releaseMaterials(materials: THREE.Material[], api: ViewerApi): void {
  for (const mat of materials) {
    const index = api.ownedMats.indexOf(mat);
    if (index < 0) continue;
    mat.dispose(); api.ownedMats.splice(index, 1);
  }
}

function disposeOwnedGroup(root: THREE.Object3D, api: ViewerApi): void {
  const materials: THREE.Material[] = [];
  collectMats(root, materials);
  releaseMaterials(materials, api);
  disposeGroup(root);
}

function fitWeapon(api: ViewerApi, model: WeaponModel): void {
  const sphere = weaponBounds(model.group).getBoundingSphere(new THREE.Sphere());
  model.group.position.copy(sphere.center).negate();
  api.fitGroup.scale.setScalar(sphere.radius > 1e-4 ? FIT_RADIUS / sphere.radius : 1);
  api.lastInput = performance.now();
  api.renderer.shadowMap.needsUpdate = true;
}

function ownMaterials(root: THREE.Object3D, api: ViewerApi): void {
  const clones = new Map<THREE.Material, THREE.Material>();
  const own = (mat: THREE.Material) => {
    if (api.ownedMats.includes(mat)) return mat;
    if (!clones.has(mat)) {
      const clone = mat.clone(); clones.set(mat, clone); api.ownedMats.push(clone);
    }
    return clones.get(mat)!;
  };
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.castShadow = !materials.every(mat => mat.transparent);
    mesh.receiveShadow = true;
  });
}

export default function GunViewer({ weapon, skin, build, flashSlot, onHotspot }: GunViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ViewerApi | null>(null);
  const onHotspotRef = useRef(onHotspot);
  onHotspotRef.current = onHotspot;

  // ---- one-time scene setup ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    // Orbit changes the camera, not the gun/light: keep the static self-shadow map.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.classList.add('gv-canvas');
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x120F0A, 4.5, 9.0);
    // Use the gameplay environment with extra fill to reveal small machined details.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.85;
    room.dispose(); pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);

    scene.add(new THREE.HemisphereLight(0xF0F4FA, 0x8A7450, 1.2));
    const key = new THREE.DirectionalLight(0xFFF2D6, 2.2);
    const fill = new THREE.DirectionalLight(0xC5D7F1, 1.0);
    fill.position.set(1.4, 1.0, -1.4);
    scene.add(fill);
    key.position.set(-1.6, 2.4, 1.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.00012;
    key.shadow.normalBias = 0.0012;
    key.shadow.camera.left = -1; key.shadow.camera.right = 1;
    key.shadow.camera.top = 1; key.shadow.camera.bottom = -1;
    key.shadow.camera.far = 8;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xD8E7F5, 1.5);
    rim.position.set(0.6, 1.0, -2.0); scene.add(rim);

    // Showcase staging: brushed-steel podium, amber halo ring, grid skirt.
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(0.52, 0.58, 0.06, 48),
      new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.88, metalness: 0.08 }),
    );
    podium.position.y = -0.49;
    podium.receiveShadow = true;
    podium.visible = false; // Reference-style inspection: keep the weapon, not a giant plinth, in focus.
    scene.add(podium);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.006, 12, 72),
      new THREE.MeshBasicMaterial({ color: 0xC89B5A, transparent: true, opacity: 0.35 }),
    );
    halo.visible = false;
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.458;
    scene.add(halo);
    const grid = new THREE.GridHelper(20, 20, 0x2A241C, 0x1A1610);
    grid.position.y = -0.521;
    // The floor grid remains hidden: it competes with fine weapon details.
    grid.visible = false;
    scene.add(grid);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.459;
    floor.receiveShadow = true;
    floor.visible = false;
    scene.add(floor);

    const fitGroup = new THREE.Group();
    scene.add(fitGroup);

    const api: ViewerApi = {
      renderer, scene, camera, fitGroup, model: null,
      yaw: -1.10, pitch: 0.23, targetYaw: -1.10, targetPitch: 0.23,
      zoom: 0.96, targetZoom: 0.96, lastInput: performance.now(),
      transition: null, incoming: null, flashes: [], ownedMats: [],
      slots: [], raf: 0, disposed: false,
    };
    apiRef.current = api;

    const resize = () => {
      const w = mount.clientWidth || 2;
      const h = mount.clientHeight || 2;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // ---- tiny hand-rolled orbit (drag orbit, wheel zoom, idle auto-orbit) ----
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let px = 0;
    let py = 0;
    let downX = 0;
    let downY = 0;
    const el = renderer.domElement;
    const down = (e: PointerEvent) => {
      dragging = true;
      px = e.clientX;
      py = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      api.lastInput = performance.now();
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      api.targetYaw += (e.clientX - px) * 0.0052;
      api.targetPitch = THREE.MathUtils.clamp(api.targetPitch + (e.clientY - py) * 0.004, -0.61, 0.61);
      px = e.clientX;
      py = e.clientY;
      api.lastInput = performance.now();
    };
    const up = (e: PointerEvent) => {
      const wasDrag = Math.hypot(e.clientX - downX, e.clientY - downY) > 6;
      dragging = false;
      // Click (not drag) on the gun: open the socket nearest the picked point.
      if (wasDrag || !api.model) return;
      const rect = el.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, api.camera);
      const hits = raycaster.intersectObject(api.fitGroup, true).filter(hit => {
        for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (!o.visible || o.userData.arm) return false;
        return true;
      });
      if (!hits.length) return;
      api.fitGroup.updateMatrixWorld(true);
      let best: AttachSlot | null = null;
      let bestD = 0.09;
      for (const s of api.slots) {
        const socket = api.model.sockets[s];
        if (!socket) continue;
        socket.getWorldPosition(projV);
        const dd = projV.distanceTo(hits[0].point);
        if (dd < bestD) { bestD = dd; best = s; }
      }
      if (best) onHotspotRef.current(best);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      api.targetZoom = THREE.MathUtils.clamp(api.targetZoom * Math.exp(e.deltaY * 0.0011), 0.55, 1.6);
      api.lastInput = performance.now();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });

    const projV = new THREE.Vector3();
    let last = performance.now();
    const loop = (now: number) => {
      if (api.disposed) return;
      api.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (now - api.lastInput > 4000 && !REDUCED_MOTION) api.targetYaw += dt * 0.10;
      const k = Math.min(1, dt * 9);
      api.yaw += (api.targetYaw - api.yaw) * k;
      api.pitch += (api.targetPitch - api.pitch) * k;
      api.zoom += (api.targetZoom - api.zoom) * k;
      const dist = showcaseDistance(camera.aspect) * api.zoom;
      camera.position.set(
        Math.sin(api.yaw) * Math.cos(api.pitch) * dist,
        Math.sin(api.pitch) * dist,
        Math.cos(api.yaw) * Math.cos(api.pitch) * dist,
      );
      camera.lookAt(0, 0, 0);

      if (api.transition || api.incoming) renderer.shadowMap.needsUpdate = true;

      // weapon-swap transition: old slides −X and fades, new slides in
      if (api.transition) {
        const tr = api.transition;
        tr.t += dt / 0.18;
        const e = Math.min(1, tr.t);
        tr.group.position.x = -0.55 * e * e;
        for (const m of tr.mats) m.opacity = 1 - e;
        if (e >= 1) {
          scene.remove(tr.group);
          disposeOwnedGroup(tr.group, api);
          api.transition = null;
        }
      }
      if (api.incoming) {
        const inc = api.incoming;
        inc.t += dt / 0.22;
        const e = 1 - Math.pow(1 - Math.min(1, inc.t), 3);
        api.fitGroup.position.x = 0.55 * (1 - e);
        if (inc.t >= 1) {
          api.fitGroup.position.x = 0;
          api.incoming = null;
        }
      }

      // Seated highlight only: a fitted component never leaves its socket during feedback.
      for (let i = api.flashes.length - 1; i >= 0; i--) {
        const f = api.flashes[i];
        f.t += dt / 0.45;
        const e = Math.min(1, f.t);
        const glow = 0.8 * (1 - e) * (1 - e);
        for (const m of f.mats) {
          m.emissive.setHex(0xff5c1a);
          m.emissiveIntensity = glow;
        }
        if (e >= 1) {
          for (const m of f.mats) m.emissiveIntensity = 0;
          api.flashes.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
    };
    api.raf = requestAnimationFrame(loop);

    return () => {
      api.disposed = true;
      cancelAnimationFrame(api.raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      if (api.model) disposeGroup(api.model.group);
      if (api.transition) disposeGroup(api.transition.group);
      for (const m of api.ownedMats) m.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      podium.geometry.dispose();
      (podium.material as THREE.Material).dispose();
      halo.geometry.dispose();
      (halo.material as THREE.Material).dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      environment.dispose();
      renderer.dispose();
      // Actively release the GL context — browsers cap live WebGL contexts, and
      // repeated loadout-screen visits could exhaust the pool and break the
      // NEXT match launch (Engine.create fails → player dumped to the menu).
      renderer.forceContextLoss();
      mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  // ---- swap gun (with transition) ----
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const builder = WEAPON_BUILDERS[weapon] ?? WEAPON_BUILDERS.m4a1;
    const model = builder();
    hideArms(model);
    applyBuild(model, build);
    ownMaterials(model.group, api);
    const inner = new THREE.Group();
    inner.add(model.group);
    // A flash from the old gun must not retain or animate detached components.
    api.flashes = [];

    // Rapid re-clicks: a previous outgoing gun may still be mid-fade. Drop it
    // immediately or it leaks into the scene as a stuck ghost skeleton.
    if (api.transition) {
      api.scene.remove(api.transition.group);
      disposeOwnedGroup(api.transition.group, api);
      api.transition = null;
    }
    const old = api.model;
    if (old) {
      const oldMats: THREE.MeshStandardMaterial[] = [];
      const seen = new Set<THREE.Material>();
      old.group.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of list) {
          if (seen.has(m)) continue;
          seen.add(m);
          const sm = m as THREE.MeshStandardMaterial;
          if ('opacity' in sm) {
            sm.transparent = true;
            oldMats.push(sm);
          }
        }
      });
      // outgoing group must render in scene space, not inside the re-fitted group
      const parent = old.group.parent;
      const ws = new THREE.Vector3();
      const wp = new THREE.Vector3();
      old.group.getWorldScale(ws);
      old.group.getWorldPosition(wp);
      parent?.remove(old.group);
      api.scene.add(old.group);
      old.group.position.copy(wp);
      old.group.scale.copy(ws);
      api.transition = { group: old.group, mats: oldMats, t: 0 };
      api.incoming = { group: inner, t: 0 };
    }
    api.fitGroup.clear();
    api.fitGroup.position.set(0, 0, 0);
    api.fitGroup.add(inner);
    fitWeapon(api, model);
    api.model = model;
    api.slots = weaponById(weapon)?.slots ?? [];
  }, [weapon]);

  // ---- live build (cheap: only on click, never per frame) ----
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.model) return;
    const previousMaterials: THREE.Material[] = [];
    for (const part of Object.values(api.model.attached)) if (part) collectMats(part, previousMaterials);
    // Feedback cannot move parts or keep the previous attachment alive after a fast swap.
    for (const flash of api.flashes) for (const mat of flash.mats) mat.emissiveIntensity = 0;
    api.flashes = [];
    applyBuild(api.model, build);
    const retained: THREE.Material[] = [];
    collectMats(api.model.group, retained);
    releaseMaterials(previousMaterials.filter(mat => !retained.includes(mat)), api);
    for (const part of Object.values(api.model.attached)) if (part) ownMaterials(part, api);
    fitWeapon(api, api.model);
  }, [build]);

  // ---- finish (repaint after every rebuild or pick; idempotent) ----
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.model) return;
    applySkin(api.model.group, skinById(skin));
  }, [weapon, build, skin]);

  // ---- attach flash pulse ----
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.model || !flashSlot) return;
    const part = api.model.attached[flashSlot.slot];
    if (!part) return;
    const mats: THREE.MeshStandardMaterial[] = [];
    part.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      if ('emissive' in m && !mats.includes(m)) mats.push(m);
    });
    if (mats.length) api.flashes.push({ mats, t: 0 });
  }, [flashSlot?.key]);

  return <div ref={mountRef} className="gv-root" />;
}

/* ================= thumbnails: one 256×128 render per gun, cached ================= */

const thumbCache = new Map<WeaponId, string>();
let thumbRenderer: THREE.WebGLRenderer | null = null;
let thumbEnv: THREE.Texture | null = null;

export function gunThumbnail(weapon: WeaponId): string {
  // Never permanently cache an untextured first render on a cold connection.
  if (!areWeaponTexturesReady()) return '';
  const hit = thumbCache.get(weapon);
  if (hit !== undefined) return hit;
  try {
    thumbRenderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(256, 128);
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbRenderer.toneMappingExposure = 1.05;
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    if (!thumbEnv) {
      const pmrem = new THREE.PMREMGenerator(thumbRenderer);
      thumbEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    const scene = new THREE.Scene();
    scene.environment = thumbEnv;
    scene.environmentIntensity = 0.85;
    scene.add(new THREE.HemisphereLight(0xF0F4FA, 0x8A7450, 1.2));
    const key = new THREE.DirectionalLight(0xFFF2D6, 2.2);
    const fill = new THREE.DirectionalLight(0xC5D7F1, 1.0);
    fill.position.set(1.4, 1.0, -1.4);
    scene.add(fill);
    key.position.set(-1.6, 2.4, 1.2);
    scene.add(key);
    const model = (WEAPON_BUILDERS[weapon] ?? WEAPON_BUILDERS.m4a1)();
    hideArms(model);
    scene.add(model.group);
    // side profile: gun forward is −Z, so park the camera on +X
    const box = weaponBounds(model.group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    model.group.position.copy(sphere.center).negate();
    const camera = new THREE.PerspectiveCamera(24, 2, 0.05, 50);
    const size = box.getSize(new THREE.Vector3());
    const tan = Math.tan(THREE.MathUtils.degToRad(12));
    const dist = Math.max(size.z / (4 * tan), size.y / (2 * tan)) * 1.20;
    camera.position.set(-dist, dist * 0.12, dist * 0.16);
    camera.lookAt(0, 0, 0);
    model.group.rotation.y = 0;
    thumbRenderer.render(scene, camera);
    const url = thumbRenderer.domElement.toDataURL('image/png');
    disposeGroup(model.group);
    scene.clear();
    thumbCache.set(weapon, url);
    return url;
  } catch {
    thumbCache.set(weapon, '');
    return '';
  }
}
