// Recoil FPS — weapon finishes. Pure data (no three.js / React).
// Ships with the Factory finish only. The picker, profile storage, and the 3D
// paint path (applySkin in models.ts) are live, so a new finish is just one
// more entry here: id + name + swatch + per-role coats.

/** Union grows here as finishes ship: 'factory' | 'sandstorm' | ... */
export type SkinId = 'factory';

export type SkinRole =
  | 'poly' | 'steel' | 'darkSteel' | 'dark' | 'tan'
  | 'wood' | 'woodDark' | 'fde' | 'chrome' | 'midSteel' | 'od';

export interface SkinCoat {
  color?: number;
  roughness?: number;
  metalness?: number;
}

export interface SkinDef {
  id: SkinId;
  name: string;
  desc: string;
  /** CSS color for the picker swatch. */
  swatch: string;
  /** Per-material-role repaint. Empty = stock factory finish. */
  coats: Partial<Record<SkinRole, SkinCoat>>;
}

export const DEFAULT_SKIN: SkinId = 'factory';

export const SKIN_CATALOG: SkinDef[] = [
  {
    id: 'factory',
    name: 'Factory',
    desc: 'Stock factory finish. More finishes slot in here.',
    swatch: '#565B62',
    coats: {},
  },
];

export function skinById(id: string): SkinDef {
  return SKIN_CATALOG.find(s => s.id === id) ?? SKIN_CATALOG[0];
}

export function isKnownSkin(id: string): boolean {
  return SKIN_CATALOG.some(s => s.id === id);
}
