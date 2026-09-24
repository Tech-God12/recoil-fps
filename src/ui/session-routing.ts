/** An armory visit must not silently turn a ranked/TDM result into a story mission.
 * Returning from a result beats the last-selected map; menu visits use the map. */
export function armoryLaunchMode(
  from: 'menu' | 'results',
  result: { comp?: unknown; tdm?: unknown } | null,
  map: string,
): 'mission' | 'tdm' | 'comp' {
  if (from === 'results' && result?.comp) return 'comp';
  if (from === 'results' && result?.tdm) return 'tdm';
  return map === 'arena' ? 'tdm' : 'mission';
}
