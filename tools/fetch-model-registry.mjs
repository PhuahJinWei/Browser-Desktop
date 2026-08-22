/**
 * Regenerates models.json from the Hugging Face API.
 *
 * The registry has to carry exact byte sizes (the Tier-0 bundle is a hard budget) and a SHA-256
 * per file (every downloaded weight is integrity-checked before use). Both are published by the
 * API, so they are fetched rather than transcribed — rerun this when a model is added or pinned
 * to a new revision.
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
  {
    id: 'asr-whisper-tiny',
    task: 'speech-recognition',
    label: 'Whisper tiny (multilingual, int8)',
    repo: 'onnx-community/whisper-tiny',
    revision: 'main',
    // The plan had this bundled at M2. Consent-gated download turned out to be better: nobody
    // who never opens the Audio app should pay 69 MB for it, and the fp16 decoder made bundling
    // it a budget problem anyway.
    tier: 'on-demand',
    minTier: 'C',
    license: 'MIT',
    licenseUrl: 'https://huggingface.co/openai/whisper-tiny',
    dtype: 'q8 encoder / fp16 decoder',
    files: [
      'onnx/encoder_model_quantized.onnx',
      // Not the quantised decoder: it fails to build a session on current ONNX Runtime with
      // "Missing required scale ... MatMulNBits". fp16 is the smallest export that loads.
      'onnx/decoder_model_merged_fp16.onnx',
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    meta: { languages: 'multilingual', chunkSeconds: 30 },
    notes:
      'Bundled from M2 onward so the audio demo needs no download. Larger variants are on-demand.',
    milestone: 'M2',
  },
  {
    id: 'image-text-mobileclip-s0',
    task: 'image-text-embedding',
    label: 'MobileCLIP-S0 (int8)',
    repo: 'Xenova/mobileclip_s0',
    revision: 'main',
    tier: 'on-demand',
    minTier: 'B',
    license: 'Apple ASCL',
    licenseUrl: 'https://huggingface.co/apple/MobileCLIP-S0',
    dtype: 'q8',
    files: [
      'onnx/text_model_quantized.onnx',
      'onnx/vision_model_quantized.onnx',
      'config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
    ],
    meta: { dimensions: 512, imageSize: 256 },
    notes:
      'Smaller image model, kept for reference. Rejected as the default: its config omits the preprocessing parameters and search ranking is visibly worse. See ADR 10.',
    milestone: 'M2',
  },
  {
    id: 'image-text-clip-vit-b32',
    task: 'image-text-embedding',
    label: 'CLIP ViT-B/32 (int8)',
    repo: 'Xenova/clip-vit-base-patch32',
    revision: 'main',
    tier: 'on-demand',
    minTier: 'A',
    license: 'MIT',
    licenseUrl: 'https://huggingface.co/openai/clip-vit-base-patch32',
    dtype: 'q8',
    files: [
      'onnx/text_model_quantized.onnx',
      'onnx/vision_model_quantized.onnx',
      'config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'vocab.json',
      'merges.txt',
    ],
    meta: { dimensions: 512, imageSize: 224 },
    notes: 'The photo search model. MIT licensed, fully specified config, and correct ranking in testing.',
    milestone: 'M2',
  },
  {
    id: 'ocr-trocr-small-printed',
    task: 'ocr',
    label: 'TrOCR small, printed (int8)',
    repo: 'Xenova/trocr-small-printed',
    revision: 'main',
    tier: 'on-demand',
    minTier: 'B',
    license: 'MIT',
    licenseUrl: 'https://huggingface.co/microsoft/trocr-small-printed',
    dtype: 'q8',
    files: [
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'sentencepiece.bpe.model',
    ],
    meta: { imageSize: 384, language: 'en' },
    notes:
      'Reads one line of printed text at a time, so the desktop finds the lines itself. Chosen over tesseract.js because it needs no new dependency, no binary in the repository and no third host: it is a model like the others, downloaded with consent and verified against a digest.',
    milestone: 'M4',
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
