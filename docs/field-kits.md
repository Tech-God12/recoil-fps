# Field Kits

One tactical ability per deployment, on a cooldown, bound to **Z**. It works in Missions and Warehouse TDM.

## Getting a kit

- New players own **no kit** and deploy without one.
- Open **KITS** from the home menu (tile 03), or use the **Field kit** button on the mission deploy panel or the TDM loadout screen.
- Each kit is a one-time purchase paid from match cash: Recon **$4,500**, Phantom **$6,000**, Bulwark **$7,500**. The first kit you buy is equipped automatically. You can equip any kit you own, or unequip to deploy with none.
- The equipped kit is **locked in when the game starts**. To change it you have to end the game. The pause menu only shows it for reference.
- Saved as `ownedKits` / `equippedKit` on the player profile (sanitized in `readKits`). The old free `fieldKit` setting is gone.

## The kits

| Kit | Ability | Cooldown | What it does | The catch |
| --- | --- | --- | --- | --- |
| **RECON** | Sonar Dart | 45 s | Throws a dart that sticks where it lands and fires 3 pings, 2.5 s apart. Each ping tags every hostile within **24 m** for 3.2 s, drawn as a **full-body silhouette through walls** (it drops to crouch height when they crouch) plus a marker and a radar contact. **Tagged hostiles take +10 % damage** from you. | Each ping can be heard within **14 m**, and hostiles in that range come looking for the dart. |
| **BULWARK** | Barricade | 60 s | Slams down a folding steel shield 1.7 m ahead of you: 2.4 m wide, **1.4 m** tall, **450 HP**, lasts 24 s. It blocks bullets, sight-lines, movement and AI pathing. Press **Z within 3.5 m of it to recall it**, which works even while the kit is recharging and banks `30 s × remaining integrity` of cooldown. | Crouch to be covered; standing exposes you. Hostile fire and frags break it. If the spot is blocked, placement is refused and you keep the charge. |
| **PHANTOM** | Holo-Decoy | 50 s | A hologram jogs 9 m along your aim, then **strafes** and fires blanks for 10 s. Hostiles inside **32 m** that can see it shoot it instead of you. When it dies (shot or timed out) it **bursts and stuns every hostile within 6 m for 1.6 s**. | 120 HP. Shooting a lured hostile has a 50 % chance to break the lure. |

**Charge rules (retuned after the "refills after 1–2 kills" feedback):**
- Kits start each game **50 % charged**, so there is no ability at the spawn.
- Each kill takes **8 %** of the full cooldown off (was 20 %), and kills can refund **at most 30 % per charge**. For example, two kills on Recon take off 7.2 s, and no killing spree can take off more than 13.5 s.
- Cooldowns went up about 50 %: 30/40/35 s became 45/60/50 s.

## UI & effects

- **KITS screen** (`KitsMenu.tsx`): three kit cards showing price, OWNED or EQUIPPED; a live 3D turntable that loops each ability's animation (`KitViewer.tsx`, built from the real in-game models); animated stat bars; how-to steps; a buy/equip button with a shine and a toast. Keyboard: ←/→ or 1–3 to select, Enter to buy or equip, Esc to go back.
- **HUD slot:** a 24-tick segmented dial with a glowing arc, a burst ring when the kit becomes ready, a flash when it is used, a RECALL state for Bulwark, a charge bar, and a `N TAGGED · +10%` badge.
- **Screen effects** (`KitFx`): a sonar sweep ring on each ping, a dust flash when the barricade slams down, a red vignette when it breaks, and glitch bars when the decoy bursts. Camera shake scales with distance.
- **World effects:** the dart has an echo ring, a wire dome and a beacon beam. The barricade unfolds on its hinges, kicks up slam dust, throws sparks where it is hit, scorches as it takes damage and shudders when critical. The decoy has a projector cone, a scan ring and a scanline crawl, glitches its torso, and ends in a holo burst.
- **Pause menu** (redesigned): blurred backdrop, large PAUSED title, icon actions with keyboard navigation (↑↓, 1–4). Restart and Quit need a second press to confirm. It shows a TDM scoreboard (score, time, your K/D) or the mission objective, a read-only kit card with a charge bar, and a scorestreak grid.

## Code map

- `src/game/economy/kit-shop.ts`: ids, prices, `buyKit`, `equipKit`, `readKits`.
- `src/game/kits.ts`: tuning table, `KitCharge` (capped refunds, `bank`), pure helpers (`barricadePlacement`, `sonarTagged`, `burstVictims`, `recallRefundSeconds`, `chooseLure`) and `KitDirector`.
- `src/game/kit-models.ts`: meshes. `src/game/effects.ts`: `sparks`, `slamDust`, `sonarPulse`, `holoBurst`, `kitFlash`.
- `src/game/engine.ts`: builds the director only when a kit is equipped. Handles the damage multiplier on player hits, stun/crouch hooks for hostiles, and the `kitfx` event plus camera shake.
- `src/ui/Kits.tsx`, `KitsMenu.tsx`, `KitViewer.tsx`, `Screens.tsx` (`PauseMenu`); CSS in the FIELD KITS / KITS / PAUSE sections of `index.css`.
- `tests/field-kits.test.js`: 19 tests.

## Limitations

- Bots don't use kits.
- Barricades snap to an axis.
- Pressing Z next to your own wall always recalls it; walk away from it to plant a new one.
- No browser or human playtest was done. The numbers come from reasoning and headless simulation.
