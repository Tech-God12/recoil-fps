import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, DEFAULT_SETTINGS, type GameEvent, type GameSettings, type HudState } from './game/engine';
import Hud, { type HudFx } from './ui/Hud';
import Settings from './ui/Settings';
import { MainMenu, PauseMenu, ResultsScreen, BootScreen, type Results } from './ui/Screens';
import Armory from './ui/armory/Armory';
import TdmSetup from './ui/TdmSetup';
import { grantCash, loadProfile, saveProfile, type PlayerProfile } from './game/economy/profile';
import { gradeBonus, gradeFor } from './game/economy/rewards';
import type { TDMArmor } from './game/tdm';

type Phase = 'menu' | 'playing' | 'paused' | 'results' | 'armory' | 'tdm-setup';
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
  bipodDeployed: false, reticle: 'none', scopePower:1, scopeMinPower:1, scopeMaxPower:1, scopeAdjusting:false, canted:false, zoomFov: 60, lpvoHigh: false, pumping: false, pings: [],
  mapImage: '', playerMap: { nx: 0.5, nz: 0.5 }, enemiesMap: [], fps: 60, worldHalf: 104,
};
const emptyFx = (): HudFx => ({ hitmark: null, feed: [], dmgArcs: [], scorePops: [], banner: null, callout: null, flashPow: 0, missionBanner: null });

export interface ResultsWallet { before: number; after: number; gradeBonus: number; earned: number }

/** Testing economy: bottomless wallet so every gun and attachment can be trialled. */
const DEV_WALLET = 9_999_999;
function loadRichProfile(): PlayerProfile {
  const p = loadProfile();
  return p.cash < DEV_WALLET ? grantCash(p, DEV_WALLET - p.cash, 'DEV') : p;
}

function loadSettings(): GameSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...raw, map: raw.map === 'kasbah' ? 'kasbah' : raw.map === 'arena' ? 'arena' : 'alrasul' };
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
  const [wallet, setWallet] = useState<ResultsWallet | null>(null);
  const [fx, setFx] = useState<HudFx>(emptyFx);
  const [profile, setProfile] = useState<PlayerProfile>(loadRichProfile);
  const [armoryFrom, setArmoryFrom] = useState<'menu' | 'results'>('menu');
  const [tdmArmor, setTdmArmor] = useState<TDMArmor>(1);
  // Which MainMenu screen to show when phase returns to 'menu' (so leaving the
  // TDM loadout screen lands back on Arena Mode, not the home screen).
  const [menuView, setMenuView] = useState<'home' | 'arena'>('home');
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const updateProfile = useCallback((next: PlayerProfile) => {
    profileRef.current = next;
    setProfile(next);
    saveProfile(next);
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
        setFx(f => ({ ...f, hitmark: { id, kill: event.kill } }));
        // Hitmarkers must never linger: clear after the flash unless a newer one replaced it.
        later(() => setFx(f => f.hitmark?.id === id ? { ...f, hitmark: null } : f), event.kill ? 450 : 260);
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
      case 'tdmfeed':
        setFx(f => ({
          ...f,
          feed: [...f.feed.slice(-3), { id, text: '', headshot: event.headshot, tdm: { killer: event.killer, weapon: event.weapon, victim: event.victim, killerTeam: event.killerTeam } }],
          ...(event.killer === 'YOU' ? { scorePops: [...f.scorePops.slice(-2), { id, text: event.headshot ? '+150 HEADSHOT' : '+100', headshot: event.headshot }] } : {}),
        }));
        later(() => setFx(f => ({ ...f, feed: f.feed.filter(row => row.id !== id) })), 5200);
        if (event.killer === 'YOU') later(() => setFx(f => ({ ...f, scorePops: f.scorePops.filter(row => row.id !== id) })), 1300);
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
        const next = grantCash(before, earned, 'MISSION');
        next.missions += 1;
        next.kills += event.kills;
        updateProfile(next);
        setWallet({ before: before.cash, after: next.cash, gradeBonus: gb, earned });
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

  useEffect(() => {
    const lockChanged = () => {
      const engine = engineRef.current;
      if (!engine || phaseRef.current === 'results' || phaseRef.current === 'menu' || phaseRef.current === 'armory' || phaseRef.current === 'tdm-setup') return;
      if (document.pointerLockElement === canvasRef.current) {
        engine.setPaused(false);
        changePhase('playing');
        setError('');
      } else if (phaseRef.current === 'playing' && !engine.scopeAdjusting) {
        engine.setPaused(true);
        setHud(engine.hud());
        changePhase('paused');
      }
    };
    const lockError = () => { engineRef.current?.setPaused(true); if(engineRef.current)setHud(engineRef.current.hud()); changePhase('paused'); setError('Mouse capture was blocked. Select Resume to try again.'); };
    const blur = () => {
      if (phaseRef.current !== 'playing') return;
      engineRef.current?.setPaused(true);
      if(engineRef.current)setHud(engineRef.current.hud());
      changePhase('paused');
      if (document.pointerLockElement) document.exitPointerLock();
    };
    const scopeEscape = (e: KeyboardEvent) => {
      if(e.code==='Escape' && engineRef.current?.scopeAdjusting){ engineRef.current.setPaused(true); setHud(engineRef.current.hud()); changePhase('paused'); }
    };
    window.addEventListener('keydown',scopeEscape);
    document.addEventListener('pointerlockchange', lockChanged);
    document.addEventListener('pointerlockerror', lockError);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown',scopeEscape);
      document.removeEventListener('pointerlockchange', lockChanged);
      document.removeEventListener('pointerlockerror', lockError);
      window.removeEventListener('blur', blur);
    };
  }, [changePhase]);

  useEffect(() => () => { session.current++; clearTimers(); engineRef.current?.dispose(); }, [clearTimers]);

  /** Deploy entry point: launches the match directly for every map. The arena
   * loadout screen is reached explicitly via "Set up loadout" in Arena Mode.
   * `mapOverride` beats the (possibly not-yet-committed) settings state so
   * "Play" in Arena Mode can never race the map selection. */
  const deploy = async (mapOverride?: GameSettings['map']) => {
    await launch(mapOverride);
  };

  const launch = async (mapOverride?: GameSettings['map']) => {
    if (!canvasRef.current || launching) return;
    const map = mapOverride ?? settings.map;
    if (mapOverride && mapOverride !== settings.map) set({ map: mapOverride });
    const epoch = ++session.current;
    clearTimers();
    setLaunching(true); setError(''); setShowSettings(false); setResults(null); setWallet(null); setFx(emptyFx());
    // The boot screen must be the ONLY thing on screen — leaving the loadout
    // phase mounted produced the "loading + loadout at the same time" overlap.
    if (phaseRef.current === 'tdm-setup') changePhase('menu');
    engineRef.current?.dispose(); engineRef.current = null;
    // Let React commit and the browser actually paint the boot screen before any of the
    // heavy mission build starts. Without this the deploy click blocked the main thread
    // first, so the player stared at a frozen menu with no loading state at all.
    await afterPaint();
    if (session.current !== epoch) return;
    try {
      const engine = await Engine.create(canvasRef.current, settings.difficulty, e => { if (session.current === epoch) onEvent(e); }, map, profileRef.current.loadout, tdmArmor);
      engineRef.current = engine;
      engine.applySettings(settings);
      changePhase('paused');
      engine.start();
      setHud(engine.hud());
      // Pointer lock can be rejected when the build outlived the click's user
      // activation — that is NOT a failed launch. Land on the pause menu with a
      // clear hint instead of bouncing the player anywhere.
      try {
        await engine.requestLock();
      } catch {
        if (session.current === epoch) setError('Click Resume to capture the mouse and start.');
      }
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
    // Leaving an arena match returns to the Arena Mode screen, not the home menu.
    setMenuView(settings.map === 'arena' ? 'arena' : 'home');
    changePhase('menu'); setShowSettings(false); setError(''); setFx(emptyFx()); setHud(DEFAULT_HUD);
    if (document.pointerLockElement) document.exitPointerLock();
  };

  const openArmory = (from: 'menu' | 'results') => {
    setArmoryFrom(from);
    if (from === 'menu') setMenuView('home'); // armory is only reachable from home
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

  return (
    <div className="w-full h-full relative bg-black overflow-hidden app-root">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-label="Recoil FPS game world" />
      {(phase === 'playing' || phase === 'paused') && <Hud active={phase === 'playing'} hud={hud} s={settings} fx={fx} onScopePower={power=>engineRef.current?.setScopePower(power)} onScopeAdjust={()=>engineRef.current?.beginScopeAdjustment()} onScopeDone={()=>{void engineRef.current?.finishScopeAdjustment().catch(()=>{engineRef.current?.setPaused(true);changePhase('paused');setError('Mouse capture was blocked. Select Resume to try again.');});}} />}
      {phase === 'menu' && <MainMenu s={settings} onDeploy={map => { void deploy(map); }} onSettings={() => setShowSettings(true)} onMap={map => set({ map })} onArmory={() => openArmory('menu')} onArenaSetup={() => { setMenuView('arena'); changePhase('tdm-setup'); }} initialView={menuView} profile={profile} />}
      {phase === 'paused' && !showSettings && <PauseMenu mission={hud.mission} onResume={resume} onRestart={() => { void deploy(); }} onSettings={() => setShowSettings(true)} onQuit={quit} />}
      {phase === 'results' && results && wallet && <ResultsScreen r={results} wallet={wallet} onRedeploy={() => { void deploy(); }} onMenu={quit} onArmory={() => openArmory('results')} />}
      {phase === 'armory' && <Armory profile={profile} onProfile={updateProfile} onDeploy={() => { void deploy(); }} onBack={armoryBack} />}
      {phase === 'tdm-setup' && !launching && (
        <TdmSetup
          profile={profile}
          onProfile={updateProfile}
          armor={tdmArmor}
          onArmor={setTdmArmor}
          onDeploy={() => { void launch('arena'); }}
          onBack={() => { setMenuView('arena'); changePhase('menu'); }}
        />
      )}
      {showSettings && <Settings s={settings} set={set} onClose={() => setShowSettings(false)} />}
      {phase !== 'playing' && !showSettings && <div className="fullscreen-control">
        <button onClick={fullscreen} className="util-btn inline-flex items-center gap-2" title="Toggle fullscreen"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" /></svg>Fullscreen</button>
      </div>}
      {error && <div className="mission-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss message">DISMISS</button></div>}
      {launching && <BootScreen map={settings.map} />}
    </div>
  );
}
