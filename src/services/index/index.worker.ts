import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { exposeRpc, transfer } from '../../kernel/rpc';
import { configureRuntime } from '../ai/runtime';
import { extractText } from '../extract/text';
import { chunkText } from './chunk';
import { Bm25Index, fuseRankings, tokenize } from './bm25';
import { VectorIndex } from './vectors';
import { idb, openDatabase, transact } from '../../kernel/idb';
import { makeThumbnail } from './thumbnail-render';

/**
 * The search service.
 *
 * One worker owns the embedding model, the vector index and the keyword index, because all three
 * are needed together on every query and shuttling embeddings between workers would cost more
 * than the search does. Text extraction happens here too, so a 200-page PDF never touches the
 * main thread.
 */

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DB_NAME = 'tabula-index';
const DB_VERSION = 1;

export interface IndexedDocument {
  id: string;
  name: string;
  mime: string;
  chunks: { text: string; start: number; end: number }[];
  indexedAt: number;
  pageOffsets?: number[];
}

export interface SearchHit {
  fileId: string;
  fileName: string;
  mime: string;
  chunkIndex: number;
  start: number;
  end: number;
  score: number;
  snippet: string;
  /** Character ranges within `snippet` to mark, so the reason for the hit is visible. */
  highlights: [number, number][];
  /** Which ranking produced it, shown in the UI so hybrid search is not a black box. */
  matched: 'both' | 'semantic' | 'keyword';
  page?: number;
}

export interface IndexStats {
  documents: number;
  chunks: number;
  terms: number;
  model: string;
  backend: string;
  dimensions: number;
  vectorBytes: number;
  ready: boolean;
}

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;
let backend: 'webgpu' | 'wasm' = 'wasm';
let modelId = DEFAULT_MODEL;
let dimensions = 384;

const documents = new Map<string, IndexedDocument>();
let vectors = new VectorIndex(dimensions);
const keywords = new Bm25Index();

/** `${fileId}#${chunkIndex}` — the id both indexes agree on. */
const chunkKey = (fileId: string, index: number) => `${fileId}#${index}`;
const parseChunkKey = (key: string): { fileId: string; index: number } => {
  const hash = key.lastIndexOf('#');
  return { fileId: key.slice(0, hash), index: Number(key.slice(hash + 1)) };
};

async function getExtractor(
  report?: (payload: unknown) => void,
): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  loading ??= (async () => {
    configureRuntime();
    const pipe = (await pipeline('feature-extraction', modelId, {
      device: backend,
      dtype: 'q8',
      ...(report ? { progress_callback: (progress: unknown) => report(progress) } : {}),
    })) as FeatureExtractionPipeline;
    extractor = pipe;
    return pipe;
  })();
  return loading;
}

async function embed(
  texts: string[],
  report?: (payload: unknown) => void,
): Promise<Float32Array[]> {
  const pipe = await getExtractor(report);
  const output = await pipe(texts, { pooling: 'mean', normalize: true });
  const width = output.dims.at(-1) ?? dimensions;
  dimensions = width;
  if (vectors.dimensions !== width) vectors = new VectorIndex(width);

  const flat = output.data as Float32Array;
  return texts.map((_, row) => flat.slice(row * width, (row + 1) * width) as Float32Array);
}

/* -------------------------------------------------------------------------------------------- */
/* Snippets                                                                                       */
/* -------------------------------------------------------------------------------------------- */

/**
 * Picks the most relevant window of a chunk and marks the query terms inside it.
 *
 * A result the user cannot see the reason for is barely better than no result, so the snippet is
 * centred on the densest cluster of matched terms rather than simply starting at the beginning.
 */
function makeSnippet(
  text: string,
  terms: string[],
  maxLength = 260,
): { snippet: string; highlights: [number, number][] } {
  if (terms.length === 0) {
    const snippet = text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
    return { snippet, highlights: [] };
  }

  const lower = text.toLowerCase();
  const positions: { start: number; end: number }[] = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at === -1) break;
      positions.push({ start: at, end: at + term.length });
      from = at + term.length;
      if (positions.length > 200) break;
    }
  }

  if (positions.length === 0) {
    const snippet = text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
    return { snippet, highlights: [] };
  }

  // Densest window: the start position with the most matches within maxLength of it.
  positions.sort((a, b) => a.start - b.start);
  let bestIndex = 0;
  let bestCount = 0;
  for (let i = 0; i < positions.length; i++) {
    let count = 0;
    for (
      let j = i;
      j < positions.length && positions[j]!.start - positions[i]!.start < maxLength;
      j++
    )
      count++;
    if (count > bestCount) {
      bestCount = count;
      bestIndex = i;
    }
  }

  const anchor = positions[bestIndex]!.start;
  let start = Math.max(0, anchor - 60);
  // Start at a word boundary so the snippet does not open mid-word.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space - start < 20) start = space + 1;
  }
  let end = Math.min(text.length, start + maxLength);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start + maxLength / 2) end = space;
  }

  const snippet = `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
  const shift =
    (start > 0 ? 1 : 0) -
    start -
    (text.slice(start, end).length - text.slice(start, end).trimStart().length);

  const highlights = positions
    .filter((position) => position.start >= start && position.end <= end)
    .map((position) => [position.start + shift, position.end + shift] as [number, number])
    .filter(([from, to]) => from >= 0 && to <= snippet.length && to > from);

  return { snippet, highlights };
}

/* -------------------------------------------------------------------------------------------- */
/* Persistence                                                                                    */
/* -------------------------------------------------------------------------------------------- */

async function database(): Promise<IDBDatabase> {
  return openDatabase(DB_NAME, DB_VERSION, [{ name: 'index', keyPath: 'key' }]);
}

interface Snapshot {
  key: 'current';
  model: string;
  dimensions: number;
  documents: IndexedDocument[];
  ids: string[];
  data: ArrayBuffer;
}

/**
 * Whether {@link restore} has run.
 *
 * Saving before restoring would write an empty index over a good snapshot — the whole session's
 * work lost to a background job that happened to finish first. Every write checks this.
 */
let restoreAttempted = false;

async function persist(): Promise<void> {
  if (!restoreAttempted) return;

  const serialized = vectors.serialize();
  const snapshot: Snapshot = {
    key: 'current',
    model: modelId,
    dimensions: serialized.dimensions,
    documents: [...documents.values()],
    ids: serialized.ids,
    data: serialized.data,
  };
  const db = await database();
  await transact(db, 'index', 'readwrite', (tx) => idb.put(tx.objectStore('index'), snapshot));
  db.close();
}

/**
 * Restores a previous session's index.
 *
 * Worth the code: without it every reload re-embeds everything, which on the reference machine is
 * about six seconds per thousand chunks of otherwise unnecessary work — and it would happen while
 * the user is trying to search.
 */
async function restore(): Promise<boolean> {
  restoreAttempted = true;
  const db = await database();
  const snapshot = await transact(db, 'index', 'readonly', (tx) =>
    idb.get<Snapshot>(tx.objectStore('index'), 'current'),
  );
  db.close();
  if (!snapshot || snapshot.model !== modelId) return false;

  documents.clear();
  for (const document of snapshot.documents) documents.set(document.id, document);

  dimensions = snapshot.dimensions;
  vectors = VectorIndex.deserialize({
    ids: snapshot.ids,
    dimensions: snapshot.dimensions,
    data: snapshot.data,
  });

  // BM25 is cheap to rebuild from the chunk texts, so it is not stored.
  keywords.clear();
  for (const document of documents.values()) {
    document.chunks.forEach((chunk, index) => {
      keywords.add(chunkKey(document.id, index), tokenize(chunk.text));
    });
  }

  return true;
}

/* -------------------------------------------------------------------------------------------- */
/* RPC surface                                                                                    */
/* -------------------------------------------------------------------------------------------- */

export type IndexMethods = {
  configure: (options: { backend: 'webgpu' | 'wasm'; model?: string }) => IndexStats;
  restoreIndex: () => boolean;
  indexDocument: (input: { id: string; name: string; mime: string; data: ArrayBuffer }) => {
    chunks: number;
    skipped?: string;
  };
  /** Indexes text the caller extracted itself — the route OCR takes. */
  indexText: (input: { id: string; name: string; mime: string; text: string }) => {
    chunks: number;
    skipped?: string;
  };
  removeDocument: (id: string) => boolean;
  search: (options: { query: string; limit?: number }) => SearchHit[];
  stats: () => IndexStats;
  clear: () => void;
  save: () => void;
  warmUp: () => boolean;
  /** Embeds arbitrary text. Exposed for apps built on the SDK. */
  embedTexts: (texts: string[]) => number[][];

  /**
   * A thumbnail for the Photos grid. No model involved — decode, draw small, encode.
   *
   * It lives in this worker rather than on the main thread because decoding a 4000-pixel
   * photograph is exactly the work that makes a grid stutter if it happens where the UI runs.
   */
  thumbnail: (input: { mime: string; data: ArrayBuffer }) => {
    width: number;
    height: number;
    blob: ArrayBuffer | null;
  };
  indexedDocumentIds: () => string[];
};

function currentStats(): IndexStats {
  let chunks = 0;
  for (const document of documents.values()) chunks += document.chunks.length;
  return {
    documents: documents.size,
    chunks,
    terms: keywords.terms,
    model: modelId,
    backend,
    dimensions,
    vectorBytes: vectors.bytes,
    ready: extractor !== null,
  };
}

/**
 * The shared tail of indexing: chunk, embed, store.
 *
 * Two callers reach it — a file whose text was extracted from its own bytes, and a scanned page
 * whose text came from a model reading pixels. From here on they are the same document, which is
 * why Search cannot tell them apart and does not need to.
 */
async function indexPlainText(
  input: { id: string; name: string; mime: string },
  text: string,
  report: (payload: unknown) => void,
): Promise<{ chunks: number; skipped?: string }> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return { chunks: 0, skipped: 'no content after chunking' };

  // Replace any previous version of this file before adding the new one.
  const previous = documents.get(input.id);
  if (previous) {
    previous.chunks.forEach((_, index) => {
      const key = chunkKey(input.id, index);
      vectors.remove(key);
      keywords.remove(key);
    });
  }

  const embeddings = await embed(
    chunks.map((chunk) => chunk.text),
    report,
  );

  chunks.forEach((chunk, index) => {
    const key = chunkKey(input.id, index);
    vectors.add(key, embeddings[index]!);
    keywords.add(key, tokenize(chunk.text));
  });

  documents.set(input.id, {
    id: input.id,
    name: input.name,
    mime: input.mime,
    chunks: chunks.map((chunk) => ({ text: chunk.text, start: chunk.start, end: chunk.end })),
    indexedAt: Date.now(),
  });

  return { chunks: chunks.length };
}

exposeRpc<IndexMethods>({
  configure: async ([options]) => {
    if (options.backend !== backend || (options.model && options.model !== modelId)) {
      // Changing model or backend invalidates the loaded pipeline, and a different model
      // invalidates the vectors themselves.
      const modelChanged = Boolean(options.model && options.model !== modelId);
      extractor = null;
      loading = null;
      backend = options.backend;
      if (options.model) modelId = options.model;
      if (modelChanged) {
        documents.clear();
        keywords.clear();
        vectors.clear();
      }
    }
    return currentStats();
  },

  restoreIndex: async () => restore(),

  warmUp: async (_args, report) => {
    await getExtractor(report);
    return true;
  },

  embedTexts: async ([texts]) => {
    const vectors = await embed(texts);
    // Plain arrays, not Float32Array: this crosses two boundaries (worker, then sandbox) and a
    // typed array survives neither cleanly.
    return vectors.map((vector) => [...vector]);
  },

  indexDocument: async ([input], report) => {
    const { text } = await extractText(input.data, input.mime, input.name);
    // A file with no extractable text is not a failure — a scanned page has none to extract, and
    // needs OCR to produce some, which arrives here later through indexText. Recording it as
    // skipped keeps it out of the retry queue.
    if (text.trim().length < 20) {
      documents.delete(input.id);
      return { chunks: 0, skipped: 'no extractable text' };
    }

    return indexPlainText(input, text, report);
  },

  /**
   * Indexes text the caller extracted itself.
   *
   * The route for OCR: a scanned page has no text layer to extract, so the words come from a model
   * looking at pixels instead. Once they exist they are an ordinary document — same chunking, same
   * embeddings, same snippets — and Search cannot tell the difference, which is the point.
   */
  indexText: async ([input], report) => {
    if (input.text.trim().length < 12) {
      documents.delete(input.id);
      return { chunks: 0, skipped: 'not enough text' };
    }
    return indexPlainText(input, input.text, report);
  },

  removeDocument: async ([id]) => {
    const document = documents.get(id);
    if (!document) return false;
    document.chunks.forEach((_, index) => {
      const key = chunkKey(id, index);
      vectors.remove(key);
      keywords.remove(key);
    });
    documents.delete(id);
    return true;
  },

  search: async ([options]) => {
    const query = options.query.trim();
    const limit = options.limit ?? 20;
    if (!query || documents.size === 0) return [];

    // Keyword search needs no model, so it answers even while the model is still downloading.
    const keywordHits = keywords.search(query, limit * 3);

    let semanticHits: { id: string; score: number }[] = [];
    // Offline with no model in memory, attempting to fetch it stalls the search for several
    // seconds before failing. Keyword results are already in hand, so return those immediately
    // rather than making the user wait for a request that cannot succeed.
    const modelReachable = extractor !== null || navigator.onLine;
    if (modelReachable) {
      try {
        const [queryVector] = await embed([query]);
        if (queryVector) semanticHits = vectors.search(queryVector, limit * 3, 0.15);
      } catch {
        // Degrade to keyword-only rather than failing the search outright.
      }
    }

    const fused = fuseRankings([semanticHits, keywordHits], [1, 0.9]).slice(0, limit);
    const semanticIds = new Set(semanticHits.map((hit) => hit.id));
    const keywordIds = new Set(keywordHits.map((hit) => hit.id));
    const terms = [...new Set(tokenize(query))];

    const results: SearchHit[] = [];
    for (const entry of fused) {
      const { fileId, index } = parseChunkKey(entry.id);
      const document = documents.get(fileId);
      const chunk = document?.chunks[index];
      if (!document || !chunk) continue;

      const { snippet, highlights } = makeSnippet(chunk.text, terms);
      results.push({
        fileId,
        fileName: document.name,
        mime: document.mime,
        chunkIndex: index,
        start: chunk.start,
        end: chunk.end,
        score: entry.score,
        snippet,
        highlights,
        matched:
          semanticIds.has(entry.id) && keywordIds.has(entry.id)
            ? 'both'
            : semanticIds.has(entry.id)
              ? 'semantic'
              : 'keyword',
      });
    }
    return results;
  },

  stats: async () => currentStats(),

  clear: async () => {
    documents.clear();
    keywords.clear();
    vectors.clear();
    const db = await database();
    await transact(db, 'index', 'readwrite', (tx) => idb.clear(tx.objectStore('index')));
    db.close();
  },

  save: async () => persist(),

  thumbnail: async ([input]) => {
    const made = await makeThumbnail(input.data, input.mime);
    if (!made) return { width: 0, height: 0, blob: null };
    const bytes = await made.blob.arrayBuffer();
    return transfer({ width: made.width, height: made.height, blob: bytes }, [bytes]);
  },

  indexedDocumentIds: async () => [...documents.keys()],
});
