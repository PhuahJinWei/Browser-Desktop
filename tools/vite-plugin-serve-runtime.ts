import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Serves the vendored ONNX runtime during development.
 *
 * The runtime lives in `public/runtime/` because the build has to copy those binaries out
 * untouched, and `configureRuntime()` points the ML runtime's `wasmPaths` at that URL. The runtime
 * then loads its WebAssembly glue with a dynamic `import()`, and that combination is one Vite's dev
 * server refuses: a file inside `publicDir` reaching the module pipeline is almost always a
 * mistake, so it answers with "should not be imported from source code" rather than the file.
 *
 * The symptom is not a missing asset — it is inference failing to start at all, several layers
 * away, as `no available backend found. ERR: [wasm] Failed to fetch dynamically imported module`.
 *
 * Production never had the problem: there is no dev server, and the file is fetched as an ordinary
 * static asset. Hence `apply: 'serve'` — this exists to make development match what is deployed,
 * and it must not be able to change what is deployed.
 */

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
};

export function serveRuntimePlugin(): Plugin {
  return {
    name: 'tabula:serve-runtime',
    apply: 'serve',

    configureServer(server) {
      const runtimeDir = resolve(server.config.publicDir, 'runtime');
      const prefix = `${server.config.base}runtime/`;
      const configured = server.config.server.headers ?? {};

      /*
       * Installed directly rather than from a returned callback, which is what puts it ahead of
       * Vite's own middlewares — including the transform middleware that rejects the request.
       */
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0];
        if (!url || !url.startsWith(prefix)) return next();

        const file = join(runtimeDir, normalize(decodeURIComponent(url.slice(prefix.length))));
        // Contain path traversal: everything must resolve inside the runtime directory.
        if (!file.startsWith(runtimeDir + sep)) return next();

        let size: number;
        try {
          const info = statSync(file);
          if (!info.isFile()) return next();
          size = info.size;
        } catch {
          // Not ours after all — let Vite answer, so a genuine 404 still looks like one.
          return next();
        }

        // The dev server's isolation headers are set for the whole origin; bypassing Vite's
        // middleware must not quietly bypass those too.
        for (const [name, value] of Object.entries(configured)) {
          if (value !== undefined) response.setHeader(name, value);
        }
        response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        response.setHeader('Content-Length', size);
        // The sync script rewrites these in place; a cached copy would outlive its version.
        response.setHeader('Cache-Control', 'no-cache');

        createReadStream(file).pipe(response);
        return undefined;
      });
    },
  };
}
