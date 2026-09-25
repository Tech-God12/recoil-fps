# Impact & death reactions (2026-09-24)

Before: every hit played the same nod, every death was the same stiff plank that
could fall through walls, and the rifle stayed glued to the corpse's hands.

## System

`src/game/reactions.ts` — one `BodyReactions` instance per soldier, shared by
mission AI (`ai.ts`), TDM/ranked bots (`tdm.ts`) and defusal (same bots).

- **Hit flinch** — zone-aware (`hitZone(part)`): head snaps back, torso punches
  back/forward and twists away from side hits, limb hits buckle a knee. Additive on
  the live pose; 40 ms attack, exponential decay, gone after 0.45 s. Channels the
  alive pose never resets (torso yaw/roll, head roll) are undone each frame so a
  flinch can never leave a permanent twist.
- **Five deaths** chosen from zone + shot direction + cause: `crumple` (headshot),
  `back` (hit from the front), `forward` (hit from behind), `spin` (side hit),
  `kneel` (leg), `blast` (explosive). Multi-joint keyframes (knees, arms, head),
  blended from whatever pose the soldier was in, one settle bounce.
- **Wall-aware** — `planFall` probes the fall direction against the level AABBs;
  if the body would clip (less than `BODY_LENGTH` + clearance), it rotates to the
  freest direction, or `slump`s against the wall when boxed in.
- **Weapon drop** — the rifle leaves the hands, tumbles under gravity with a 0.3
  bounce and lands with a clatter.
- **Audio** — spatial body-fall thud (heavier for blast) and rifle clatter via
  `audio.bodyFallSpatial` / `weaponClatterSpatial`, culled past 45 m / 30 m.
- **Cost** — after settling, zero per-frame work; `reset()` restores everything on
  respawn/pool reuse.

Hit direction comes from `noteHit({from, zone, explosive})` at every damage site:
bullets (4 engine sites), frags, scorestreaks, and the defusal C4.

## Evidence

- `tests/impact-reactions.test.js` — 11 tests: variant choice per case, settle
  time < 2.5 s, exactly one thud and one clatter, wall slump, no flinch drift,
  spatial audio placement, reset.
- `scripts/reactions-engine-sim.ts` — real Engine, real weapons: kills on Sandblast
  and Warehouse produce back / crumple / spin / kneel / blast, sounds fire, bodies
  settle, respawn resets pose and rifle.

## Not done

No physics ragdoll (no physics dependency allowed). Feel/timing were tuned from
numbers and tests, not by eye — needs a human playtest.
