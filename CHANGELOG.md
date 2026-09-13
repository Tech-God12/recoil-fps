# CHANGELOG — UI / Tactical Radar Pass (VOLT Protocol v2)

Player-audit pass focused on two player-facing complaints: **map accuracy & placement** and
**UI legibility / visual noise**. Severity is from a player's perspective, not a linter's.

| Flaw | Severity | Fix | Result |
|---|---|---|---|
| Radar map drawn at 256px from coarse footprints — building/cover blobs, no walkability shading; zoomed out to whole 208m sector with zero zoom context | CRITICAL | Rewrote `generateMapImage()`: 512px canvas, 1.7m-per-cell walkability shading from real solids, per-height-class building colors, sunlit/shadow edges, drop shadows, paved-zone highlights, mottled terrain | Map now reads as a real top-down survey of the sector; geometry is recognizable and matches the world |
| Radar parked dead-center under the crosshair, competing with the reticle, score pops and mission banners | CRITICAL | Moved radar to **bottom-left** (above the vitals frame), clear of all center-stack feedback | Center screen only ever shows crosshair + combat feedback; radar no longer blocks sight |
| Radar showed the whole map (208m across a 168px dish ≈ 1.2m/px) — useless at combat range | ANNOYING | Added `worldHalf` to `HudState` and a per-frame zoom transform: dish now shows a **60m radius window** with the player dead-center, rotating forward-up | Readable at glance: 20/40/60m rings, enemy diamonds, N/S/E/W cardinals all meaningful |
| Vivid saturated palette (pure `#FF5C1A`/`#00E0FF`/`#38FF9B`) + heavy 20–44px glows everywhere → neon sign, low text contrast | CRITICAL | Rebalanced entire design system to muted "tactical terminal" tints (`#F06A2E`, `#58BFE4`, `#3FD68E`, `#E5484D`, `#E8B93C`), cut glow radii/intensities ~50%, replaced neon text-shadows with dark drop-shadows for contrast | Calm, readable, still branded; text pops instead of bleeding |
| Exposure default 125% + vignette 18 washing out mid-range targets in the desert fog | ANNOYING | Defaults: brightness 110, vignette 12; fog pushed to 130–430 and slightly desaturated | Enemy silhouettes stay readable out to ~50m |
| Fullscreen scanline overlay + floating HUD corner brackets + hex glows added visual noise over the 3D world | ANNOYING | Removed HUD scanlines; corners dimmed to 40% opacity with subtle glow | Screen reads cleaner during combat |
| Proximity threat ring (92px) around the crosshair duplicated the radar and crowded the center | CRITICAL | Replaced with a slim threat readout below the crosshair — distance + elevation arrow, only when a hostile is within 30m | Center screen decluttered; proximity info kept |
| Damage arcs spanned 74vmin of the screen at full opacity | ANNOYING | Reduced to 56vmin, opacity × 0.85, softer red | Directional feedback without red-out |
| Onboarding limited to a menu key legend — nothing in-game | ANNOYING | Diegetic HUD strip (WASD/RMB/G/Q·E/SPACE/X) under the compass for the first 12s of every mission, auto-fades | 5-second test: a new player sees how to move, scope, frag, lean, vault, plant |
| Tick/objective/compass text sat at ~45% white with colored glows — hard to read at 720p | ANNOYING | Raised text alphas to 55–82% white, bumped base font sizes (feed 12px, obj brief 12.5px, vitals 10px), dark text-shadows instead of glows | Legible at 720p and over bright desert |
| Mission phase banner used a loud animated hazard-stripe border | POLISH | Single subtle accent border | Banner reads as a clean HUD wipe |
| Settings swatches / results rank tints still used the old vivid palette | POLISH | Synced all inline color literals to the new muted palette | Consistent brand across every screen |

## Verified
- `npm run build` ✓  ·  `npx tsc --noEmit` ✓  ·  `node --test` ✓ (25/25)
- SSR string assertions for menu/objective markup unaffected.
- HUD hot-path styles remain transform/opacity-only (radar zoom is one composited transform).
