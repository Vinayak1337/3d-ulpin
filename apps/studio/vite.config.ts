import { defineConfig } from 'vitest/config';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.ULPIN_API_TARGET ?? 'http://127.0.0.1:3188';

export default defineConfig({
  plugins: [
    react(),
    {
      // The local data layer is development-only: keep its service worker out of production output.
      name: 'drop-local-data-worker',
      apply: 'build',
      closeBundle() {
        rmSync(resolve(__dirname, 'dist/mockServiceWorker.js'), { force: true });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    // The Nest API validates Host and Origin: start it with API_ALLOWED_ORIGINS=http://127.0.0.1:5188.
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  preview: { host: '127.0.0.1', port: 5189, proxy: { '/api': { target: API_TARGET, changeOrigin: true } } },
  build: { target: 'es2023', sourcemap: true },
  test: { environment: 'node' },
});
