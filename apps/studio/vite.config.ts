import { defineConfig } from 'vitest/config';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { studioDemoImport } from '../../scripts/demo-import/plugin.mjs';

const API_TARGET = process.env.ULPIN_API_TARGET ?? 'http://127.0.0.1:3188';
// The API checks Origin against its own allow-list: the proxy presents the target's origin, so local development passes.
const API_PROXY = { '/api': { target: API_TARGET, changeOrigin: true, headers: { origin: API_TARGET } } };

export default defineConfig({
  // The Studio needs only the canonical scene adapter, not the zod schemas of the whole contracts package.
  resolve: {
    alias: [{
      find: new RegExp('^@ulpin/contracts$'),
      replacement: resolve(__dirname, '../../packages/contracts/src/canonical/building-scene.ts'),
    }],
  },
  plugins: [
    studioDemoImport(),
    react(),
    {
      // Only the explicitly requested hosted demo retains its local workflow service worker.
      name: 'drop-local-data-worker',
      apply: 'build',
      closeBundle() {
        if (process.env.VITE_HOSTED_DEMO !== '1') rmSync(resolve(__dirname, 'dist/mockServiceWorker.js'), { force: true });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    proxy: API_PROXY,
  },
  preview: { host: '127.0.0.1', port: 5189, proxy: API_PROXY },
  build: { target: 'es2023', sourcemap: true },
  test: { environment: 'node' },
});
