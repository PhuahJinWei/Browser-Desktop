import { fileURLToPath, URL } from 'node:url';
// `vitest/config` extends Vite's own defineConfig with the `test` block below.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { serviceWorkerPlugin } from './tools/vite-plugin-sw.ts';
import { cspPlugin } from './tools/vite-plugin-csp.ts';
import { dropDuplicateRuntimePlugin } from './tools/vite-plugin-drop-duplicate-runtime.ts';
import { serveRuntimePlugin } from './tools/vite-plugin-serve-runtime.ts';

/**
 * Base path.
 *
 * GitHub Pages serves project sites from `https://<user>.github.io/<repo>/`, so every asset URL
 * needs that prefix. The deploy workflow sets VITE_BASE from the repository name automatically,
 * so nothing here has to be edited when the repo is renamed. Local dev stays at '/'.
 */
const base = process.env.VITE_BASE ?? '/';

/**
 * Fail loudly on a malformed base. A wrong value does not break the build, it produces a site
 * whose every asset URL is subtly wrong — and Git Bash on Windows rewrites `/tabula/` into a
 * Windows path unless MSYS_NO_PATHCONV=1 is set, which is exactly how that happens by accident.
 */
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error(
    `VITE_BASE must start and end with "/" (got ${JSON.stringify(base)}). ` +
      'On Git Bash prefix the command with MSYS_NO_PATHCONV=1.',
  );
}

export default defineConfig({
  base,
  plugins: [
    react(),
    cspPlugin(),
    serveRuntimePlugin(),
    dropDuplicateRuntimePlugin(),
    serviceWorkerPlugin({ base }),
  ],
  resolve: {
    alias: {
      '@kernel': fileURLToPath(new URL('./src/kernel', import.meta.url)),
      '@shell': fileURLToPath(new URL('./src/shell', import.meta.url)),
      '@services': fileURLToPath(new URL('./src/services', import.meta.url)),
      '@apps': fileURLToPath(new URL('./src/apps', import.meta.url)),
      '@sdk': fileURLToPath(new URL('./src/sdk', import.meta.url)),
    },
  },
  worker: {
    // Workers use ES modules so they can import the ML runtime with normal `import` syntax.
    format: 'es',
  },
  build: {
    // Baseline for the browsers in the support matrix (WebGPU-era Chrome/Edge/Firefox/Safari).
    target: ['chrome113', 'edge113', 'firefox141', 'safari26'],
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep the ML runtime out of the shell bundle so the desktop boots without paying for it.
        manualChunks(id) {
          if (id.includes('@huggingface') || id.includes('onnxruntime')) return 'ml-runtime';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    headers: {
      // Dev-only: GitHub Pages cannot set headers, so production gets the same isolation via
      // public/coi-serviceworker.js. Setting them here means dev matches prod behaviour.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  test: {
    // Node by default, because almost everything worth testing here is a pure function and a DOM
    // would only slow it down. The handful of component tests opt in per file with a
    // `@vitest-environment happy-dom` docblock, so one slow environment does not tax the rest.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
