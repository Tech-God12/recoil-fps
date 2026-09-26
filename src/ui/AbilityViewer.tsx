// Recoil FPS — ABILITIES menu 3-D showcase. Renders the real in-game ability hardware
// (ability-models.ts, so the menu never drifts from what spawns in a match) on a lit
// pedestal and loops a short demo of what the ability does: the radar unfolds, spins and
// scans, finding enemy silhouettes; the barricade drops and unfolds; the decoy
// materialises and patrols. One renderer per mount, 2× DPR cap, paused when hidden.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AbilityId } from '../game/abilities';
import {
  buildBarricade, buildDart, buildDecoy, buildMedkit, buildMine, buildTagGhost, disposeDartFx, disposeDecoy, disposeAbilityObject,
  disposeMedkit, disposeMine, type BarricadeModel, type DartModel, type DecoyModel, type MedkitModel, type MineModel, type TagGhost,
} from '../game/ability-models';

const ACCENT: Record<AbilityId, number> = { recon: 0x5fe3ff, bulwark: 0xff8a3d, phantom: 0x7cf5d8, mine: 0xff4a3a, medic: 0x6cff9a };
/** Demo loop length per ability (s). */
const LOOP: Record<AbilityId, number> = { recon: 5, bulwark: 5, phantom: 5, mine: 5.5, medic: 5 };

type Rig =
  | { id: 'recon'; m: DartModel; root: THREE.Group; ghosts: TagGhost[] }
  | { id: 'bulwark'; m: BarricadeModel; root: THREE.Group }
  | { id: 'phantom'; m: DecoyModel; root: THREE.Group }
  | { id: 'mine'; m: MineModel; root: THREE.Group; walker: TagGhost; flash: THREE.Mesh }
  | { id: 'medic'; m: MedkitModel; root: THREE.Group };

/** Mine demo: the canister is 20 cm across, shown 3.5× so it reads; the ring stays true to scale/2. */
const MINE_SHOW = 3.5;
const MINE_RING = 1.3;
/** Medkit demo scale, and the field radius shown in the menu (world metres). */
const MED_SHOW = 2;
const MED_RING = 1.5;

function buildRig(id: AbilityId): Rig {
  const root = new THREE.Group();
  if (id === 'recon') {
    const m = buildDart();
    // The unit is 45 cm tall: shown at 2.6× so it reads at the same size as the others.
    m.group.scale.setScalar(2.6);
    root.add(m.group, m.ring, m.echo);
    const ghosts = [new THREE.Vector3(-1.5, 0, -1.4), new THREE.Vector3(1.6, 0, -1.7)].map((p, i) => {
      const g = buildTagGhost(false);
      g.group.position.copy(p);
      g.group.rotation.y = i ? 2.4 : -0.6;
      g.group.scale.setScalar(0.6);
      root.add(g.group);
      return g;
    });
    return { id, m, root, ghosts };
  }
  if (id === 'bulwark') {
    const m = buildBarricade(2.4, 1.4, 0.12);
    m.group.rotation.y = Math.PI; // threat face toward the camera
    root.add(m.group);
    return { id, m, root };
  }
  if (id === 'mine') {
    const m = buildMine();
    m.body.scale.setScalar(MINE_SHOW);
    m.ring.scale.setScalar(MINE_RING); m.laser.scale.setScalar(MINE_RING);
    root.add(m.group);
    // An enemy silhouette (red hologram) walks into the trigger ring.
    const walker = buildTagGhost(false);
    walker.mat.uniforms.uColor.value.set(0xff6a50);
    walker.group.scale.setScalar(0.62);
    root.add(walker.group);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    root.add(flash);
    return { id, m, root, walker, flash };
  }
  if (id === 'medic') {
    const m = buildMedkit();
    m.group.scale.setScalar(MED_SHOW);
    m.ring.scale.setScalar(MED_RING / MED_SHOW);
    root.add(m.group);
    return { id, m, root };
  }
  const m = buildDecoy();
  m.group.rotation.y = Math.PI - 0.5; // face the camera (the rig faces -Z), slight three-quarter turn
  root.add(m.group);
  return { id, m, root };
}

function disposeRig(r: Rig) {
  if (r.id === 'recon') {
    disposeDartFx(r.m); disposeAbilityObject(r.m.group);
    for (const g of r.ghosts) g.mat.dispose();
  } else if (r.id === 'bulwark') {
    disposeAbilityObject(r.m.group); r.m.plateMat.dispose(); (r.m.lamp.material as THREE.Material).dispose();
  } else if (r.id === 'mine') {
    disposeMine(r.m); disposeAbilityObject(r.walker.group); r.walker.mat.dispose();
    r.flash.geometry.dispose(); (r.flash.material as THREE.Material).dispose();
  } else if (r.id === 'medic') disposeMedkit(r.m);
  else disposeDecoy(r.m);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = (x: number) => { const c = 1.7; const t = clamp01(x) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };

/** Advance the demo to loop time `t` (0..LOOP). */
function animate(r: Rig, t: number, dt: number) {
  if (r.id === 'recon') {
    const { m } = r;
    m.setDeploy(t / 0.6);
    const scanT = t - 0.9;
    m.dish.rotation.y += dt * (scanT > 0 && scanT % 1.4 < 0.3 ? 14 : 2.5);
    (m.led.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + (Math.sin(t * 10) > 0 ? 1.6 : 0);
    const p = scanT > 0 ? (scanT % 1.4) / 1.4 : -1;
    for (const [o, lag, max, op] of [[m.ring, 0, 2.3, 0.9], [m.echo, 0.1, 2.1, 0.5]] as const) {
      const q = p - lag;
      o.visible = q > 0 && q < 1;
      o.position.y = 0.02;
      o.scale.setScalar(0.05 + easeOut(q) * max);
      (o.material as THREE.MeshBasicMaterial).opacity = (1 - q) * op;
    }
    // enemies "found" by the first scan, held through the loop, faded at the end
    const shown = scanT > 0.35 ? Math.min(1, (scanT - 0.35) * 3) * Math.min(1, (LOOP.recon - t) * 2) : 0;
    for (const g of r.ghosts) {
      g.group.visible = shown > 0;
      g.mat.uniforms.uTime.value += dt;
      g.mat.opacity = shown * (0.55 + (p >= 0 && p < 0.25 ? 0.5 : 0));
    }
    return;
  }
  if (r.id === 'bulwark') {
    // drop in (0–0.45 s), unfold (0.45–1.1 s), hold, fold (4.1–4.5 s)
    const g = r.m.group;
    g.position.y = (1 - easeOut(t / 0.45)) * 1.4;
    const open = t < 4.1 ? easeBack((t - 0.45) / 0.65) : 1 - easeOut((t - 4.1) / 0.4);
    const swing = (1 - Math.min(1, open)) * Math.PI / 2;
    r.m.wings[0].rotation.y = swing;
    r.m.wings[1].rotation.y = -swing;
    g.visible = t < 4.6;
    (r.m.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 9) > 0 ? 3 : 0.4;
    return;
  }
  if (r.id === 'mine') {
    // plant (0–0.3), arm (0.3–1.5), enemy walks in (2–3.3), trip + jump (3.3–3.65), blast, reset
    const { m, walker, flash } = r;
    const led = m.led.material as THREE.MeshStandardMaterial;
    const ring = m.ring.material as THREE.MeshBasicMaterial;
    const laser = m.laser.material as THREE.MeshBasicMaterial;
    const drop = easeOut(t / 0.3);
    const boom = t >= 3.65;
    m.group.visible = !boom || t > 5.2;
    m.body.position.y = t < 3.3 ? (1 - drop) * 0.6 : Math.sin(clamp01((t - 3.3) / 0.35) * Math.PI / 2) * 0.9;
    m.body.rotation.y = t < 3.3 ? 0.4 : m.body.rotation.y + dt * 20;
    const arm = clamp01((t - 0.3) / 1.2);
    m.ring.scale.setScalar(Math.max(0.05, arm) * MINE_RING);
    ring.opacity = t < 3.3 ? 0.4 * arm : 0.7;
    laser.opacity = arm >= 1 && t < 3.3 ? 0.18 : 0;
    m.laser.rotation.z += dt * 3.2;
    led.emissiveIntensity = t >= 3.3 ? 4 : arm < 1 ? (Math.sin(t * 8) > 0 ? 2 : 0.2) : (Math.sin(t * 14) > 0.4 ? 3 : 0.25);
    // walker: from 3.2 m out to just inside the ring
    const w = clamp01((t - 2) / 1.3);
    walker.group.visible = t > 1.9 && !boom;
    walker.group.position.set(THREE.MathUtils.lerp(3.2, 0.9, w), 0, THREE.MathUtils.lerp(-1.2, -0.5, w));
    walker.group.rotation.y = Math.atan2(-0.8, 0.3) + Math.PI / 2;
    walker.mat.uniforms.uTime.value += dt;
    walker.mat.opacity = 0.6;
    // blast: an expanding fireball that fades
    const b = boom ? clamp01((t - 3.65) / 0.6) : 0;
    flash.visible = boom && b < 1;
    flash.position.set(0, 0.9, 0);
    flash.scale.setScalar(0.2 + easeOut(b) * 2.2);
    (flash.material as THREE.MeshBasicMaterial).opacity = (1 - b) * 0.85;
    return;
  }
  if (r.id === 'medic') {
    // drop (0–0.3), open (0.3–0.9), heal field breathing, close (4.3–4.7)
    const { m } = r;
    m.group.position.y = (1 - easeOut(t / 0.3)) * 0.8;
    const open = t < 4.3 ? clamp01((t - 0.3) / 0.6) : 1 - clamp01((t - 4.3) / 0.4);
    m.setOpen(open);
    const rr = Math.max(0.05, easeBack(open)) * MED_RING / MED_SHOW;
    m.ring.scale.setScalar(rr);
    m.dome.scale.set(rr, rr * 0.55, rr);
    (m.dome.material as THREE.ShaderMaterial & { opacity: number }).opacity = (0.3 + 0.08 * Math.sin(t * 4)) * open;
    (m.ring.material as THREE.MeshBasicMaterial).opacity = (0.45 + 0.15 * Math.sin(t * 4)) * open;
    m.cross.rotation.y += dt * 1.6;
    return;
  }
  const m = r.m;
  m.mat.uniforms.uTime.value += dt;
  const form = clamp01(t / 0.8);
  const fade = clamp01((LOOP.phantom - t) / 0.4);
  const glitch = (t > 2.4 && t < 2.55) || (t > 3.6 && t < 3.7);
  m.group.scale.set(0.2 + 0.8 * easeBack(form), Math.max(0.02, easeBack(form)), 0.2 + 0.8 * easeBack(form));
  m.mat.opacity = (glitch ? 0.35 : 0.75) * fade;
  m.torso.position.x = glitch ? 0.07 : 0;
  m.scan.position.y = ((t * 0.7) % 1) * 1.9;
  (m.scan.material as THREE.MeshBasicMaterial).opacity = 0.3 * fade;
  (m.cone.material as THREE.MeshBasicMaterial).opacity = 0.09 * fade;
  const stride = Math.sin(t * 5) * 0.35;
  m.lLeg.rotation.x = stride; m.rLeg.rotation.x = -stride;
  m.torso.position.y = 0.95 + Math.abs(Math.sin(t * 5)) * 0.02;
}

/** Soft contact shadow: a radial gradient on a floor quad. */
function shadowTexture(inner = 'rgba(0,0,0,0.75)', outer = 'rgba(0,0,0,0)'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * `shift` moves the subject sideways in screen space (fraction of the width), so the
 * showcase can sit to the right of the menu text without moving the camera.
 */
export function AbilityViewer({ ability, className, shift = 0 }: { ability: AbilityId; className?: string; shift?: number }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.classList.add('kv-nogl');
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envTex = pmrem.fromScene(room, 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.35;
    room.dispose(); pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
    scene.add(new THREE.HemisphereLight(0xf0e6d2, 0x1a150f, 0.7));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.6); key.position.set(3, 5, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(ACCENT[ability], 3.2); rim.position.set(-4, 3, -4); scene.add(rim);
    const fill = new THREE.PointLight(ACCENT[ability], 5, 7); fill.position.set(0, 0.4, 1.8); scene.add(fill);

    // floor: dark disc, accent ring pair, contact shadow
    const disposables: { dispose(): void }[] = [];
    const add = <T extends THREE.Mesh>(o: T) => { scene.add(o); disposables.push(o.geometry, o.material as THREE.Material); return o; };
    // Floor fades to nothing at the edges so there is no visible horizon line.
    const floorTex = shadowTexture('rgba(12,10,8,0.55)', 'rgba(12,10,8,0)'); disposables.push(floorTex);
    add(new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false }))).rotation.x = -Math.PI / 2;
    const ringMat = new THREE.MeshBasicMaterial({ color: ACCENT[ability], transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const ring1 = add(new THREE.Mesh(new THREE.RingGeometry(1.55, 1.58, 96), ringMat)); ring1.rotation.x = -Math.PI / 2; ring1.position.y = 0.003;
    const ring2Mat = new THREE.MeshBasicMaterial({ color: ACCENT[ability], transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    const ring2 = add(new THREE.Mesh(new THREE.RingGeometry(1.7, 1.9, 96, 1, 0, Math.PI * 1.4), ring2Mat)); ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.002;
    const shTex = shadowTexture(); disposables.push(shTex);
    const shadow = add(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false })));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004;

    const rig = buildRig(ability);
    scene.add(rig.root);
    // Frame on the fully-deployed pose.
    animate(rig, LOOP[ability] * 0.5, 0);
    rig.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    rig.root.traverse(o => { if (o instanceof THREE.Mesh && o.visible && o !== (rig.id === 'recon' ? rig.m.ring : null) && o !== (rig.id === 'recon' ? rig.m.echo : null)) box.expandByObject(o); });
    if (rig.id === 'recon') box.set(new THREE.Vector3(-1.6, 0, -1.8), new THREE.Vector3(1.6, 1.3, 0.4));
    if (rig.id === 'mine') box.set(new THREE.Vector3(-1.5, 0, -1.6), new THREE.Vector3(2.6, 1.4, 1.2));
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y * 1.1, size.z) * 0.62 + 0.25;
    // Fit the subject in BOTH directions: on a narrow stage the horizontal FOV is the limit.
    let dist = 1;

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
      const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
      dist = radius / Math.tan(Math.min(vHalf, hHalf));
      if (shift) camera.setViewOffset(w, h, -shift * w, 0, w, h); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    let last = performance.now();
    const t0 = last;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const clock = (now - t0) / 1000;
      animate(rig, reduce ? LOOP[ability] * 0.5 : clock % LOOP[ability], reduce ? 0 : dt);
      ring2.rotation.z = clock * 0.25;
      // slow orbit across the front, never showing the back of the ability for long
      const a = reduce ? 0.5 : 0.5 + Math.sin(clock * 0.3) * 0.6;
      camera.position.set(centre.x + Math.sin(a) * dist, centre.y + dist * 0.28, centre.z + Math.cos(a) * dist);
      camera.lookAt(centre.x, centre.y * 0.92, centre.z);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposeRig(rig);
      for (const d of disposables) d.dispose();
      envTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [ability, shift]);
  return <div ref={host} className={`ability-viewer ${className ?? ''}`} aria-hidden="true" />;
}
