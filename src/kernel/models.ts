import registry from '../../models.json';

/**
 * The model registry.
 *
 * This used to be a manager: consent dialogs, download jobs with progress and cancellation,
 * per-file SHA-256 verification at runtime, and a cache keyed by the URL the ML library would have
 * requested so it never issued one itself. All of that existed because weights arrived over the
 * network from another host.
 *
 * They do not any more. `tools/sync-model.mjs` fetches the one remaining model at build time,
 * checks it against the digests below, and writes it into `public/models/` — so it is served from
 * this origin like any other asset, and the runtime is configured to refuse remote loading
 * outright (`src/services/ai/runtime.ts`). Verification moved from runtime to build time; consent
 * became unnecessary rather than implicit, because there is nothing to consent to.
 *
 * What is left is a description: what ships, how big it is, where it came from and under what
 * licence. See ADR 3 and ADR 15.
 */

/** Only 'bundled' remains. The on-demand tier was removed with the models that used it. */
export type ModelTier = 'bundled';
/** One task, one model. The on-demand tier was removed in full — see ADR 15. */
export type ModelTask = 'text-embedding';

export interface ModelFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ModelDescriptor {
  id: string;
  task: ModelTask;
  label: string;
  tier: ModelTier;
  minHardwareTier: 'A' | 'B' | 'C';
  milestone: string;
  source: { host: string; repo: string; revision: string };
  dtype: string;
  license: { name: string; url: string };
  totalBytes: number;
  files: ModelFile[];
  meta?: { dimensions?: number; imageSize?: number; languages?: string; chunkSeconds?: number };
  notes: string;
}

export const MODELS: ModelDescriptor[] = (registry as { models: ModelDescriptor[] }).models;

export function getModel(id: string): ModelDescriptor | undefined {
  return MODELS.find((model) => model.id === id);
}

export function modelsForTask(task: ModelTask): ModelDescriptor[] {
  return MODELS.filter((model) => model.task === task);
}

/** Where a file is served from — this origin, under the base path. */
export function fileUrl(model: ModelDescriptor, path: string): string {
  return `${import.meta.env.BASE_URL}models/${model.source.repo}/${path}`;
}

/** Where it was fetched from at build time, for the record shown in Settings. */
export function upstreamUrl(model: ModelDescriptor, path: string): string {
  return `https://${model.source.host}/${model.source.repo}/resolve/${model.source.revision}/${path}`;
}
