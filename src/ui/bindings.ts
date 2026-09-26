// Recoil FPS — key-bind reference + menu cursor math.
// Pure data/functions (no JSX) so Node tests pin them; Settings.tsx renders this.
export const BINDS: [string, string][] = [
  ['Move', 'WASD'], ['Sprint', 'Shift'], ['Crouch', 'C'], ['Slide', 'Sprint + C'],
  ['Jump / Vault', 'Space'], ['Fire', 'Mouse Left'], ['Aim', 'Mouse Right'], ['Reload', 'R'],
  ['Lean left', 'Q — hold'], ['Lean right', 'E — hold'], ['Frag grenade', 'Hold G'], ['Flashbang', 'F'],
  ['Primary / Sidearm', '1 / 2'], ['Last weapon', 'Tap Q'], ['Plant / Detonate', 'X'],
  ['Underbarrel shotgun', 'B'], ['Scope zoom', 'V · [ ]'], ['Canted sight', 'T — hold'],
  ['Field ability', 'Z'], ['Scoreboard', 'Tab — hold'], ['Pause', 'Esc'],
];

/** Menu cursor step with wraparound. Count comes from the item list itself so the
 *  keyboard can never strand an entry (the old hardcoded %4 hid item 5 of 5). */
export function menuStep(sel: number, dir: 1 | -1, count: number): number {
  return (((sel + dir) % count) + count) % count;
}
