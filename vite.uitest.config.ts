import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: { 'import.meta.env.DEV': 'false' },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: 'dist-uitest',
    target: 'es2020',
    minify: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js' } },
  },
});
