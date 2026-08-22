import { describe, expect, it } from 'vitest';
import {
  categoryOf,
  formatBytes,
  guessMime,
  isIndexable,
  isValidName,
  sanitizeName,
  uniqueName,
} from './types';

describe('sanitizeName', () => {
  it('strips path separators so a name can never escape its folder', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeName('a/b\\c')).toBe('abc');
  });

  it('removes characters that break on common file systems', () => {
    expect(sanitizeName('re:port*?.txt')).toBe('report.txt');
  });

  it('trims whitespace and leading dots', () => {
    expect(sanitizeName('  .hidden.txt  ')).toBe('hidden.txt');
  });

  it('keeps ordinary names untouched', () => {
    expect(sanitizeName('Quarterly report (final).md')).toBe('Quarterly report (final).md');
  });

  it('caps length', () => {
    expect(sanitizeName('x'.repeat(400))).toHaveLength(255);
  });
});

describe('isValidName', () => {
  it('rejects names that sanitize to nothing', () => {
    expect(isValidName('///')).toBe(false);
    expect(isValidName('   ')).toBe(false);
    expect(isValidName('..')).toBe(false);
  });

  it('accepts real names', () => {
    expect(isValidName('notes.md')).toBe(true);
  });
});

describe('uniqueName', () => {
  it('returns the name unchanged when free', () => {
    expect(uniqueName('a.txt', new Set())).toBe('a.txt');
  });

  it('suffixes before the extension', () => {
    expect(uniqueName('a.txt', new Set(['a.txt']))).toBe('a (2).txt');
    expect(uniqueName('a.txt', new Set(['a.txt', 'a (2).txt']))).toBe('a (3).txt');
  });

  it('handles names without an extension', () => {
    expect(uniqueName('Reports', new Set(['Reports']))).toBe('Reports (2)');
  });

  it('treats dotfiles as having no extension', () => {
    // `.gitignore` is a stem, not an extension — suffixing it as `(2).gitignore` would be wrong.
    expect(uniqueName('.gitignore', new Set(['.gitignore']))).toBe('.gitignore (2)');
  });
});

describe('guessMime and categoryOf', () => {
  it('maps the types the desktop opens', () => {
    expect(guessMime('a.md')).toBe('text/markdown');
    expect(guessMime('a.pdf')).toBe('application/pdf');
    expect(guessMime('a.unknownext')).toBe('application/octet-stream');
  });

  it('classifies by mime, falling back to the name', () => {
    expect(categoryOf({ kind: 'file', mime: 'image/png', name: 'a.png' })).toBe('image');
    expect(categoryOf({ kind: 'file', mime: '', name: 'a.mp3' })).toBe('audio');
    expect(categoryOf({ kind: 'file', mime: 'application/pdf', name: 'a.pdf' })).toBe('document');
    expect(categoryOf({ kind: 'directory', mime: '', name: 'Docs' })).toBe('other');
  });
});

describe('isIndexable', () => {
  it('accepts text and PDFs, which are what M1 can extract', () => {
    expect(isIndexable({ kind: 'file', mime: 'text/plain', name: 'a.txt' })).toBe(true);
    expect(isIndexable({ kind: 'file', mime: 'application/pdf', name: 'a.pdf' })).toBe(true);
  });

  it('rejects media, which needs the M2 models', () => {
    expect(isIndexable({ kind: 'file', mime: 'image/png', name: 'a.png' })).toBe(false);
    expect(isIndexable({ kind: 'directory', mime: '', name: 'Docs' })).toBe(false);
  });
});

describe('formatBytes', () => {
  it('formats across units, dropping decimals once the number is big enough not to need them', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(9.5 * 1024 * 1024)).toBe('9.5 MB');
    expect(formatBytes(22.6 * 1024 * 1024)).toBe('23 MB');
  });
});
