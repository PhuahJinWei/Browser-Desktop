/**
 * A deliberately dumb static file server that imitates GitHub Pages.
 *
 * `vite preview` sends COOP/COEP headers, which would hide the very thing that needs testing:
 * on GitHub Pages nothing sets those headers, so cross-origin isolation has to be earned by the
 * service worker alone. This server sends no such headers and serves from a subpath, the way a
 * project site at https://<user>.github.io/<repo>/ does.
 *
 *   node tools/serve-static.mjs [--port 4180] [--base /tabula/] [--dir dist]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const port = Number(flag('port', '4180'));
const base = flag('base', '/tabula/');
const dir = flag('dir', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

const logRequests = args.includes('--log'); // REQUEST_LOG
const server = createServer(async (request, response) => {
  if (logRequests) console.log(`  ${request.method} ${request.url}`);
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);

  if (!url.pathname.startsWith(base)) {
    // Only the site root redirects. Anything else outside the base is a genuine miss and must
    // 404: silently redirecting an asset to index.html turns a wrong base path into a confusing
    // "expected a module but got text/html" error instead of an obvious 404.
    if (url.pathname === '/') {
      response.writeHead(302, { Location: base });
      response.end();
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`404 ${url.pathname} is outside the base path ${base}.
Was the build made with VITE_BASE=${base}? Try: npm run build:pages`);
    return;
  }

  let relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
  if (relative.endsWith('/')) relative += 'index.html';

  // Contain path traversal: everything must resolve inside `dir`.
  const path = join(dir, normalize(relative).replace(/^(\.\.[/\\])+/, ''));

  try {
    const info = await stat(path);
    if (info.isDirectory()) throw new Error('directory');
    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      // No COOP/COEP and no CORP, exactly like GitHub Pages. Isolation must come from the SW.
      'Cache-Control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`404 ${relative}`);
  }
});

server.listen(port, () => {
  console.log(`Serving ${dir}/ at http://localhost:${port}${base}`);
  console.log('No COOP/COEP headers are sent — this imitates GitHub Pages on purpose.');
});
