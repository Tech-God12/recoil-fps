import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, DEFAULT_SETTINGS, type GameEvent, type GameSettings, type HudState } from './game/engine';
import type { MapId } from './game/world';
import Hud, { type HudFx } from './ui/Hud';
import Settings from './ui/Settings';
import { MainMenu, MapSelect, MissionBriefing, PauseMenu, ResultsScreen, type Results } from './ui/Screens';
import Armory from './ui/armory/Armory';
import { getMission } from './game/systems/mission';
import { voice } from './game/voice';
import { grantCash, loadProfile, saveProfile, applyDevFunds, type PlayerProfile } from './game/economy/profile';
import { gradeBonus, gradeFor } from './game/economy/rewards';

type Phase = 'menu' | 'mapselect' | 'briefing' | 'playing' | 'paused' | 'results' | 'armory';
const SETTINGS_KEY = 'recoilfps.settings.v1';

/**
 * Resolves once the browser has painted. Two animation frames, because the first one
 * fires before paint — a single rAF is not enough to guarantee the loading screen is
 * actually visible before we start blocking the main thread.
 */
const afterPaint = () => new Promise<void>(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});
const DEFAULT_HUD: HudState = {
  hp: 100, mag: 30, magSize: 30, weapon: 'M416', reloading: false, reloadStage: 'idle',
  frags: 5, flashes: 2, bearing: 0, kills: 0, score: 0, enemiesLeft: 0, cooking: false, sprinting: false,
  canVault: false, ads: 0, spread: 0, cash: 0, secondaryWeapon: '', heldSlot: 'primary',
  bipodDeployed: false, reticle: 'none', zoomMag: 0, lpvoHigh: false, pumping: false, pings: [],
  mapImage: '', playerMap: { nx: 0.5, nz: 0.5 }, enemiesMap: [], fps: 60, worldHalf: 104,
};
const emptyFx = (): HudFx => ({ hitmark: null, feed: [], dmgArcs: [], scorePops: [], banner: null, callout: null, flashPow: 0, missionBanner: null });

export interface ResultsWallet { before: number; after: number; gradeBonus: number; earned: number; devFunds: boolean }

function loadSettings(): GameSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...raw, map: raw.map === 'kasbah' ? 'kasbah' : 'alrasul' };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  /** Which arena the current engine has built (map-select flyover reuses it). */
  const engineMapRef = useRef<MapId | null>(null);
  const phaseRef = useRef<Phase>('menu');
  const session = useRef(0);
  const ids = useRef(0);
  const timers = useRef(new Set<number>());
  const [phase, setPhase] = useState<Phase>('menu');
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  const [hud, setHud] = useState(DEFAULT_HUD);
  const [results, setResults] = useState<Results | null>(null);
  const [wallet, setWallet] = useState<ResultsWallet | null>(null);
  const [fx, setFx] = useState<HudFx>(emptyFx);
  const [profile, setProfile] = useState<PlayerProfile>(loadProfile);
  const [armoryFrom, setArmoryFrom] = useState<'menu' | 'results'>('menu');
  // Map-select state: flyover readiness + which arena is loading + its arena scan image.
  const [previewReady, setPreviewReady] = useState(false);
  const [loadingMap, setLoadingMap] = useState<MapId | null>(null);
  const [previewImage, setPreviewImage] = useState('');
  /** True while the briefing narration/finish timers are live (ESC must clear them). */
  const briefingTimersRef = useRef(false);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const updateProfile = useCallback((next: PlayerProfile) => {
    // Dev wallet: every save refills to the floor, so the armory is an open range.
    const funded = applyDevFunds(next);
    profileRef.current = funded;
    setProfile(funded);
    saveProfile(funded);
  }, []);

  // Hidden balance-testing affordance: #cash=50000 on the menu grants it once per pageload.
  useEffect(() => {
    const m = window.location.hash.match(/#cash=(\d+)/);
    if (!m) return;
    const amt = Math.min(999999, parseInt(m[1], 10));
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (amt > 0) {
      updateProfile(grantCash(profileRef.current, amt, 'DEV'));
    }
  }, [updateProfile]);

  const later = useCallback((fn: () => void, delay: number) => {
    const epoch = session.current;
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      if (epoch === session.current) fn();
    }, delay);
    timers.current.add(id);
  }, []);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current.clear();
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Storage is optional. */ }
    engineRef.current?.applySettings(settings);
  }, [settings]);
  const set = useCallback((patch: Partial<GameSettings>) => setSettings(previous => ({ ...previous, ...patch })), []);

  const onEvent = useCallback((event: GameEvent) => {
    const id = ++ids.current;
    switch (event.type) {
      case 'graphics':
        setError(event.text); changePhase('paused');
        break;
      case 'hit':
        // Clear from state on a timer — the CSS fade alone leaves the element mounted,
        // which is how the headshot-kill marker could stick around on screen.
        setFx(f => ({ ...f, hitmark: { id, kill: event.kill } }));
        later(() => setFx(f => f.hitmark?.id === id ? { ...f, hitmark: null } : f), event.kill ? 460 : 210);
        break;
      case 'kill':
        setFx(f => ({
          ...f,
          feed: [...f.feed.slice(-2), { id, text: `YOU  [${event.weapon}]  ${event.name}`, headshot: event.headshot }],
          scorePops: [...f.scorePops.slice(-2), { id, text: event.headshot ? '+150 HEADSHOT' : '+100', headshot: event.headshot }],
        }));
        later(() => setFx(f => ({ ...f, feed: f.feed.filter(row => row.id !== id) })), 5200);
        later(() => setFx(f => ({ ...f, scorePops: f.scorePops.filter(row => row.id !== id) })), 1300);
        break;
      case 'cash':
        setFx(f => ({
          ...f,
          scorePops: [...f.scorePops.slice(-2), { id, text: `+$${event.amount}`, headshot: false, cash: true }],
        }));
        later(() => setFx(f => ({ ...f, scorePops: f.scorePops.filter(row => row.id !== id) })), 1300);
        break;
      case 'damage':
        setFx(f => ({ ...f, dmgArcs: [...f.dmgArcs.slice(-3), { id, dir: event.dir, opacity: Math.min(1, Math.max(0.35, event.amount / 80)) }] }));
        later(() => setFx(f => ({ ...f, dmgArcs: f.dmgArcs.filter(row => row.id !== id) })), 1500);
        break;
      case 'flash':
        setFx(f => ({ ...f, flashPow: event.power }));
        later(() => setFx(f => ({ ...f, flashPow: 0 })), 300);
        break;
      case 'callout':
        setFx(f => ({ ...f, callout: { id, text: event.text } }));
        later(() => setFx(f => f.callout?.id === id ? { ...f, callout: null } : f), 4000);
        break;
      case 'streak':
        setFx(f => ({ ...f, banner: { id, label: event.label } }));
        later(() => setFx(f => f.banner?.id === id ? { ...f, banner: null } : f), 1600);
        break;
      case 'objective':
        setFx(f => ({ ...f, missionBanner: { id, title: event.phase.title, index: event.index } }));
        later(() => setFx(f => f.missionBanner?.id === id ? { ...f, missionBanner: null } : f), 2600);
        break;
      case 'end': {
        engineRef.current?.setPaused(true);
        // Debrief payout: run cash × difficulty, plus the grade bonus on a win.
        // (Losses keep 100% of earned cash but forfeit extraction + grade.)
        const gb = event.win ? gradeBonus(gradeFor(event).grade) : 0;
        const earned = Math.round(event.cash * event.difficultyMul) + gb;
        const before = profileRef.current;
        const next = applyDevFunds(grantCash(before, earned, 'MISSION'));
        next.missions += 1;
        next.kills += event.kills;
        updateProfile(next);
        setWallet({ before: before.cash, after: next.cash, gradeBonus: gb, earned, devFunds: next.devFunds });
        changePhase('results');
        setResults({ ...event });
        if (document.pointerLockElement) document.exitPointerLock();
        break;
      }
    }
  }, [changePhase, later, updateProfile]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const interval = window.setInterval(() => {
      if (engineRef.current) setHud(engineRef.current.hud());
    }, 50);
    return () => window.clearInterval(interval);
  }, [phase]);

  /** Ends the briefing and starts the fight. `fromClick` (the DEPLOY button) rides the
   *  click's user activation to grab the mouse; the auto-finish falls back to click-to-lock. */
  const finishBriefing = useCallback((fromClick: boolean) => {
    clearTimers();
    briefingTimersRef.current = false;
    const engine = engineRef.current;
    if (!engine || phaseRef.current !== 'briefing') return;
    engine.start(); // clock starts when the player actually deploys — the briefing is frozen time
    setHud(engine.hud());
    engine.setPaused(false);
    changePhase('playing');
    if (fromClick) void engine.requestLock().catch(() => { /* click-to-lock fallback below */ });
  }, [changePhase, clearTimers]);

  /** Back out of a briefing: park narration, return to the flyover (engine is reused). */
  const abortBriefing = useCallback(() => {
    voice.cancel();
    clearTimers();
    briefingTimersRef.current = false;
    changePhase('mapselect');
  }, [changePhase, clearTimers]);

  useEffect(() => {
    const lockChanged = () => {
      const engine = engineRef.current;
      if (!engine || phaseRef.current === 'results' || phaseRef.current === 'menu' || phaseRef.current === 'armory' || phaseRef.current === 'mapselect' || phaseRef.current === 'briefing') return;
      if (document.pointerLockElement === canvasRef.current) {
        engine.setPaused(false);
        changePhase('playing');
        setError('');
      } else if (phaseRef.current === 'playing') {
        engine.setPaused(true);
        setHud(engine.hud());
        changePhase('paused');
      }
    };
    const lockError = () => { engineRef.current?.setPaused(true); setError('Mouse capture was blocked. Select Resume to try again.'); };
    const blur = () => {
      if (phaseRef.current !== 'playing') return;
      engineRef.current?.setPaused(true);
      changePhase('paused');
      if (document.pointerLockElement) document.exitPointerLock();
    };
    document.addEventListener('pointerlockchange', lockChanged);
    document.addEventListener('pointerlockerror', lockError);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerlockchange', lockChanged);
      document.removeEventListener('pointerlockerror', lockError);
      window.removeEventListener('blur', blur);
    };
  }, [changePhase]);

  useEffect(() => () => { session.current++; clearTimers(); engineRef.current?.dispose(); }, [clearTimers]);

  /* ================= MAP-SELECT FLYOVER ================= */

  /** Build (or reuse) the engine for a map, then hover the flyover camera above it. */
  const prepareEngine = useCallback(async (map: MapId) => {
    if (!canvasRef.current) return;
    const existing = engineRef.current;
    if (existing && engineMapRef.current === map && !existing.isEnded()) {
      existing.enterArenaPreview();
      setPreviewImage(existing.arenaImage);
      setPreviewReady(true);
      setLoadingMap(null);
      return;
    }
    const epoch = ++session.current;
    clearTimers();
    voice.cancel();
    setError('');
    setPreviewReady(false);
    setLoadingMap(map);
    existing?.dispose();
    engineRef.current = null;
    await afterPaint();
    if (session.current !== epoch) return;
    try {
      const engine = await Engine.create(canvasRef.current, settings.difficulty, e => { if (session.current === epoch) onEvent(e); }, map, profileRef.current.loadout);
      if (session.current !== epoch) { engine.dispose(); return; }
      engineRef.current = engine;
      engineMapRef.current = map;
      engine.applySettings(settings);
      setPreviewImage(engine.arenaImage);
      engine.enterArenaPreview();
      setPreviewReady(true);
      setLoadingMap(null);
    } catch (cause) {
      if (session.current !== epoch) return;
      setLoadingMap(null);
      setError(cause instanceof Error ? cause.message : 'Arena preview could not start. Try again.');
      changePhase('menu');
    }
  }, [changePhase, clearTimers, onEvent, settings]);

  const openMapSelect = useCallback(() => {
    setShowSettings(false);
    setResults(null);
    setWallet(null);
    setFx(emptyFx());
    changePhase('mapselect');
  }, [changePhase]);

  const backToMenu = useCallback(() => {
    session.current++;
    clearTimers();
    voice.cancel();
    engineRef.current?.dispose();
    engineRef.current = null;
    engineMapRef.current = null;
    setPreviewReady(false);
    setPreviewImage('');
    changePhase('menu');
    setShowSettings(false);
    setError('');
    setFx(emptyFx());
    setHud(DEFAULT_HUD);
  }, [changePhase, clearTimers]);

  // Entering the arena picker brings the selected map's camera online automatically,
  // so the flyover is live (or visibly loading) the moment the two cards appear.
  const prepareRef = useRef(prepareEngine);
  prepareRef.current = prepareEngine;
  const mapRef = useRef(settings.map);
  mapRef.current = settings.map;
  useEffect(() => {
    if (phase !== 'mapselect') return;
    void prepareRef.current(mapRef.current);
  }, [phase]);

  /* ================= DEPLOY: briefing with objectives + narration ================= */


  const beginMission = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setError('');
    setFx(emptyFx());
    voice.unlock(); // inside the click's user activation
    engine.exitArenaPreview(); // gameplay camera; the sim stays frozen behind the briefing
    changePhase('briefing');
    // Narrate the operation while the objectives are on screen; nothing simulates yet.
    const mission = getMission(settings.map);
    later(() => voice.objective(`Operation ${mission.name}. ${mission.brief}`), 350);
    const route = mission.phases.map((p, i) => `${i + 1}: ${p.title}`).join('. ');
    later(() => voice.objective(`Objectives. ${route}`), 6500);
    later(() => finishBriefing(false), 10500);
  }, [changePhase, finishBriefing, later, settings.map]);

  /* ================= LEGACY DEPLOY PATHS ================= */

  /** REDEPLOY / RESTART: fresh arena, straight back to the map-select flyover. */
  const redeploy = useCallback(() => {
    session.current++;
    clearTimers();
    voice.cancel();
    engineRef.current?.dispose();
    engineRef.current = null;
    engineMapRef.current = null;
    setPreviewReady(false);
    setPreviewImage('');
    setResults(null);
    setWallet(null);
    setFx(emptyFx());
    changePhase('mapselect');
    if (document.pointerLockElement) document.exitPointerLock();
  }, [changePhase, clearTimers]);

  const resume = async () => {
    const epoch = session.current;
    try {
      const engine = engineRef.current;
      if (!engine) return;
      engine.start(); // idempotent — completes a briefing interrupted by ESC
      await engine.requestLock();
      if (epoch === session.current && document.pointerLockElement === canvasRef.current) { engine.setPaused(false); changePhase('playing'); }
    } catch { if (epoch === session.current) setError('Mouse capture was blocked. Select Resume to try again.'); }
  };

  const quit = () => {
    backToMenu();
    if (document.pointerLockElement) document.exitPointerLock();
  };

  const openArmory = (from: 'menu' | 'results') => {
    setArmoryFrom(from);
    setShowSettings(false);
    changePhase('armory');
    if (document.pointerLockElement) document.exitPointerLock();
  };
  const armoryBack = () => {
    changePhase(armoryFrom === 'results' && results ? 'results' : 'menu');
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setError('Fullscreen is unavailable. You can continue in this window.'); }
  };

  /** Armory DEPLOY: reuse the flyover engine when it matches, else route via map select. */
  const deployFromArmory = useCallback(async () => {
    const engine = engineRef.current;
    if (engine && engineMapRef.current === settings.map && !engine.isEnded()) {
      await beginMission();
    } else {
      redeploy();
    }
  }, [beginMission, redeploy, settings.map]);

  return (
    <div className="w-full h-full relative bg-black overflow-hidden app-root">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        aria-label="Recoil FPS game world"
        onPointerDown={() => {
          if (phaseRef.current === 'playing' && document.pointerLockElement !== canvasRef.current) {
            void engineRef.current?.requestLock().catch(() => {});
          }
        }}
      />
      {(phase === 'playing' || phase === 'paused') && <Hud hud={hud} s={settings} fx={fx} />}
      {phase === 'menu' && <MainMenu s={settings} onStart={openMapSelect} onSettings={() => setShowSettings(true)} onMap={map => set({ map })} onArmory={() => openArmory('menu')} profile={profile} />}
      {phase === 'mapselect' && (
        <MapSelect
          selected={settings.map}
          ready={previewReady}
          loadingMap={loadingMap}
          previewImage={previewImage}
          onHover={map => { if (map === settings.map && previewReady) engineRef.current?.enterArenaPreview(); }}
          onSelect={map => { if (map !== settings.map) set({ map }); void prepareEngine(map); }}
          onDeploy={beginMission}
          onBack={backToMenu}
        />
      )}
      {phase === 'briefing' && <MissionBriefing map={settings.map} onDeploy={() => finishBriefing(true)} onBack={abortBriefing} />}
      {phase === 'paused' && !showSettings && <PauseMenu mission={hud.mission} onResume={resume} onRestart={redeploy} onSettings={() => setShowSettings(true)} onQuit={quit} />}
      {phase === 'results' && results && wallet && <ResultsScreen r={results} wallet={wallet} onRedeploy={redeploy} onMenu={quit} onArmory={() => openArmory('results')} />}
      {phase === 'armory' && <Armory profile={profile} onProfile={updateProfile} onDeploy={deployFromArmory} onBack={armoryBack} />}
      {showSettings && <Settings s={settings} set={set} onClose={() => setShowSettings(false)} />}
      {phase !== 'playing' && !showSettings && <div className="fullscreen-control">
        <button onClick={fullscreen} className="util-btn inline-flex items-center gap-2" title="Toggle fullscreen"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" /></svg>Fullscreen</button>
      </div>}
      {error && <div className="mission-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss message">DISMISS</button></div>}
    </div>
  );
}
