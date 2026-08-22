import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

/**
 * Builds `src/sw/sw.ts` into `dist/sw.js` as a separate, unhashed bundle and injects the list of
 * emitted assets so the service worker can precache the shell for offline use.
 *
 * Why a custom plugin instead of vite-plugin-pwa/Workbox:
 *  - This project needs ONE service worker that does two jobs (cross-origin isolation + caching);
 *    registering a second SW at the same scope would evict the first. See src/sw/sw.ts.
 *  - Model weights are large, cross-origin and consent-gated, so caching policy has to be ours.
 *  - Fewer dependencies (principle P8), and the SW is a portfolio talking point in its own right.
 *
 * The nested build uses `configFile: false` and declares no plugins, so this plugin is not
 * re-applied and there is no recursion.
 */
export function serviceWorkerPlugin(options: { base: string }): Plugin {
  let emitted: string[] = [];

  return {
    name: 'tabula:service-worker',
    apply: 'build',

    generateBundle(_options, bundle) {
      emitted = Object.keys(bundle)
        .filter((name) => /\.(js|css|html)$/.test(name))
        .map((name) => options.base + name);
    },

    async closeBundle() {
      // Files copied verbatim from public/ are not part of the rollup bundle, so list them here.
      const staticAssets = [
        options.base,
        `${options.base}manifest.webmanifest`,
        `${options.base}icon.svg`,
      ];
      const precache = [...new Set([...staticAssets, ...emitted])].sort();
      const buildId = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);

      await build({
        configFile: false,
        logLevel: 'warn',
        base: options.base,
        define: {
          __PRECACHE__: JSON.stringify(precache),
          __BUILD_ID__: JSON.stringify(buildId),
        },
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          sourcemap: false,
          target: 'es2022',
          lib: {
            // fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..." with
            // percent-encoded spaces, which the bundler cannot resolve.
            entry: fileURLToPath(new URL('../src/sw/sw.ts', import.meta.url)),
            formats: ['iife'],
            name: 'TabulaServiceWorker',
            fileName: () => 'sw.js',
          },
          rollupOptions: { output: { entryFileNames: 'sw.js', extend: true } },
        },
      });

      console.info(
        `[tabula:sw] dist/sw.js built — ${precache.length} precached files (${buildId})`,
      );
    },
  };
}
