import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk';
import { Bm25Index, fuseRankings, tokenize } from './bm25';
import { VectorIndex } from './vectors';

describe('chunkText', () => {
  it('returns nothing for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps a short document as one chunk', () => {
    const chunks = chunkText('A short note about the monitor invoice.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe('A short note about the monitor invoice.');
  });

  it('reports offsets that address the original text', () => {
    const source = 'First paragraph.\n\nSecond paragraph is here.';
    for (const chunk of chunkText(source)) {
      expect(source.slice(chunk.start, chunk.end)).toBe(chunk.text);
    }
  });

  it('splits long documents into several chunks', () => {
    const paragraph = 'The quick brown fox jumps over the lazy dog. '.repeat(12);
    const source = Array.from({ length: 8 }, () => paragraph).join('\n\n');
    const chunks = chunkText(source);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1600);
  });

  it('splits a sentence longer than a whole chunk rather than dropping it', () => {
    const monster = `${'word '.repeat(600)}.`;
    const chunks = chunkText(monster);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)).toBeGreaterThan(2000);
  });

  it('does not emit a fragment when the tail is tiny', () => {
    const source = `${'Sentence about invoices. '.repeat(50)}\n\nok`;
    const chunks = chunkText(source);
    // The stray "ok" is folded into the previous chunk instead of standing alone.
    expect(chunks.every((chunk) => chunk.text.length > 20)).toBe(true);
    expect(chunks.at(-1)!.text.endsWith('ok')).toBe(true);
  });
});

describe('tokenize', () => {
  it('lowercases and drops punctuation', () => {
    expect(tokenize('Invoice #428-291, for the Monitor.')).toEqual([
      'invoice',
      '428',
      '291',
      'monitor',
    ]);
  });

  it('keeps digits, which is what makes part numbers findable', () => {
    expect(tokenize('Samsung S27A600')).toEqual(['samsung', 's27a600']);
  });

  it('drops stop words and single characters', () => {
    expect(tokenize('the a of x')).toEqual([]);
  });
});

describe('Bm25Index', () => {
  const index = new Bm25Index();
  index.add('a', tokenize('The invoice for the Samsung monitor was approved.'));
  index.add('b', tokenize('Meeting notes about the budget and the hiring plan.'));
  index.add('c', tokenize('Another invoice, this one for a standing desk.'));

  it('ranks the document containing the rare term first', () => {
    const [top] = index.search('samsung');
    expect(top?.id).toBe('a');
  });

  it('reports which terms matched, for highlighting', () => {
    const [top] = index.search('samsung monitor');
    expect(top?.terms.sort()).toEqual(['monitor', 'samsung']);
  });

  it('returns nothing for a term that appears nowhere', () => {
    expect(index.search('helicopter')).toEqual([]);
  });

  it('finds every document sharing a common term', () => {
    expect(
      index
        .search('invoice')
        .map((hit) => hit.id)
        .sort(),
    ).toEqual(['a', 'c']);
  });

  it('forgets a removed document', () => {
    const scratch = new Bm25Index();
    scratch.add('x', tokenize('unique keyword here'));
    expect(scratch.search('unique')).toHaveLength(1);
    scratch.remove('x');
    expect(scratch.search('unique')).toHaveLength(0);
    expect(scratch.size).toBe(0);
  });

  it('replaces rather than duplicates when the same id is added twice', () => {
    const scratch = new Bm25Index();
    scratch.add('x', tokenize('first version about cats'));
    scratch.add('x', tokenize('second version about dogs'));
    expect(scratch.size).toBe(1);
    expect(scratch.search('cats')).toHaveLength(0);
    expect(scratch.search('dogs')).toHaveLength(1);
  });
});

describe('VectorIndex', () => {
  it('ranks by cosine similarity regardless of magnitude', () => {
    const index = new VectorIndex(3);
    index.add('x', [1, 0, 0]);
    index.add('y', [0, 1, 0]);
    // Same direction as x, ten times the length: cosine must not care.
    index.add('z', [10, 0, 0]);

    const hits = index.search([1, 0, 0], 3);
    expect(hits[0]!.score).toBeCloseTo(1, 5);
    expect([hits[0]!.id, hits[1]!.id].sort()).toEqual(['x', 'z']);
    expect(hits[2]!.id).toBe('y');
  });

  it('honours the result limit', () => {
    const index = new VectorIndex(2);
    for (let i = 0; i < 50; i++) index.add(`id-${i}`, [Math.cos(i), Math.sin(i)]);
    expect(index.search([1, 0], 5)).toHaveLength(5);
  });

  it('removes without corrupting the remaining rows', () => {
    const index = new VectorIndex(2);
    index.add('a', [1, 0]);
    index.add('b', [0, 1]);
    index.add('c', [-1, 0]);
    expect(index.remove('a')).toBe(true);
    expect(index.size).toBe(2);
    expect(index.has('a')).toBe(false);

    // The swap-with-last removal must leave b and c intact and still findable.
    expect(index.search([0, 1], 1)[0]!.id).toBe('b');
    expect(index.search([-1, 0], 1)[0]!.id).toBe('c');
  });

  it('overwrites in place when an id is re-added', () => {
    const index = new VectorIndex(2);
    index.add('a', [1, 0]);
    index.add('a', [0, 1]);
    expect(index.size).toBe(1);
    expect(index.search([0, 1], 1)[0]!.score).toBeCloseTo(1, 5);
  });

  it('grows past its initial capacity', () => {
    const index = new VectorIndex(4, 2);
    // Spread the vectors around a circle so neighbours are genuinely distinguishable; packing
    // them near-parallel would only measure float32 precision.
    for (let i = 0; i < 100; i++) {
      const angle = (i / 100) * Math.PI * 2;
      index.add(`id-${i}`, [Math.cos(angle), Math.sin(angle), 0, 0]);
    }
    expect(index.size).toBe(100);
    const angle = (42 / 100) * Math.PI * 2;
    expect(index.search([Math.cos(angle), Math.sin(angle), 0, 0], 1)[0]!.id).toBe('id-42');
  });

  it('applies minScore even when the index is smaller than the limit', () => {
    // The regression: minScore used to be consulted only once the result list was full, so a
    // caller asking for more hits than the index holds got everything back unfiltered. Video
    // search asks for 240 hits over a handful of frames, and got the whole video as one match.
    const index = new VectorIndex(2);
    index.add('near', [1, 0]);
    index.add('sideways', [0, 1]);
    index.add('away', [-1, 0]);

    const hits = index.search([1, 0], 240, 0.5);
    expect(hits.map((hit) => hit.id)).toEqual(['near']);
  });

  it('returns nothing when everything is below the floor', () => {
    const index = new VectorIndex(2);
    index.add('a', [0, 1]);
    expect(index.search([1, 0], 10, 0.5)).toEqual([]);
  });

  it('still returns the top-k when the floor admits everything', () => {
    const index = new VectorIndex(2);
    index.add('a', [1, 0]);
    index.add('b', [0.9, 0.1]);
    index.add('c', [0.8, 0.2]);
    expect(index.search([1, 0], 2, 0).map((hit) => hit.id)).toEqual(['a', 'b']);
  });

  it('round-trips through serialisation', () => {
    const index = new VectorIndex(3);
    index.add('a', [1, 0, 0]);
    index.add('b', [0, 1, 0]);

    const restored = VectorIndex.deserialize(index.serialize());
    expect(restored.size).toBe(2);
    expect(restored.search([1, 0, 0], 1)[0]!.id).toBe('a');
  });
});

describe('fuseRankings', () => {
  it('rewards a document that both rankings agree on', () => {
    // 'b' is second in each list, 'a' and 'c' are first in one and absent from the other.
    const semantic = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
    ];
    const keyword = [
      { id: 'c', score: 12 },
      { id: 'b', score: 9 },
    ];
    expect(fuseRankings([semantic, keyword])[0]!.id).toBe('b');
  });

  it('ignores the incomparable scales of the two rankings', () => {
    // BM25 scores are unbounded and cosine scores are not; fusing by rank sidesteps that.
    const semantic = [{ id: 'a', score: 0.51 }];
    const keyword = [{ id: 'b', score: 999 }];
    const fused = fuseRankings([semantic, keyword]);
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score, 10);
  });

  it('applies weights', () => {
    const semantic = [{ id: 'a', score: 1 }];
    const keyword = [{ id: 'b', score: 1 }];
    expect(fuseRankings([semantic, keyword], [2, 1])[0]!.id).toBe('a');
  });
});
