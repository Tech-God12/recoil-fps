// Recoil FPS — Kits menu 3-D preview. Renders the real in-game kit hardware
// (kit-models.ts builders, so the menu never drifts from what spawns in a match) on a
// turntable and loops a short demo of the ability: the dart pings, the barricade
// unfolds and folds, the decoy materialises, walks and glitches. One renderer per
// mount, capped at 2× DPR, paused while the tab is hidden.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { KitId } from '../game/kits';
import {
  buildBarricade, buildDart, buildDecoy, disposeDartFx, disposeDecoy, disposeKitObject,
  type BarricadeModel, type DartModel, type DecoyModel,
} from '../game/kit-models';

const ACCENT: Record<KitId, number> = { recon: 0x5FE3FF, bulwark: 0xFF7A2E, phantom: 0x6FE8FF };

/** Demo loop length per kit (s): long enough to read the whole ability once. */
const LOOP: Record<KitId, number> = { recon: 3.2, bulwark: 4.4, phantom: 4.0 };

type Rig =
  | { id: 'recon'; m: DartModel; root: THREE.Group }
  | { id: 'bulwark'; m: BarricadeModel; root: THREE.Group }
  | { id: 'phantom'; m: DecoyModel; root: THREE.Group };

function buildRig(id: KitId): Rig {
  const root = new THREE.Group();
  if (id === 'recon') {
    const m = buildDart();
    // Dart stuck nose-down in the floor, pulses expanding around it.
    m.group.rotation.x = -Math.PI / 2 + 0.35;
    m.group.position.y = 0.16;
    m.group.scale.setScalar(3.2);
    root.add(m.group, m.ring, m.echo, m.dome, m.beam);
    m.beam.position.y = 1.5;
    return { id, m, root };
  }
  if (id === 'bulwark') {
    const m = buildBarricade(1.8, 1.4, 0.08);
    m.group.rotation.y = Math.PI; // show the threat face to the camera
    root.add(m.group);
    return { id, m, root };
  }
  const m = buildDecoy();
  root.add(m.group);
  return { id, m, root };
}

function disposeRig(r: Rig) {
  if (r.id === 'recon') { disposeDartFx(r.m); disposeKitObject(r.m.group); }
  else if (r.id === 'bulwark') { disposeKitObject(r.m.group); r.m.plateMat.dispose(); }
  else disposeDecoy(r.m);
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Advance the ability demo to loop time `t` (0..LOOP). */
function animate(r: Rig, t: number, clock: number) {
  if (r.id === 'recon') {
    const { ring, echo, dome, beam, led } = r.m;
    const p = (t % 1.6) / 1.6; // two pulses per loop
    for (const [o, lag, max] of [[ring, 0, 2.4], [echo, 0.12, 2.2], [dome, 0.04, 1.6]] as const) {
      const q = clamp01(p - lag);
      o.visible = q > 0 && q < 1;
      o.scale.setScalar(0.1 + ease(q) * max);
      (o.material as THREE.MeshBasicMaterial).opacity = (1 - q) * (o === dome ? 0.35 : 0.9);
    }
    beam.visible = true;
    (beam.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.12 * Math.sin(clock * 4);
    led.scale.setScalar(p < 0.12 ? 1.8 : 1);
    return;
  }
  if (r.id === 'bulwark') {
    // 0-0.5 s drop, 0.5-1.1 s unfold, hold, 3.4-4.0 s fold, gone to 4.4.
    const drop = ease(clamp01(t / 0.5));
    const open = t < 3.4 ? ease(clamp01((t - 0.5) / 0.6)) : 1 - ease(clamp01((t - 3.4) / 0.6));
    r.m.group.position.y = (1 - drop) * 1.2;
    r.m.group.visible = t < 4.05;
    const [l, rr] = r.m.wings;
    l.rotation.y = (1 - open) * Math.PI / 2;
    rr.rotation.y = -(1 - open) * Math.PI / 2;
    (r.m.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = open > 0.98 ? 2.2 : 0.6 + Math.abs(Math.sin(clock * 12)) * 2;
    return;
  }
  // phantom: materialise (scan sweeps up), walk in place, glitch near the end.
  const m = r.m;
  const form = clamp01(t / 0.9);
  const glitch = t > 3.2 && t < 3.6 && Math.sin(clock * 60) > 0.2;
  m.mat.opacity = 0.55 * ease(form) * (glitch ? 0.35 : 0.9 + 0.1 * Math.sin(clock * 23));
  m.torso.position.x = glitch ? 0.08 * Math.sign(Math.sin(clock * 37)) : 0;
  m.scan.position.y = form * 1.9;
  (m.scan.material as THREE.MeshBasicMaterial).opacity = form < 1 ? 0.9 : 0;
  (m.cone.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.05 * Math.sin(clock * 5);
  const stride = Math.sin(clock * 7) * 0.55;
  m.lLeg.rotation.x = stride; m.rLeg.rotation.x = -stride;
  if (m.lines) m.lines.offset.y = -clock * 0.6;
}

export function KitViewer({ kit, className }: { kit: KitId; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.classList.add('kv-nogl'); // CSS shows the static icon fallback
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    scene.add(new THREE.HemisphereLight(0xF0E6D2, 0x2A2418, 1.1));
    const key = new THREE.DirectionalLight(0xFFF2D6, 2.1); key.position.set(3, 5, 4); scene.add(key);
    const rim = new THREE.PointLight(ACCENT[kit], 6, 8); rim.position.set(-2, 1.6, -1.5); scene.add(rim);

    // Floor disc with a faint grid ring so the model sits on something.
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x17140F, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48), floorMat);
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const haloMat = new THREE.MeshBasicMaterial({ color: ACCENT[kit], transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.28, 64), haloMat);
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.002; scene.add(halo);

    const rig = buildRig(kit);
    scene.add(rig.root);
    // Frame each kit: the dart is tiny, the wall is wide, the decoy is tall.
    const frame = kit === 'recon' ? { y: 0.55, d: 4.2 } : kit === 'bulwark' ? { y: 0.75, d: 4.6 } : { y: 1.0, d: 4.8 };

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const t0 = performance.now();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const clock = (performance.now() - t0) / 1000;
      // Reduced motion: hold the fully-deployed pose, no turntable.
      const loopT = reduce ? LOOP[kit] * 0.6 : clock % LOOP[kit];
      animate(rig, loopT, reduce ? 0 : clock);
      const a = reduce ? 0.6 : clock * 0.45;
      camera.position.set(Math.sin(a) * frame.d, frame.y + 0.9, Math.cos(a) * frame.d);
      camera.lookAt(0, frame.y, 0);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposeRig(rig);
      floor.geometry.dispose(); floorMat.dispose();
      halo.geometry.dispose(); haloMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [kit]);
  return <div ref={host} className={`kit-viewer ${className ?? ''}`} aria-hidden="true" />;
}
