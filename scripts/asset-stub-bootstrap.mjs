// Registers the asset-stub loader hooks for headless Node runs (smoke tests).
// Usage: npx tsx --import ./scripts/asset-stub-bootstrap.mjs scripts/tdm-smoke.ts
import { register } from 'node:module';
register('./asset-loader.mjs', import.meta.url);
