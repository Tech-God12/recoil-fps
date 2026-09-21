// ESM loader hook: stub image/audio asset imports for headless Node smoke tests.
export async function load(url, context, nextLoad) {
  if (/\.(webp|png|jpe?g|gif|mp3|ogg|wav|svg)$/i.test(url.split('?')[0])) {
    return { format: 'module', source: 'export default "stub-asset";', shortCircuit: true };
  }
  return nextLoad(url, context);
}
