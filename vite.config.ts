import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: { host: true, proxy: { '/api': 'http://localhost:3000' } },
  test: { root: '.', include: ['shared/**/*.test.ts', 'server/**/*.test.ts'] },
});
