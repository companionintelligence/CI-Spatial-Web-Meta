/**
 * Vite config for testing — plain HTTP, no mkcert, port 4174.
 * Used by Playwright E2E tests via: npx vite --config vite.test.config.js
 */
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'three/examples/jsm/loaders/HDRLoader.js': resolve(__dirname, 'src/shims/HDRLoader.js'),
    },
  },
  build: {
    target: 'esnext',
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    https: false,
    // Proxy CV server calls so the app doesn't crash on missing /v1/ endpoints
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' },
    exclude: ['@iwsdk/core'],
  },
});
