/**
 * Text extraction.
 *
 * Turns a file's bytes into plain text the indexer can chunk. Runs inside the index worker, so a
 * 200-page PDF never blocks the desktop.
 */

export interface ExtractedText {
  text: string;
  /** Character offset where each page starts, so a search hit can name the page it came from. */
  pageOffsets?: number[];
  truncated: boolean;
}

/** Guards against a pathological file consuming the whole index. */
const MAX_CHARACTERS = 2_000_000;

function decode(data: ArrayBuffer): string {
  // `fatal: false` so a stray byte in an otherwise readable file does not lose the whole document.
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

async function extractPdf(data: ArrayBuffer): Promise<ExtractedText> {
  // Imported lazily: pdf.js is large, and most sessions never open a PDF.
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;

  // destroy() lives on the loading task in pdf.js 6; the document proxy only has cleanup().
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
  const document = await loadingTask.promise;
  const parts: string[] = [];
  const pageOffsets: number[] = [];
  let length = 0;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      pageOffsets.push(length);
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();

      // pdf.js emits positioned runs, not lines. `hasEOL` is the only reliable line signal.
      let pageText = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        pageText += item.str;
        if (item.hasEOL) pageText += '\n';
        else if (item.str && !item.str.endsWith(' ')) pageText += ' ';
      }

      const cleaned = pageText
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      parts.push(cleaned);
      length += cleaned.length + 2;
      page.cleanup();

      if (length > MAX_CHARACTERS) {
        return { text: parts.join('\n\n').slice(0, MAX_CHARACTERS), pageOffsets, truncated: true };
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  return { text: parts.join('\n\n'), pageOffsets, truncated: false };
}

/** Strips Markdown syntax so the index holds prose rather than punctuation. */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*\|/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

export async function extractText(
  data: ArrayBuffer,
  mime: string,
  name: string,
): Promise<ExtractedText> {
  if (mime === 'application/pdf') return extractPdf(data);

  const raw = decode(data);
  const truncated = raw.length > MAX_CHARACTERS;
  const text = truncated ? raw.slice(0, MAX_CHARACTERS) : raw;

  if (mime === 'text/markdown' || name.endsWith('.md')) {
    return { text: stripMarkdown(text), truncated };
  }
  if (mime === 'application/json') {
    // Values carry the meaning; keys are structure. Extracting both would drown the signal.
    try {
      const values: string[] = [];
      const walk = (value: unknown) => {
        if (typeof value === 'string') values.push(value);
        else if (typeof value === 'number' || typeof value === 'boolean')
          values.push(String(value));
        else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') Object.values(value).forEach(walk);
      };
      walk(JSON.parse(text));
      return { text: values.join('\n'), truncated };
    } catch {
      return { text, truncated };
    }
  }

  return { text, truncated };
}
