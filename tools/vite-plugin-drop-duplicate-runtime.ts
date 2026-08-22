import type { Plugin } from 'vite';

/**
 * Drops the ONNX Runtime `.wasm` binaries that the bundler emits into `dist/assets/`.
 *
 * The runtime's JS glue contains `new URL('....wasm', import.meta.url)`, so the bundler helpfully
 * emits a copy — 23.5 MB of it. Nothing ever loads that copy: `configureRuntime()` sets
 * `wasmPaths` to `/runtime/`, and a request log confirms every fetch goes to the self-hosted files
 * placed there by `tools/sync-runtime.mjs`.
 *
 * Keeping both would waste 23.5 MB of the 1 GB GitHub Pages site budget and leave two copies of
 * the same binary at different versions the moment one of them is updated.
 */
export function dropDuplicateRuntimePlugin(): Plugin {
  return {
    name: 'tabula:drop-duplicate-runtime',
    apply: 'build',
    generateBundle(_options, bundle) {
      let dropped = 0;
      let bytes = 0;
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (!/ort-wasm.*\.wasm$/.test(fileName)) continue;
        if (asset.type === 'asset') {
          const source = asset.source;
          bytes += typeof source === 'string' ? source.length : source.byteLength;
        }
        delete bundle[fileName];
        dropped++;
      }
      if (dropped > 0) {
        console.info(
          `[tabula:runtime] dropped ${dropped} duplicate runtime binar${dropped === 1 ? 'y' : 'ies'} ` +
            `(${(bytes / 1024 / 1024).toFixed(1)} MB) — served from /runtime/ instead`,
        );
      }
    },
  };
}
