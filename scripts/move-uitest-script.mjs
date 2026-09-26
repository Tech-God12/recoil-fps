/* Build helper: jsdom cannot run <script type="module">, so the UI-test bundle is
 * built as an IIFE and this moves the inlined script from <head> to after #root in
 * <body> (a classic inline script runs at parse time, before #root exists).
 *   npx vite build --config vite.uitest.config.ts && node scripts/move-uitest-script.mjs
 * NOT part of the app. */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'dist-uitest/index.html';
let html = readFileSync(file, 'utf8');
const OPEN = '<script type="module" crossorigin>';
const j = html.indexOf(OPEN);
if (j === -1) { console.log('already a classic inline script — nothing to move'); process.exit(0); }
const start = j + OPEN.length;
const end = html.indexOf('</script>', start);
if (end === -1) throw new Error('no closing </script> for the inlined bundle');
const js = html.slice(start, end);
if (js.includes('</script>')) throw new Error('bundle contains a literal </script> — cannot inline safely');
html = html.slice(0, j) + html.slice(end + '</script>'.length);
const ROOT = '<div id="root"></div>';
if (!html.includes(ROOT)) throw new Error('no #root div to attach to');
// Function replacement: the bundle contains "$&" sequences (React's key escaping)
// that String.replace would otherwise expand into the matched text.
html = html.replace(ROOT, () => `${ROOT}\n  <script>${js}</script>`);
writeFileSync(file, html);
console.log(`moved ${js.length} bytes of bundle after #root in ${file}`);
