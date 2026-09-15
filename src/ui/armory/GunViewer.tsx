// Recoil FPS — Armory 3D gun viewer: orbit showcase, socket hotspots, live attach flash.
// Own renderer/scene; materials are cloned per viewer so fade/flash never leak into the game's WM.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WEAPON_BUILDERS, applySkin, type WeaponModel } from '../../game/models';
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
  activeSlot: AttachSlot | null;
  /** Bump `key` to pulse the slot's freshly attached part. */
  flashSlot: { slot: AttachSlot; key: number } | null;
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
  flashes: { mats: THREE.MeshStandardMaterial[]; t: number; part: THREE.Object3D; homeY: number }[];
  ownedMats: THREE.Material[];
  slots: AttachSlot[];
  hotspotEls: Map<AttachSlot, HTMLButtonElement>;
  activeSlot: AttachSlot | null;
  raf: number;
  disposed: boolean;
  center: THREE.Vector3;
}

const FIT_RADIUS = 0.42;
// 19° half-fit (was 16°): the gun fills noticeably more of the enlarged stage.
const BASE_DIST = FIT_RADIUS / Math.tan(THREE.MathUtils.degToRad(19));

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

export default function GunViewer({ weapon, skin, build, activeSlot, flashSlot, onHotspot }: GunViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ViewerApi | null>(null);
  const onHotspotRef = useRef(onHotspot);
  onHotspotRef.current = onHotspot;
  const slots = weaponById(weapon)?.slots ?? [];

  // ---- one-time scene setup ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.classList.add('gv-canvas');
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x120F0A, 4.5, 9.0);
    // Lighting parity: identical rig to the in-game viewmodel (engine vmScene).
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);

    scene.add(new THREE.HemisphereLight(0xF0F4FA, 0x8A7450, 1.2));
    const key = new THREE.DirectionalLight(0xFFF2D6, 2.2);
    const fill = new THREE.DirectionalLight(0xFFE8C8, 0.9);
    fill.position.set(-1.2, 1.8, -0.9);
    scene.add(fill);
    key.position.set(1.5, 2.5, 0.8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1; key.shadow.camera.right = 1;
    key.shadow.camera.top = 1; key.shadow.camera.bottom = -1;
    key.shadow.camera.far = 8;
    scene.add(key);

    // Showcase staging: brushed-steel podium, amber halo ring, grid skirt.
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(0.52, 0.58, 0.06, 48),
      new THREE.MeshStandardMaterial({ color: 0x25211C, roughness: 0.42, metalness: 0.55 }),
    );
    podium.position.y = -0.49;
    podium.receiveShadow = true;
    scene.add(podium);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.006, 12, 72),
      new THREE.MeshBasicMaterial({ color: 0xC89B5A }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.458;
    scene.add(halo);
    const grid = new THREE.GridHelper(20, 20, 0x2A241C, 0x1A1610);
    grid.position.y = -0.521;
    scene.add(grid);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.459;
    floor.receiveShadow = true;
    scene.add(floor);

    const fitGroup = new THREE.Group();
    scene.add(fitGroup);

    const api: ViewerApi = {
      renderer, scene, camera, fitGroup, model: null,
      yaw: 0.65, pitch: 0.18, targetYaw: 0.65, targetPitch: 0.18,
      zoom: 1, targetZoom: 1, lastInput: performance.now() - 5000,
      transition: null, incoming: null, flashes: [], ownedMats: [],
      slots: [], hotspotEls: new Map(), activeSlot: null, raf: 0,
      disposed: false, center: new THREE.Vector3(),
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
      const hits = raycaster.intersectObject(api.fitGroup, true);
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
      api.targetZoom = THREE.MathUtils.clamp(api.targetZoom * Math.exp(e.deltaY * 0.0011), 0.7, 1.6);
      api.lastInput = performance.now();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });

    const proj = new THREE.Vector3();
    const projV = new THREE.Vector3();
    const toSocket = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    let last = performance.now();
    const loop = (now: number) => {
      if (api.disposed) return;
      api.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (now - api.lastInput > 4000 && !REDUCED_MOTION) api.targetYaw += dt * 0.15;
      const k = Math.min(1, dt * 9);
      api.yaw += (api.targetYaw - api.yaw) * k;
      api.pitch += (api.targetPitch - api.pitch) * k;
      api.zoom += (api.targetZoom - api.zoom) * k;
      const dist = BASE_DIST * api.zoom;
      camera.position.set(
        Math.sin(api.yaw) * Math.cos(api.pitch) * dist,
        Math.sin(api.pitch) * dist,
        Math.cos(api.yaw) * Math.cos(api.pitch) * dist,
      );
      camera.lookAt(0, 0, 0);

      // weapon-swap transition: old slides −X and fades, new slides in
      if (api.transition) {
        const tr = api.transition;
        tr.t += dt / 0.18;
        const e = Math.min(1, tr.t);
        tr.group.position.x = -0.55 * e * e;
        for (const m of tr.mats) m.opacity = 1 - e;
        if (e >= 1) {
          scene.remove(tr.group);
          disposeGroup(tr.group);
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

      // attach flash: the part drops in from above with a hot-orange emissive decay
      for (let i = api.flashes.length - 1; i >= 0; i--) {
        const f = api.flashes[i];
        f.t += dt / 0.45;
        const e = Math.min(1, f.t);
        const glow = 2.4 * (1 - e) * (1 - e);
        for (const m of f.mats) {
          m.emissive.setHex(0xff5c1a);
          m.emissiveIntensity = glow;
        }
        const drop = 1 - (1 - Math.pow(1 - Math.min(1, f.t * 1.6), 3));
        f.part.position.y = f.homeY + 0.22 * drop;
        if (e >= 1) {
          for (const m of f.mats) m.emissiveIntensity = 0;
          f.part.position.y = f.homeY;
          api.flashes.splice(i, 1);
        }
      }

      // project hotspots from live sockets
      if (api.model) {
        api.fitGroup.updateMatrixWorld(true);
        const w = mount.clientWidth || 2;
        const h = mount.clientHeight || 2;
        toCam.copy(camera.position).sub(api.center).normalize();
        for (const s of api.slots) {
          const btn = api.hotspotEls.get(s);
          const socket = api.model.sockets[s];
          if (!btn || !socket) continue;
          socket.getWorldPosition(proj);
          toSocket.copy(proj).sub(api.center);
          const facing = toSocket.lengthSq() > 1e-8 ? toSocket.normalize().dot(toCam) : 1;
          proj.project(camera);
          const behind = proj.z > 1;
          const x = (proj.x * 0.5 + 0.5) * w;
          const y = (-proj.y * 0.5 + 0.5) * h;
          const op = behind ? 0 : THREE.MathUtils.clamp((facing + 0.45) / 0.55, 0.14, 1);
          btn.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
          btn.style.opacity = op.toFixed(2);
          btn.style.pointerEvents = !behind && facing > -0.3 ? 'auto' : 'none';
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
      for (const m of api.ownedMats) m.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      podium.geometry.dispose();
      (podium.material as THREE.Material).dispose();
      halo.geometry.dispose();
      (halo.material as THREE.Material).dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      scene.environment?.dispose();
      renderer.dispose();
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
    // Clone materials per viewer so transition fades never touch shared WM.
    const mats: THREE.Material[] = [];
    collectMats(model.group, mats);
    const clones = new Map<THREE.Material, THREE.Material>();
    model.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(m => {
          if (!clones.has(m)) {
            const c = m.clone();
            clones.set(m, c);
            api.ownedMats.push(c);
          }
          return clones.get(m)!;
        });
      } else {
        const m = mesh.material as THREE.Material;
        if (!clones.has(m)) {
          const c = m.clone();
          clones.set(m, c);
          api.ownedMats.push(c);
        }
        mesh.material = clones.get(m)!;
      }
    });
    model.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });

    // fit bounding sphere to FIT_RADIUS, centred on bbox centre
    const box = new THREE.Box3().setFromObject(model.group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const scale = sphere.radius > 1e-4 ? FIT_RADIUS / sphere.radius : 1;
    const inner = new THREE.Group();
    inner.add(model.group);
    model.group.position.copy(sphere.center).negate();

    // Rapid re-clicks: a previous outgoing gun may still be mid-fade. Drop it
    // immediately or it leaks into the scene as a stuck ghost skeleton.
    if (api.transition) {
      api.scene.remove(api.transition.group);
      disposeGroup(api.transition.group);
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
    api.fitGroup.scale.setScalar(scale);
    api.fitGroup.position.set(0, -0.08, 0);
    api.fitGroup.add(inner);
    api.model = model;
    api.slots = weaponById(weapon)?.slots ?? [];
    api.center.set(0, 0, 0);
  }, [weapon]);

  // ---- live build (cheap: only on click, never per frame) ----
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.model) return;
    applyBuild(api.model, build);
    // freshly mounted parts inherit shared WM — clone so flash owns them
    for (const key of Object.keys(api.model.attached) as AttachSlot[]) {
      const part = api.model.attached[key];
      part?.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        if (!api.ownedMats.includes(mesh.material as THREE.Material)) {
          const c = (mesh.material as THREE.Material).clone();
          mesh.material = c;
          api.ownedMats.push(c);
        }
      });
      part?.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });
    }
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
    if (mats.length) api.flashes.push({ mats, t: 0, part, homeY: part.position.y });
  }, [flashSlot?.key]);

  // ---- active hotspot ring ----
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.activeSlot = activeSlot;
    for (const [s, btn] of api.hotspotEls) btn.dataset.active = String(s === activeSlot);
  }, [activeSlot]);

  return (
    <div ref={mountRef} className="gv-root">
      {slots.map(s => (
        <button
          key={s}
          ref={node => {
            const api = apiRef.current;
            if (!api) return;
            if (node) api.hotspotEls.set(s, node);
            else api.hotspotEls.delete(s);
          }}
          data-active={s === activeSlot}
          className="gv-hotspot"
          onClick={e => {
            e.stopPropagation();
            onHotspotRef.current(s);
          }}
          aria-label={`${SLOT_LABELS[s]} slot`}
        >
          <i />
          <span>{SLOT_LABELS[s]}</span>
        </button>
      ))}
    </div>
  );
}

/* ================= thumbnails: one 256×128 render per gun, cached ================= */

const thumbCache = new Map<WeaponId, string>();
let thumbRenderer: THREE.WebGLRenderer | null = null;
let thumbEnv: THREE.Texture | null = null;

export function gunThumbnail(weapon: WeaponId): string {
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
    const fill = new THREE.DirectionalLight(0xFFE8C8, 0.9);
    fill.position.set(-1.2, 1.8, -0.9);
    scene.add(fill);
    key.position.set(1.5, 2.5, 0.8);
    scene.add(key);
    const model = (WEAPON_BUILDERS[weapon] ?? WEAPON_BUILDERS.m4a1)();
    hideArms(model);
    scene.add(model.group);
    // side profile: gun forward is −Z, so park the camera on +X
    const box = new THREE.Box3().setFromObject(model.group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    model.group.position.copy(sphere.center).negate();
    const camera = new THREE.PerspectiveCamera(24, 2, 0.05, 50);
    const dist = sphere.radius > 1e-4 ? (sphere.radius / Math.tan(THREE.MathUtils.degToRad(12))) * 1.02 : 2;
    camera.position.set(dist, sphere.radius * 0.28, dist * 0.22);
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
