/**
 * Regenerates models.json from the Hugging Face API.
 *
 * The registry has to carry exact byte sizes (the Tier-0 bundle is a hard budget) and a SHA-256
 * per file (every downloaded weight is integrity-checked before use). Both are published by the
 * API, so they are fetched rather than transcribed — rerun this when a model is added or pinned
 * to a new revision.
 *
 * There is one model left. The on-demand tier — CLIP for photo search, Whisper for transcription,
 * TrOCR for reading pages — was removed in full: see ADR 15. What remains is the embedding model
 * that document search runs on.
 *
 *   node tools/fetch-model-registry.mjs
 *
 * Note: `lfs.oid` is the SHA-256 of the file contents. Small non-LFS files have no oid; they are
 * fetched and hashed locally instead.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

/** Tier-0 budget: the total bytes we are willing to serve from GitHub Pages on a first visit. */
const TIER0_BUDGET_BYTES = 80 * 1024 * 1024;

/** @type {Array<{id:string,task:string,label:string,repo:string,revision:string,tier:string,minTier:string,license:string,licenseUrl:string,dtype:string,files:string[],meta?:object,notes:string,milestone:string}>} */
const SPEC = [
  {
    id: 'text-embed-minilm-l6-v2',
    task: 'text-embedding',
    label: 'all-MiniLM-L6-v2 (384-d, int8)',
    repo: 'Xenova/all-MiniLM-L6-v2',
    revision: 'main',
    tier: 'bundled',
    minTier: 'C',
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2',
    dtype: 'q8',
    files: [
      'onnx/model_quantized.onnx',
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
    ],
    meta: { dimensions: 384, maxTokens: 256, language: 'en' },
    notes:
      'Default text embedding model. Small enough to ship in the repo, so search works offline on first visit.',
    milestone: 'M1',
  },
];

const api = (repo, path) =>
  `https://huggingface.co/api/models/${repo}/tree/${'main'}/${path}?expand=true`;

async function listDir(repo, dir) {
  const response = await fetch(api(repo, dir));
  if (!response.ok) throw new Error(`HF API ${response.status} for ${repo}/${dir}`);
  return response.json();
}

async function hashRemote(repo, revision, path) {
  const url = `https://huggingface.co/${repo}/resolve/${revision}/${path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${response.status} for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length };
}

async function resolveFiles(entry) {
  const dirs = new Set(
    entry.files.map((f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')),
  );
  const listings = new Map();
  for (const dir of dirs) listings.set(dir, await listDir(entry.repo, dir));

  const files = [];
  for (const path of entry.files) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const found = (listings.get(dir) ?? []).find((f) => f.path === path);
    if (!found) throw new Error(`${entry.repo}: ${path} not found`);

    if (found.lfs?.oid) {
      files.push({ path, bytes: found.lfs.size ?? found.size, sha256: found.lfs.oid });
    } else {
      // Small config/tokenizer files are stored inline, so hash them ourselves.
      const { sha256, size } = await hashRemote(entry.repo, entry.revision, path);
      files.push({ path, bytes: size, sha256 });
    }
  }
  return files;
}

const models = [];
for (const entry of SPEC) {
  process.stdout.write(`resolving ${entry.repo} … `);
  const files = await resolveFiles(entry);
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  console.log(`${(totalBytes / 1024 / 1024).toFixed(1)} MB across ${files.length} files`);
  models.push({
    id: entry.id,
    task: entry.task,
    label: entry.label,
    tier: entry.tier,
    minHardwareTier: entry.minTier,
    milestone: entry.milestone,
    source: { host: 'huggingface.co', repo: entry.repo, revision: entry.revision },
    dtype: entry.dtype,
    license: { name: entry.license, url: entry.licenseUrl },
    totalBytes,
    files,
    ...(entry.meta ? { meta: entry.meta } : {}),
    notes: entry.notes,
  });
}

const bundled = models.filter((m) => m.tier === 'bundled');
const bundledBytes = bundled.reduce((sum, m) => sum + m.totalBytes, 0);

const registry = {
  schemaVersion: 1,
  tier0BudgetBytes: TIER0_BUDGET_BYTES,
  bundledBytes,
  bundledWithinBudget: bundledBytes <= TIER0_BUDGET_BYTES,
  note:
    'Sizes and SHA-256 digests come from the Hugging Face API; regenerate with ' +
    '`node tools/fetch-model-registry.mjs`. Every downloaded file is verified against its digest ' +
    'before use. Bundled models are copied into public/models at build time.',
  models,
};

await writeFile('models.json', JSON.stringify(registry, null, 2) + '\n');

console.log('\nTier-0 bundle:');
for (const model of bundled) {
  console.log(
    `  ${(model.totalBytes / 1024 / 1024).toFixed(1).padStart(6)} MB  ${model.id} (${model.milestone})`,
  );
}
console.log(
  `  ${'-'.repeat(6)}\n  ${(bundledBytes / 1024 / 1024).toFixed(1).padStart(6)} MB total vs ` +
    `${(TIER0_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB budget → ${
      bundledBytes <= TIER0_BUDGET_BYTES ? 'WITHIN BUDGET' : 'OVER BUDGET'
    }`,
);
console.log(
  `\nFirst-visit bandwidth: ~${Math.floor((100 * 1024 ** 3) / bundledBytes).toLocaleString()} ` +
    'first-time visitors/month within the 100 GB GitHub Pages soft limit (models only).',
);
