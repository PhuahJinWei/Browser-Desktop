import { embedTexts, search, searchPhotos } from './client';

/**
 * What a sandboxed app is allowed to reach of the search service.
 *
 * A deliberately narrow re-export rather than handing the app host the whole client: an app gets
 * embeddings, document hits and photo hits, and nothing that could clear an index, queue work or
 * change a model. Keeping that boundary in one small file makes it obvious when it widens.
 */

export async function embedForApps(texts: string[]): Promise<Float32Array[]> {
  // Routed through the scheduler like everything else, so an app's work is visible in the Task
  // Manager and cannot jump the queue simply by being an app.
  return embedTexts(texts);
}

export async function searchForApps(
  query: string,
  limit: number,
): Promise<{ fileId: string; fileName: string; snippet: string; score: number }[]> {
  const hits = await search(query, limit);
  return hits.map((hit) => ({
    fileId: hit.fileId,
    fileName: hit.fileName,
    snippet: hit.snippet,
    score: hit.score,
  }));
}

export async function searchPhotosForApps(
  query: string,
  limit: number,
): Promise<{ id: string; name: string; score: number }[]> {
  const hits = await searchPhotos(query, limit);
  return hits.map((hit) => ({ id: hit.id, name: hit.name, score: hit.score }));
}
