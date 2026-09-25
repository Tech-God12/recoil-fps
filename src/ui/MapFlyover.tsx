// Recoil FPS — menu map flyover: a live camera hovering above the selected arena.
// Builds the REAL world geometry offscreen (once per map, cached while mounted) and
// slow-orbits a high camera over it, so map selection previews the actual battlefield.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildWorld, type MapId, type World } from '../game/world';

interface Slot {
  scene: THREE.Scene;
  world: World;
}

// Worlds are expensive to build (~hundreds of ms); cache one per map for the
// lifetime of the page so hover/selection swaps are instant after first build.
const slotCache = new Map<MapId, Slot>();

function buildSlot(mapId: MapId): Slot {
  const hit = slotCache.get(mapId);
  if (hit) return hit;
  const scene = new THREE.Scene();
  // Per-arena grade: alrasul desert noon, kasbah overcast stone, arena warm dusk.
  const warm = mapId === 'arena' || mapId === 'sirocco';
  const sky = mapId === 'alrasul' ? 0xC9BB9E : mapId === 'sirocco' ? 0xE3C597 : mapId === 'arena' ? 0xD8B98E : 0xAEBAC0;
  const haze = mapId === 'alrasul' ? 0xC6B89C : mapId === 'sirocco' ? 0xD9B98A : mapId === 'arena' ? 0xC9A87E : 0xB4C0C5;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(haze, 160, 520);
  scene.add(new THREE.HemisphereLight(warm ? 0xF2D9B0 : 0xCFE0EE, 0x8C765A, 0.85));
  const sun = new THREE.DirectionalLight(warm ? 0xFFC98A : 0xFFE4BE, 2.6);
  if (mapId === 'sirocco') sun.position.set(-70, 45, 30); else sun.position.set(-65, 80, 40);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x8A7A60, 0.2));
  const world = buildWorld(scene, mapId);
  const slot = { scene, world };
  slotCache.set(mapId, slot);
  return slot;
}

export default function MapFlyover({ mapId, active }: { mapId: MapId; active: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !active) return;
    let disposed = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let slot: Slot | null = null;
    let cleanupExtra: (() => void) | null = null;

    // Defer the heavy world build off the interaction frame so the click/hover
    // stays snappy; the artwork underneath covers the build gap.
    const timer = window.setTimeout(() => {
      if (disposed) return;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.domElement.className = 'flyover-canvas';
        slot = buildSlot(mapId);
      } catch {
        renderer?.dispose();
        renderer = null;
        return; // WebGL unavailable — the static artwork stays.
      }
      mount.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(48, 1, 1, 900);
      const resize = () => {
        if (!renderer) return;
        const w = mount.clientWidth || 2;
        const h = mount.clientHeight || 2;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(mount);
      const t0 = performance.now();
      const loop = () => {
        if (disposed || !renderer || !slot) return;
        raf = requestAnimationFrame(loop);
        const t = (performance.now() - t0) / 1000;
        const a = t * 0.045; // slow drift around the arena
        const r = slot.world.half * 0.72;
        camera.position.set(Math.sin(a) * r, (mapId === 'sirocco' ? 54 : 74) + Math.sin(t * 0.11) * 5, Math.cos(a) * r);
        camera.lookAt(0, 4, 0);
        renderer.render(slot.scene, camera);
        mount.dataset.live = 'true';
      };
      raf = requestAnimationFrame(loop);
      cleanupExtra = () => ro.disconnect();
    }, 60);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      cleanupExtra?.();
      // Cached scenes stay alive for instant re-hover; only the GL context goes.
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
      delete mount.dataset.live;
    };
  }, [mapId, active]);

  return <div ref={mountRef} className="flyover-root" aria-hidden="true" />;
}
