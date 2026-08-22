/**
 * Copies the ONNX Runtime WebAssembly artifacts from node_modules into public/runtime/.
 *
 * The runtime must be served from our own origin: the CSP allows `script-src 'self'` only, the
 * app has to work offline, and "this page talks to exactly two hosts" is a claim the project
 * makes in its README. Fetching the runtime from a CDN would break all three.
 *
 * public/runtime/ is generated, not committed — it is regenerated here on `predev`/`prebuild`
 * and in CI, so the repository stays small and the bytes always match the installed version.
 *
 *   node tools/sync-runtime.mjs
 */
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * onnxruntime-web does not export ./package.json, so resolve the package entry point and walk up
 * to its dist directory instead of asking for the manifest by subpath.
 */
const ortDist = dirname(require.resolve('onnxruntime-web'));
const ortManifest = JSON.parse(
  await readFile(join(ortDist, '..', 'package.json'), 'utf8').catch(() => '{"version":"unknown"}'),
);
const outDir = 'public/runtime';

/**
 * Only the files transformers.js v4 actually references on the web path. The `.jsep.*` build is
 * deliberately excluded: v4 uses the native C++ WebGPU execution provider inside the standard
 * binary, so the 26 MB JSEP variant is dead weight.
 */
const FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

let raw = 0;
let compressed = 0;
const report = [];

for (const file of FILES) {
  const bytes = await readFile(join(ortDist, file));
  await writeFile(join(outDir, file), bytes);
  const gz = gzipSync(bytes, { level: 9 }).length;
  raw += bytes.length;
  compressed += gz;
  report.push({ file, bytes: bytes.length, gz });
}

const mb = (n) => (n / 1024 / 1024).toFixed(1).padStart(6);
console.log(`ONNX Runtime synced to ${outDir}/`);
for (const r of report) {
  console.log(`  ${mb(r.bytes)} MB raw  ${mb(r.gz)} MB gzip   ${r.file}`);
}
console.log(`  ${'-'.repeat(30)}`);
console.log(`  ${mb(raw)} MB raw  ${mb(compressed)} MB gzip   total on disk`);
console.log(
  '\nMeasured with a request log: transformers.js v4 fetches the ASYNCIFY build ' +
    '(ort-wasm-simd-threaded.asyncify.wasm, ~5.4 MB gzipped) on both the WASM and WebGPU paths. ' +
    'The non-asyncify pair is kept as a fallback; do not assume the smaller number.',
);

await writeFile(
  join(outDir, 'RUNTIME.json'),
  JSON.stringify(
    {
      source: 'onnxruntime-web',
      version: ortManifest.version,
      generatedBy: 'tools/sync-runtime.mjs',
      files: report,
    },
    null,
    2,
  ) + '\n',
);
