/**
 * Chunking.
 *
 * An embedding model has a fixed context (256 tokens for the bundled MiniLM), so a document has to
 * be cut up before it can be indexed. Where the cuts land decides search quality: split mid-
 * sentence and both halves embed to something the sentence never meant.
 *
 * So: prefer paragraph boundaries, fall back to sentences, and only split mid-sentence when a
 * single sentence is longer than a whole chunk. Overlap carries context across the seams, so a
 * fact spanning a boundary is still findable.
 */

export interface Chunk {
  text: string;
  /** Character offsets into the source, so a hit can be highlighted in the original. */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /**
   * Target characters per chunk. ~900 is roughly 200 tokens of English prose, comfortably inside
   * the model's window with room for the tokeniser being less generous than the estimate.
   */
  targetChars?: number;
  maxChars?: number;
  overlapChars?: number;
  minChars?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetChars: 900,
  maxChars: 1400,
  overlapChars: 150,
  minChars: 60,
};

/** Splits into paragraphs, keeping each one's offset in the original text. */
function paragraphs(text: string): { text: string; start: number }[] {
  const parts: { text: string; start: number }[] = [];
  const pattern = /\n\s*\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const slice = text.slice(cursor, match.index);
    if (slice.trim()) parts.push({ text: slice, start: cursor });
    cursor = match.index + match[0].length;
  }
  const tail = text.slice(cursor);
  if (tail.trim()) parts.push({ text: tail, start: cursor });
  return parts;
}

/** Sentence boundaries, deliberately simple: end punctuation followed by whitespace. */
function sentences(text: string, offset: number): { text: string; start: number }[] {
  const parts: { text: string; start: number }[] = [];
  const pattern = /[^.!?]+[.!?]+[\])'"`]*\s*|[^.!?]+$/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match[0].trim()) parts.push({ text: match[0], start: offset + match.index });
  }
  return parts.length > 0 ? parts : [{ text, start: offset }];
}

/**
 * Chunks are described by offsets and the text is sliced from the source, never rebuilt by
 * concatenation. That guarantees `source.slice(chunk.start, chunk.end) === chunk.text`, which is
 * what lets a search hit be highlighted in the original document — an earlier version joined the
 * pieces with its own separators and the offsets quietly stopped lining up.
 */
export function chunkText(source: string, options: ChunkOptions = {}): Chunk[] {
  const { targetChars, maxChars, overlapChars, minChars } = { ...DEFAULTS, ...options };
  const text = source.replace(/\r\n/g, '\n');
  if (text.trim().length === 0) return [];

  const units: { text: string; start: number }[] = [];
  for (const paragraph of paragraphs(text)) {
    if (paragraph.text.length <= maxChars) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of sentences(paragraph.text, paragraph.start)) {
      if (sentence.text.length <= maxChars) {
        units.push(sentence);
        continue;
      }
      // A single sentence longer than a chunk: hard-split it, with no better option available.
      for (let offset = 0; offset < sentence.text.length; offset += maxChars) {
        units.push({
          text: sentence.text.slice(offset, offset + maxChars),
          start: sentence.start + offset,
        });
      }
    }
  }

  const chunks: Chunk[] = [];
  /** The span being accumulated, as offsets into `text`. */
  let span: { start: number; end: number } | null = null;

  /** Trims whitespace by moving the offsets, so the slice stays a real slice. */
  const emit = (start: number, end: number): Chunk | null => {
    let from = start;
    let to = end;
    while (from < to && /\s/.test(text[from]!)) from++;
    while (to > from && /\s/.test(text[to - 1]!)) to--;
    return to > from ? { text: text.slice(from, to), start: from, end: to } : null;
  };

  const flush = () => {
    if (!span) return;
    const chunk = emit(span.start, span.end);
    span = null;
    if (!chunk) return;

    const previous = chunks[chunks.length - 1];
    // Too short to stand alone: extend the previous chunk instead of emitting a fragment.
    if (chunk.text.length < minChars && previous) {
      const merged = emit(previous.start, chunk.end);
      if (merged) chunks[chunks.length - 1] = merged;
      return;
    }
    chunks.push(chunk);
  };

  for (const unit of units) {
    const unitEnd = unit.start + unit.text.length;
    if (!span) {
      span = { start: unit.start, end: unitEnd };
      continue;
    }
    if (unitEnd - span.start <= targetChars) {
      span.end = unitEnd;
      continue;
    }

    flush();

    // Overlap: begin the next chunk part-way back through the previous one, at a sentence
    // boundary where possible, so a fact spanning the seam is still findable from either side.
    const previous = chunks[chunks.length - 1];
    let start = unit.start;
    if (previous && overlapChars > 0 && previous.end - previous.start > overlapChars) {
      const candidate = Math.max(previous.start, previous.end - overlapChars);
      const window = text.slice(candidate, previous.end);
      const boundary = window.search(/[.!?]\s|\n/);
      start = boundary >= 0 ? candidate + boundary + 1 : candidate;
    }
    span = { start: Math.min(start, unit.start), end: unitEnd };
  }
  flush();

  return chunks;
}
