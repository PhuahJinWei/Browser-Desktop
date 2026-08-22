import { describe, expect, it } from 'vitest';
import { groupDuplicates } from './duplicates';
import { VectorIndex } from './vectors';

describe('groupDuplicates', () => {
  it('turns a pair into a group of two', () => {
    const groups = groupDuplicates([{ a: 'x', b: 'y', score: 0.97 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ids.sort()).toEqual(['x', 'y']);
    expect(groups[0]!.minScore).toBeCloseTo(0.97);
  });

  it('joins overlapping pairs into one group, transitively', () => {
    // A crop of a crop: a~b and b~c, but a and c never scored above the threshold together.
    const groups = groupDuplicates([
      { a: 'a', b: 'b', score: 0.96 },
      { a: 'b', b: 'c', score: 0.95 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ids.sort()).toEqual(['a', 'b', 'c']);
    expect(groups[0]!.minScore).toBeCloseTo(0.95);
    expect(groups[0]!.maxScore).toBeCloseTo(0.96);
  });

  it('keeps unrelated pairs in separate groups', () => {
    const groups = groupDuplicates([
      { a: 'a', b: 'b', score: 0.99 },
      { a: 'c', b: 'd', score: 0.93 },
    ]);
    expect(groups).toHaveLength(2);
    // The closer pair sorts first when both are the same size.
    expect(groups[0]!.ids.sort()).toEqual(['a', 'b']);
  });

  it('puts the biggest pile first', () => {
    const groups = groupDuplicates([
      { a: 'a', b: 'b', score: 0.99 },
      { a: 'c', b: 'd', score: 0.94 },
      { a: 'd', b: 'e', score: 0.94 },
    ]);
    expect(groups[0]!.ids).toHaveLength(3);
  });

  it('orders members by the preference the caller passes', () => {
    const groups = groupDuplicates([{ a: 'old', b: 'new', score: 0.98 }], ['new', 'old']);
    // The first member is what the UI offers to keep.
    expect(groups[0]!.ids[0]).toBe('new');
  });

  it('returns nothing for no pairs', () => {
    expect(groupDuplicates([])).toEqual([]);
  });
});

describe('VectorIndex.pairsAbove', () => {
  it('finds only the pairs above the threshold', () => {
    const index = new VectorIndex(4);
    index.add('a', [1, 0, 0, 0]);
    index.add('a-copy', [0.99, 0.14, 0, 0]);
    index.add('elsewhere', [0, 0, 1, 0]);

    const pairs = index.pairsAbove(0.92);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a, pairs[0]!.b].sort()).toEqual(['a', 'a-copy']);
    expect(pairs[0]!.score).toBeGreaterThan(0.92);
  });

  it('agrees with the unpruned answer', () => {
    // The prefix bound must never reject a pair that qualifies. Vectors are built so that the
    // first 64 dimensions say little and the tail decides, which is the case the bound must
    // survive.
    const dimensions = 128;
    const index = new VectorIndex(dimensions);
    const rows: number[][] = [];
    let seed = 99;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296 - 0.5;
    };

    for (let i = 0; i < 40; i++) {
      const vector = Array.from({ length: dimensions }, (_, d) => (d < 64 ? 0.05 : random()));
      rows.push(vector);
      index.add(`v${i}`, vector);
    }

    const normalise = (v: number[]) => {
      const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
      return v.map((x) => x / norm);
    };
    const expected: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = normalise(rows[i]!);
        const b = normalise(rows[j]!);
        const dot = a.reduce((sum, x, d) => sum + x * b[d]!, 0);
        if (dot >= 0.4) expected.push([`v${i}`, `v${j}`].join('~'));
      }
    }

    const found = index.pairsAbove(0.4).map((pair) => [pair.a, pair.b].sort().join('~'));
    expect(found.sort()).toEqual(expected.sort());
  });

  it('leaves out rows the caller excludes', () => {
    const index = new VectorIndex(2);
    index.add('photo', [1, 0]);
    index.add('frame@1', [1, 0]);
    index.add('frame@3', [1, 0]);

    const pairs = index.pairsAbove(0.9, { include: (id) => !id.includes('@') });
    expect(pairs).toEqual([]);
  });

  it('reports progress once per row considered', () => {
    const index = new VectorIndex(2);
    for (let i = 0; i < 5; i++) index.add(`v${i}`, [Math.cos(i), Math.sin(i)]);

    const seen: number[] = [];
    index.pairsAbove(0.99, { onProgress: (_done, total) => seen.push(total) });
    expect(seen).toHaveLength(5);
    expect(seen.every((total) => total === 5)).toBe(true);
  });

  it('handles an index too small to have a pair', () => {
    const index = new VectorIndex(2);
    expect(index.pairsAbove(0.9)).toEqual([]);
    index.add('only', [1, 0]);
    expect(index.pairsAbove(0.9)).toEqual([]);
  });
});
