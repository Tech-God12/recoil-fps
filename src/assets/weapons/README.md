# Weapon surface assets

These material sources were AI-generated specifically for this project, then
contrast-limited, edge-blended for repeat wrapping, and encoded as WebP. They are
surface tiles, not photographs of complete weapons or camera-facing gun images.
No third-party model pack is required.

| Asset | Use | Colour space |
| --- | --- | --- |
| `steel-color.webp` | Restrained fine scratches / coating variation | sRGB |
| `steel-roughness.webp` | Metal/paint roughness and fine steel relief | Linear data |
| `walnut-color.webp` | Irregular, lengthwise reddish walnut fibres | sRGB |
| `walnut-roughness.webp` | Wood roughness and subtle grain relief | Linear data |

All four tiles are **1024 × 1024**, totalling **806,142 bytes**. They are imported
by `src/game/weapons/finish.ts`, shared across weapons and material clones, and
embedded by the existing single-file production build. Polymer stipple and cut
diamond checkering are deterministic 512² data textures generated in that module. `distress.ts` generates a separate shared 1K scratch
and handling-abrasion atlas; there are no additional image downloads.

UVs use physical-scale projection rather than stretching a tile over each face.
Batched geometry carries separate bevel-wear / part-variation attributes. Material
clones retain their shader hooks; disposing a gun must not dispose these shared
textures. Await `weaponTexturesReady` before making a cached thumbnail.
