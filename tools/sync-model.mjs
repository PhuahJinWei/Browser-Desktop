/**
 * Fetches the bundled model into `public/models/` so it is served from this origin.
 *
 * ADR 3 always described Tier 0 as "in-repo, same origin". It was not, until now: the weights were
 * fetched from `huggingface.co` on first use, which meant a second host, a 23 MB wait before the
 * first search worked, and nothing at all on a first visit without a network. Committing them
 * makes the deployed site self-contained and `git clone` enough to run offline.
 *
 *   node tools/sync-model.mjs [--force]
 *
 * Files already present and matching their digest are left alone, so this is cheap to run on every
 * build. Every download is checked against the SHA-256 pinned in `models.json` — the same digests
 * the runtime used to verify against, now enforced at build time instead.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..." with percent-encoded
// spaces, which fs cannot open.
const root = fileURLToPath(new URL('..', import.meta.url));
const registry = JSON.parse(await readFile(join(root, 'models.json'), 'utf8'));
const force = process.argv.includes('--force');

/** Only the bundled tier is vendored; nothing else is fetched at runtime any more either. */
const bundled = registry.models.filter((model) => model.tier === 'bundled');

async function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function isCurrent(path, expected) {
  try {
    const info = await stat(path);
    if (info.size !== expected.bytes) return false;
    return (await sha256(await readFile(path))) === expected.sha256;
  } catch {
    return false;
  }
}

let fetched = 0;
let skipped = 0;
let bytes = 0;

for (const model of bundled) {
  const base = join(root, 'public', 'models', ...model.source.repo.split('/'));
  process.stdout.write(`${model.source.repo}\n`);

  for (const file of model.files) {
    const target = join(base, ...file.path.split('/'));

    if (!force && (await isCurrent(target, file))) {
      skipped++;
      bytes += file.bytes;
      continue;
    }

    const url = `https://${model.source.host}/${model.source.repo}/resolve/${model.source.revision}/${file.path}`;
    process.stdout.write(`  ${file.path} … `);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    const body = Buffer.from(await response.arrayBuffer());

    const digest = await sha256(body);
    if (digest !== file.sha256) {
      // A mismatch means the pinned revision moved under us. Failing loudly is the point: the
      // whole reason the digests are in the registry is so nobody ships weights they did not check.
      throw new Error(
        `digest mismatch for ${file.path}\n  expected ${file.sha256}\n  received ${digest}\n` +
          `The pinned revision may have moved. Re-run tools/fetch-model-registry.mjs and review.`,
      );
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    fetched++;
    bytes += body.byteLength;
    process.stdout.write(`${(body.byteLength / 1048576).toFixed(1)} MB\n`);
  }
}

const mb = (bytes / 1048576).toFixed(1);
console.log(
  `\n${mb} MB in public/models — ${fetched} fetched, ${skipped} already present and verified.`,
);
