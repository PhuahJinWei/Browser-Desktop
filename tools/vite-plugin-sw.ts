import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

/**
 * Builds `src/sw/sw.ts` into `dist/sw.js` as a separate, unhashed bundle and injects the list of
 * emitted assets so the service worker can precache the shell for offline use.
 *
 * Why a custom plugin instead of vite-plugin-pwa/Workbox:
 *  - This project needs ONE service worker that does two jobs (cross-origin isolation + caching);
 *    registering a second SW at the same scope would evict the first. See src/sw/sw.ts.
 *  - The inference stack is too big to precache (35 MB of ONNX runtime, 23 MB of weights) and too
 *    important to leave uncached, so its policy has to be ours: fetched on first use, then kept in
 *    caches keyed by what they contain rather than by the app version, so redeploying the desktop
 *    does not cost anyone a re-download.
 *  - Fewer dependencies (principle P8), and the SW is a portfolio talking point in its own right.
 *
 * The nested build uses `configFile: false` and declares no plugins, so this plugin is not
 * re-applied and there is no recursion.
 */
/** Reads a JSON file from the project root, or null when it has not been generated yet. */
function readJson(relative: string): Record<string, unknown> | null {
  try {
    const file = fileURLToPath(new URL('../' + relative, import.meta.url));
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Reads a built file back off disk, so its *content* can be folded into the build id.
 *
 * Only `index.html` needs this. Every JS and CSS asset is content-hashed, so a change to app code
 * moves a filename and the id follows. `index.html` is not hashed: a change confined to it — the
 * CSP meta tag, say — left the id identical, so the service worker saw no update and kept serving
 * the previous copy. Found by tightening the CSP and watching the old policy come back. Read here
 * rather than in `generateBundle` because the CSP is injected by a later hook, and Vite does not
 * put the html in this plugin’s bundle object at all.
 */
function readEmitted(names: string[]): string {
  return names
    .map((name) => {
      try {
        return readFileSync(fileURLToPath(new URL('../dist/' + name, import.meta.url)), 'utf8');
      } catch {
        return '';
      }
    })
    .join(' ');
}

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
      const buildId = createHash('sha256')
        .update(precache.join('\n'))
        .update(readEmitted(['index.html']))
        .digest('hex')
        .slice(0, 12);

      // The runtime and the weights get cache names of their own, keyed by their own versions:
      // upgrading onnxruntime or repinning the model should invalidate them, and shipping a CSS
      // tweak should not.
      const runtimeId = (readJson('public/runtime/RUNTIME.json')?.version as string) ?? 'unknown';
      const digests = (
        (readJson('models.json')?.models ?? []) as { files?: { sha256: string }[] }[]
      )
        .flatMap((model) => model.files ?? [])
        .map((file) => file.sha256)
        .join(String.fromCharCode(10));
      const weightsId = createHash('sha256').update(digests).digest('hex').slice(0, 12);

      await build({
        configFile: false,
        logLevel: 'warn',
        base: options.base,
        define: {
          __PRECACHE__: JSON.stringify(precache),
          __BUILD_ID__: JSON.stringify(buildId),
          __RUNTIME_ID__: JSON.stringify(runtimeId),
          __WEIGHTS_ID__: JSON.stringify(weightsId),
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
