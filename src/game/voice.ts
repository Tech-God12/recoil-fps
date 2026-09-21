// Recoil FPS — Voice announcer + enemy callout voices (Web Speech API, no assets needed)

type VoiceKind = 'announcer' | 'enemy';

class VoiceManager {
  enabled = true;
  private unlocked = false;
  private lastSpoke: Record<string, number> = {};
  private voiceCache: SpeechSynthesisVoice[] = [];

  /** Must be called from a user gesture (Deploy click) */
  unlock() {
    this.unlocked = true;
    try {
      if ('speechSynthesis' in window) {
        // Warm up + cache voices (some browsers load async)
        const load = () => { this.voiceCache = window.speechSynthesis.getVoices(); };
        load();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
          window.speechSynthesis.onvoiceschanged = load;
        }
      }
    } catch { /* speech unsupported — silent fallback */ }
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) this.cancel();
  }

  /** Called on pause: park queued lines so the announcer never talks over the menus. */
  suspend() {
    try { window.speechSynthesis?.pause(); } catch { /* noop */ }
  }

  resume() {
    try { window.speechSynthesis?.resume(); } catch { /* noop */ }
  }

  cancel() {
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  }

  private pickVoice(kind: VoiceKind): SpeechSynthesisVoice | null {
    if (!this.voiceCache.length) return null;
    const en = this.voiceCache.filter(v => v.lang.toLowerCase().startsWith('en'));
    const pool = en.length ? en : this.voiceCache;
    if (kind === 'announcer') {
      // Prefer a deep/default voice for the announcer
      return pool.find(v => /daniel|david|alex|fred|google uk english male/i.test(v.name)) ?? pool[0];
    }
    // Enemy: prefer a different voice so factions are distinguishable
    return pool[pool.length > 1 ? 1 : 0] ?? null;
  }

  private speak(text: string, kind: VoiceKind, opts: { rate?: number; pitch?: number; volume?: number; cooldownMs?: number; key?: string }) {
    if (!this.enabled || !this.unlocked) return;
    if (!('speechSynthesis' in window)) return;
    const now = performance.now();
    const key = opts.key ?? `${kind}:${text}`;
    const cd = opts.cooldownMs ?? 2500;
    if (now - (this.lastSpoke[key] ?? -99999) < cd) return; // anti-spam
    // Never accumulate stale combat chatter in the browser speech queue.
    if (kind === 'enemy' && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) return;
    if (kind === 'announcer' && now-(this.lastSpoke.announcer ?? -99999)<1800) return;
    this.lastSpoke[key] = now;
    if (kind === 'announcer') this.lastSpoke.announcer=now;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pickVoice(kind);
      if (v) u.voice = v;
      u.rate = opts.rate ?? (kind === 'announcer' ? 1.0 : 1.08);
      u.pitch = opts.pitch ?? (kind === 'announcer' ? 0.98 : 1.02);
      u.volume = opts.volume ?? (kind === 'announcer' ? 0.9 : 0.75);
      // Don't stack enemy chatter — announcer may interrupt
      if (kind === 'announcer') window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* noop */ }
  }

  // ---------- Announcer (match + streaks) ----------
  objective(text: string) {
    // Keep announcer lines short and infrequent so they never feel like noise.
    const short = text.length > 180 ? text.slice(0,180).replace(/\s+\S*$/, '') + '.' : text;
    this.speak(short, 'announcer', { key: `objective:${text}`, cooldownMs: 2500, rate: 1.0, volume: 0.6 });
  }

  /** Mission briefing narration for the loading screen — long-form, interrupts nothing. */
  briefing(text: string) {
    this.speak(text, 'announcer', { key: `briefing:${text.slice(0, 40)}`, cooldownMs: 8000, rate: 1.02, volume: 0.85 });
  }

  firstBlood() {
    const lines = ['First blood.', 'Confirmed kill.', 'Target down.'];
    this.speak(lines[Math.floor(Math.random() * lines.length)], 'announcer', { key: 'firstblood', cooldownMs: 60000 });
  }
  streak(label: string) {
    const map: Record<string, string> = {
      'DOUBLE KILL': 'Double kill!',
      'TRIPLE KILL': 'Triple kill!',
      'QUAD KILL': 'Quad kill!',
      'PENTA KILL': 'Penta kill!',
      UNSTOPPABLE: 'Unstoppable!',
    };
    this.speak(map[label] ?? label, 'announcer', { key: `streak:${label}`, cooldownMs: 1500, rate: 1.1 });
  }
  headshot() { this.speak('Headshot.', 'announcer', { key: 'hs', cooldownMs: 5000, volume: 0.6 }); }
  lowAmmo() { this.speak('Reloading.', 'announcer', { key: 'lowammo', cooldownMs: 15000, volume: 0.55 }); }
  defeat() { this.speak('Operator down. Mission failed.', 'announcer', { key: 'lose', cooldownMs: 60000 }); }

  // ---------- DUSTYARD TACTICAL (CS2) announcer ----------
  roundStart() { this.speak('Round start. Buy your gear.', 'announcer', { key: 'cs-start', cooldownMs: 8000, volume: 0.6 }); }
  bombPlanted() { this.speak('The bomb has been planted.', 'announcer', { key: 'cs-planted', cooldownMs: 6000, volume: 0.85 }); }
  bombDefused() { this.speak('Bomb has been defused.', 'announcer', { key: 'cs-defused', cooldownMs: 6000, volume: 0.85 }); }
  bombDropped() { this.speak('The bomb has been dropped.', 'announcer', { key: 'cs-dropped', cooldownMs: 4000, volume: 0.6 }); }
  roundWin() { this.speak('Counter-terrorists win.', 'announcer', { key: 'cs-win', cooldownMs: 3000, volume: 0.85 }); }
  roundLose() { this.speak('Terrorists win.', 'announcer', { key: 'cs-lose', cooldownMs: 3000, volume: 0.85 }); }
  matchWin() { this.speak('You win the match.', 'announcer', { key: 'cs-match-end', cooldownMs: 60000, volume: 0.95 }); }
  matchLose() { this.speak('You lose the match.', 'announcer', { key: 'cs-match-end', cooldownMs: 60000, volume: 0.95 }); }

  // ---------- Enemy squad voices (short barks, anti-spam) ----------
  enemyCallout(kind: string) {
    const lines: Record<string, string[]> = {
      contact: ['Contact front!', 'Enemy spotted!', 'There he is!'],
      flank: ['Flanking!', 'Moving around!', 'Going wide!'],
      grenade: ['Frag out!', 'Grenade!'],
      mandown: ['Man down!', 'We lost one!'],
      fallback: ['Fall back!', 'Pull back!'],
      push: ['Push up!', 'Move in!', 'Take them!'],
    };
    const pool = lines[kind] ?? ['Alert!'];
    const text = pool[Math.floor(Math.random() * pool.length)];
    // Rare (9s cooldown), quiet, steady pitch — voice reads as ambience, never chatter.
    this.speak(text, 'enemy', { key: 'enemy-any', cooldownMs: 9000, rate: 1.05, pitch: 1.0, volume: 0.5 });
  }
}

export const voice = new VoiceManager();
