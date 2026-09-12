import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, DEFAULT_SETTINGS, type GameEvent, type GameSettings, type HudState } from './game/engine';
import Hud, { type HudFx } from './ui/Hud';
import Settings from './ui/Settings';
import { MainMenu, PauseMenu, ResultsScreen, type Results } from './ui/Screens';

type Phase = 'menu' | 'playing' | 'paused' | 'results';
const SETTINGS_KEY = 'recoilfps.settings.v1';
const DEFAULT_HUD: HudState = {
  hp: 100, mag: 30, magSize: 30, reserve: Infinity, weapon: 'M4A1 SOPMOD', reloading: false, reloadStage: 'idle',
  frags: 5, flashes: 2, bearing: 0, kills: 0, enemiesLeft: 0, cooking: false, sprinting: false,
  interacting: false, canVault: false, ads: 0, spread: 0, pings: [], radarEnemies: [],
  mapImage: '', playerMap: { nx: 0.5, nz: 0.5 }, enemiesMap: [], fps: 60,
};
const emptyFx = (): HudFx => ({ hitmark: null, feed: [], dmgArcs: [], scorePops: [], banner: null, callout: null, flashPow: 0, missionBanner: null });

function loadSettings(): GameSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...raw, map: raw.map === 'kasbah' ? 'kasbah' : 'alrasul' };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const phaseRef = useRef<Phase>('menu');
  const session = useRef(0);
  const ids = useRef(0);
  const timers = useRef(new Set<number>());
  const [phase, setPhase] = useState<Phase>('menu');
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');
  const [hud, setHud] = useState(DEFAULT_HUD);
  const [results, setResults] = useState<Results | null>(null);
  const [fx, setFx] = useState<HudFx>(emptyFx);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

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
      case 'hit':
        setFx(f => ({ ...f, hitmark: { id, kill: event.kill } }));
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
      case 'end':
        engineRef.current?.setPaused(true);
        changePhase('results');
        setResults({ ...event });
        if (document.pointerLockElement) document.exitPointerLock();
        break;
    }
  }, [changePhase, later]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const interval = window.setInterval(() => {
      if (engineRef.current) setHud(engineRef.current.hud());
    }, 50);
    return () => window.clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    const lockChanged = () => {
      const engine = engineRef.current;
      if (!engine || phaseRef.current === 'results' || phaseRef.current === 'menu') return;
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

  const deploy = async () => {
    if (!canvasRef.current || launching) return;
    const epoch = ++session.current;
    clearTimers();
    setLaunching(true); setError(''); setShowSettings(false); setResults(null); setFx(emptyFx());
    engineRef.current?.dispose(); engineRef.current = null;
    try {
      const engine = new Engine(canvasRef.current, settings.difficulty, e => { if (session.current === epoch) onEvent(e); }, settings.map);
      engineRef.current = engine;
      engine.applySettings(settings);
      changePhase('paused');
      engine.start();
      setHud(engine.hud());
      // Keep mouse capture in the click's user activation; do not delay it behind a wipe.
      await engine.requestLock();
      if (session.current === epoch && document.pointerLockElement === canvasRef.current) {
        engine.setPaused(false); changePhase('playing');
      }
    } catch (cause) {
      if (session.current !== epoch) return;
      setError(cause instanceof Error ? cause.message : 'Mission could not start. Try again.');
      if (engineRef.current) { engineRef.current.setPaused(true); changePhase('paused'); }
      else changePhase('menu');
    } finally {
      if (session.current === epoch) setLaunching(false);
    }
  };

  const resume = async () => {
    const epoch = session.current;
    try {
      const engine = engineRef.current;
      if (!engine) return;
      await engine.requestLock();
      if (epoch === session.current && document.pointerLockElement === canvasRef.current) { engine.setPaused(false); changePhase('playing'); }
    } catch { if (epoch === session.current) setError('Mouse capture was blocked. Select Resume to try again.'); }
  };

  const quit = () => {
    session.current++; clearTimers(); engineRef.current?.dispose(); engineRef.current = null;
    changePhase('menu'); setShowSettings(false); setError(''); setFx(emptyFx()); setHud(DEFAULT_HUD);
    if (document.pointerLockElement) document.exitPointerLock();
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setError('Fullscreen is unavailable. You can continue in this window.'); }
  };

  return (
    <div className="w-full h-full relative bg-black overflow-hidden app-root">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-label="Recoil FPS game world" />
      {(phase === 'playing' || phase === 'paused') && <Hud hud={hud} s={settings} fx={fx} />}
      {phase === 'menu' && <MainMenu s={settings} onDeploy={deploy} onSettings={() => setShowSettings(true)} onMap={map => set({ map })} />}
      {phase === 'paused' && !showSettings && <PauseMenu mission={hud.mission} onResume={resume} onRestart={deploy} onSettings={() => setShowSettings(true)} onQuit={quit} />}
      {phase === 'results' && results && <ResultsScreen r={results} onRedeploy={deploy} onMenu={quit} />}
      {showSettings && <Settings s={settings} set={set} onClose={() => setShowSettings(false)} />}
      <div className="absolute top-3 right-4 z-50 flex gap-2">
        <button onClick={fullscreen} className="util-btn">FULLSCREEN</button>
      </div>
      {error && <div className="mission-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss message">Close</button></div>}
      {launching && <div className="mission-loading" role="status">Preparing mission...</div>}
    </div>
  );
}