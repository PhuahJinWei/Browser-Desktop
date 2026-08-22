/**
 * A minimal PDF writer.
 *
 * The sample dataset needs real PDFs — ones pdf.js can open and extract text from — so that the
 * headline demo ("find the invoice for the monitor") exercises the actual PDF path rather than a
 * text file wearing a `.pdf` extension. A PDF containing nothing but Helvetica text is a few
 * hundred bytes of well-documented structure, which is cheaper than a dependency and produces
 * files small enough to generate at first boot.
 *
 * Deliberately limited: one font, no images, no compression, no wrapping beyond what the caller
 * provides.
 */

export interface PdfPage {
  lines: { text: string; size?: number; bold?: boolean }[];
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;

/** PDF strings escape backslashes and parentheses; anything non-ASCII is transliterated away. */
function escapeText(text: string): string {
  return (
    text
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      // Non-breaking spaces become ordinary ones; built from a code point so no
      // invisible character ends up in this file.
      .split(String.fromCharCode(160))
      .join(' ')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
  );
}

function contentStream(page: PdfPage): string {
  const parts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;
  let currentFont = '';

  for (const line of page.lines) {
    const size = line.size ?? 11;
    const font = line.bold ? '/F2' : '/F1';
    if (font !== currentFont) {
      parts.push(`${font} ${size} Tf`);
      currentFont = font;
    } else {
      parts.push(`${font} ${size} Tf`);
    }
    // Absolute positioning per line: simpler than tracking leading, and exact.
    parts.push(`1 0 0 1 ${MARGIN} ${Math.round(y)} Tm`);
    parts.push(`(${escapeText(line.text)}) Tj`);
    y -= size * 1.55;
  }

  parts.push('ET');
  return parts.join('\n');
}

/** Builds a complete PDF file with a correct cross-reference table. */
export function createPdf(pages: PdfPage[], title: string): Uint8Array {
  const objects: string[] = [];
  const pageCount = Math.max(1, pages.length);

  // Object numbering: 1 catalog, 2 page tree, 3 font, 4 bold font, then page/content pairs.
  const firstPageObject = 5;
  const pageIds = Array.from({ length: pageCount }, (_, index) => firstPageObject + index * 2);

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

  pages.forEach((page, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const stream = contentStream(page);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  const infoId = pageIds[pageCount - 1]! + 2;
  objects[infoId] = `<< /Title (${escapeText(title)}) /Producer (Tabula) >>`;

  // Assemble, recording the byte offset of every object for the xref table.
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  const encoder = new TextEncoder();
  const byteLength = (text: string) => encoder.encode(text).length;

  for (let id = 1; id < objects.length; id++) {
    const object = objects[id];
    if (!object) continue;
    offsets[id] = byteLength(body);
    body += `${id} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = byteLength(body);
  const maxId = objects.length;

  let xref = `xref\n0 ${maxId}\n0000000000 65535 f \n`;
  for (let id = 1; id < maxId; id++) {
    const offset = offsets[id];
    xref +=
      offset === undefined
        ? '0000000000 65535 f \n'
        : `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${maxId} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(body + xref + trailer);
}
