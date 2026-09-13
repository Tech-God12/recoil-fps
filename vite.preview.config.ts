// Dev-only config so the sandbox/preview proxy host is accepted.
// The game itself runs on vite.config.ts; this just extends it for live preview.
import { defineConfig } from 'vite';
import base from './vite.config';

export default defineConfig({
  ...(typeof base === 'function' ? {} : base),
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
});
