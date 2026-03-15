import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run unit tests in Node environment (no DOM needed for pure logic)
    // SpatialPinManager uses EventTarget which is available in Node 18+
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/main.js', 'src/shims/**'],
      // Rendering and UI modules require the full IWSDK World (not unit-testable in Node);
      // they are covered by Playwright E2E tests instead.
      thresholds: {
        lines:      45,
        functions:  50,
        branches:   50,
        statements: 45,
      },
    },
    // Resolve aliases that vite.config.js defines
    alias: {
      'three/examples/jsm/loaders/HDRLoader.js': new URL(
        './src/shims/HDRLoader.js',
        import.meta.url,
      ).pathname,
    },
  },
});
