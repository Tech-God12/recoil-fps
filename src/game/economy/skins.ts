// Recoil FPS — weapon finishes. Pure data (no three.js / React).
// Ships with the Factory finish only. The picker, profile storage, and the 3D
// paint path (applySkin in models.ts) are live, so a new finish is just one
// more entry here: id + name + swatch + per-role coats.

/** Union grows here as finishes ship: 'factory' | 'sandstorm' | ... */
export type SkinId = 'factory' | 'desert' | 'olive' | 'black' | 'urban' | 'coyote';

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
    desc: 'Stock factory finish. Non-nonsense reliability.',
    swatch: '#565B62',
    coats: {},
  },
  {
    id: 'desert',
    name: 'Desert',
    desc: 'Sun-bleached tan. Disappears against sand and rock.',
    swatch: '#C2A878',
    coats: {
      poly: { color: 0xC2A878 }, steel: { color: 0x8A7A5F }, darkSteel: { color: 0x5A5148 },
      dark: { color: 0x3A352E }, tan: { color: 0xC2A878 }, wood: { color: 0x7A5B3A },
      woodDark: { color: 0x5A422A }, fde: { color: 0xC2A878 }, midSteel: { color: 0x7A7264 },
      od: { color: 0xA89878 },
    },
  },
  {
    id: 'olive',
    name: 'Olive',
    desc: 'Olive drab. Standard issue for green zones.',
    swatch: '#5A5E3F',
    coats: {
      poly: { color: 0x5A5E3F }, steel: { color: 0x4E5250 }, darkSteel: { color: 0x33362E },
      dark: { color: 0x23241F }, tan: { color: 0x6E6E4A }, wood: { color: 0x5A4E33 },
      woodDark: { color: 0x423A24 }, fde: { color: 0x6E6E4A }, midSteel: { color: 0x565A52 },
      od: { color: 0x5A5E3F },
    },
  },
  {
    id: 'black',
    name: 'Black',
    desc: 'Blackout. Zero reflection for night work.',
    swatch: '#232629',
    coats: {
      poly: { color: 0x1E2022, roughness: 0.62 }, steel: { color: 0x2A2D30, roughness: 0.5 },
      darkSteel: { color: 0x1A1C1E }, dark: { color: 0x121314 }, tan: { color: 0x24262A },
      wood: { color: 0x2A2018 }, woodDark: { color: 0x1E1812 }, fde: { color: 0x2A2D30 },
      midSteel: { color: 0x232629 }, od: { color: 0x23261F },
    },
  },
  {
    id: 'urban',
    name: 'Urban',
    desc: 'Concrete gray. Built for streets and interiors.',
    swatch: '#7A8085',
    coats: {
      poly: { color: 0x6E7478 }, steel: { color: 0x565B60 }, darkSteel: { color: 0x3A3E42 },
      dark: { color: 0x24272A }, tan: { color: 0x7A8085 }, wood: { color: 0x4A443C },
      woodDark: { color: 0x35312A }, fde: { color: 0x7A8085 }, midSteel: { color: 0x4E5357 },
      od: { color: 0x5A6064 },
    },
  },
  {
    id: 'coyote',
    name: 'Coyote',
    desc: 'Coyote brown. Arid Hills, done right.',
    swatch: '#8A6E4E',
    coats: {
      poly: { color: 0x8A6E4E }, steel: { color: 0x6E5B45 }, darkSteel: { color: 0x4A3E30 },
      dark: { color: 0x302921 }, tan: { color: 0x8A6E4E }, wood: { color: 0x6E4F30 },
      woodDark: { color: 0x4E3822 }, fde: { color: 0x8A6E4E }, midSteel: { color: 0x6B5D4A },
      od: { color: 0x7A6A4A },
    },
  },
];

export function skinById(id: string): SkinDef {
  return SKIN_CATALOG.find(s => s.id === id) ?? SKIN_CATALOG[0];
}

export function isKnownSkin(id: string): boolean {
  return SKIN_CATALOG.some(s => s.id === id);
}
