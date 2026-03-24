import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [mkcert()],
  resolve: {
    alias: {
      // @iwsdk/core 0.3.1 imports HDRLoader which was renamed to RGBELoader in three r167+
      'three/examples/jsm/loaders/HDRLoader.js': resolve(__dirname, 'src/shims/HDRLoader.js'),
    },
  },
  build: {
    target: 'esnext',  // required for top-level await
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'viewer.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8081,
    https: true,
    proxy: {
      // Forward REST calls to the CV server
      '/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    exclude: ['@iwsdk/core'],
  },
});
