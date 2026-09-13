// Recoil FPS — radio lines. Captions are the voice; we never use robotic TTS.

type VoiceKind = 'announcer' | 'enemy';

class VoiceManager {
  enabled = true;
  private unlocked = false;
  private lastSpoke: Record<string, number> = {};

  /** Must be called from a user gesture (Deploy click) */
  unlock() {
    this.unlocked = true;
  }

  setEnabled(v: boolean) {
    this.enabled = v;
  }

  private speak(text: string, _kind: VoiceKind, opts: { cooldownMs?: number; key?: string }) {
    if (!this.enabled || !this.unlocked) return;
    const now = performance.now();
    const key = opts.key ?? text;
    const cd = opts.cooldownMs ?? 2500;
    if (now - (this.lastSpoke[key] ?? -99999) < cd) return;
    this.lastSpoke[key] = now;
  }

  objective(text: string) {
    const short = text.length > 72 ? text.slice(0, 72) + '…' : text;
    this.speak(short, 'announcer', { key: `objective:${text}`, cooldownMs: 2500 });
  }

  missionStart() {
    this.speak('Weapons free. Push to the marker.', 'announcer', { key: 'mission', cooldownMs: 60000 });
  }
  firstBlood() {
    this.speak('First blood.', 'announcer', { key: 'firstblood', cooldownMs: 60000 });
  }
  halfway() {
    this.speak('They are breaking. Keep pushing.', 'announcer', { key: 'half', cooldownMs: 60000 });
  }
  streak(label: string) {
    const map: Record<string, string> = {
      'DOUBLE KILL': 'Double kill!',
      'MULTI KILL': 'Multi kill!',
      'MEGA KILL': 'Mega kill!',
      UNSTOPPABLE: 'Unstoppable!',
    };
    this.speak(map[label] ?? label, 'announcer', { key: `streak:${label}`, cooldownMs: 1500 });
  }
  headshot() { this.speak('Headshot.', 'announcer', { key: 'hs', cooldownMs: 5000 }); }
  lowAmmo() { this.speak('Reloading.', 'announcer', { key: 'lowammo', cooldownMs: 15000 }); }
  victory() { this.speak('Extraction complete.', 'announcer', { key: 'win', cooldownMs: 60000 }); }
  defeat() { this.speak('Operator down. Mission failed.', 'announcer', { key: 'lose', cooldownMs: 60000 }); }

  enemyCallout(kind: string) {
    const lines: Record<string, string[]> = {
      contact: ['Contact front!', 'Enemy spotted!'],
      flank: ['Flanking!', 'Going wide!'],
      grenade: ['Frag out!', 'Grenade!'],
      mandown: ['Man down!'],
      fallback: ['Fall back!'],
      push: ['Push up!', 'Move in!'],
    };
    const pool = lines[kind] ?? ['Alert!'];
    this.speak(pool[Math.floor(Math.random() * pool.length)], 'enemy', { key: 'enemy-any', cooldownMs: 9000 });
  }
}

export const voice = new VoiceManager();
