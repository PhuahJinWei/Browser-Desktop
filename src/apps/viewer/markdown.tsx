import type { ReactNode } from 'react';

/**
 * A small Markdown renderer.
 *
 * Emits React elements rather than an HTML string, which means there is no `dangerouslySetInnerHTML`
 * anywhere and therefore no way for a user's own file to inject markup into the desktop. That is
 * the entire reason this is hand-written instead of imported: a renderer that returns HTML would
 * need a sanitiser too, and the pair costs more than the subset actually needed here.
 *
 * Supported: headings, paragraphs, bold, italic, inline code, links, fenced and indented code,
 * unordered and ordered lists, blockquotes, horizontal rules, and tables.
 */

type Inline = ReactNode;

/** Inline formatting, resolved in one pass so nesting cannot run away. */
function renderInline(text: string, keyPrefix: string): Inline[] {
  const nodes: Inline[] = [];
  // Code first: its contents must not be re-scanned for other syntax.
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)\s]+\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let counter = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${counter++}`;

    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      const safe = /^https?:\/\//i.test(href);
      // Anything that is not plain http(s) renders as text: no javascript: or data: links.
      nodes.push(
        safe ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (!line.trim()) {
      index++;
      continue;
    }

    // Fenced code
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index]!.startsWith('```')) body.push(lines[index++]!);
      index++;
      blocks.push(
        <pre key={key++} data-language={language || undefined}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const content = renderInline(heading[2]!, `h${key}`);
      const Tag = `h${Math.min(6, level + 1)}` as 'h2';
      blocks.push(<Tag key={key++}>{content}</Tag>);
      index++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\s*\1\s*\1[\s\S]*$/.test(line) && line.trim().length >= 3) {
      blocks.push(<hr key={key++} />);
      index++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (index < lines.length && lines[index]!.startsWith('>')) {
        body.push(lines[index]!.replace(/^>\s?/, ''));
        index++;
      }
      blocks.push(<blockquote key={key++}>{renderInline(body.join(' '), `q${key}`)}</blockquote>);
      continue;
    }

    // Table: a header row followed by a separator of dashes.
    if (line.includes('|') && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[index + 1] ?? '')) {
      const cells = (row: string) =>
        row
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((cell) => cell.trim());

      const header = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.includes('|')) rows.push(cells(lines[index++]!));

      blocks.push(
        <table key={key++}>
          <thead>
            <tr>
              {header.map((cell, cellIndex) => (
                <th key={cellIndex}>{renderInline(cell, `th${key}-${cellIndex}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{renderInline(cell, `td${key}-${rowIndex}-${cellIndex}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // Lists
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        const nextBullet = /^\s*[-*+]\s+(.*)$/.exec(current);
        const nextOrdered = /^\s*\d+[.)]\s+(.*)$/.exec(current);
        if (isOrdered ? !nextOrdered : !nextBullet) break;
        items.push((isOrdered ? nextOrdered! : nextBullet!)[1]!);
        index++;
      }
      const ListTag = isOrdered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={key++}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `li${key}-${itemIndex}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[index]!)
    ) {
      paragraph.push(lines[index++]!);
    }
    blocks.push(<p key={key++}>{renderInline(paragraph.join(' '), `p${key}`)}</p>);
  }

  return blocks;
}
