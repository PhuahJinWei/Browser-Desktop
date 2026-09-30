import { describe, expect, it } from 'vitest';
import { planCopy } from './copy';
import type { NodeId, VfsNode } from './types';

const NOW = 1_800_000_000_000;
const OLD = 1_600_000_000_000;

function file(id: string, parentId: string, name: string, extra: Partial<VfsNode> = {}): VfsNode {
  return {
    id,
    parentId,
    name,
    kind: 'file',
    mime: 'text/plain',
    size: 42,
    createdAt: OLD,
    modifiedAt: OLD,
    hash: `hash-of-${id}`,
    trashed: false,
    indexState: 'indexed',
    ...extra,
  };
}

function folder(id: string, parentId: string, name: string): VfsNode {
  return {
    id,
    parentId,
    name,
    kind: 'directory',
    mime: 'inode/directory',
    size: 0,
    createdAt: OLD,
    modifiedAt: OLD,
    trashed: false,
  };
}

/** Deterministic ids, so assertions can name them. */
function ids(): () => NodeId {
  let next = 0;
  return () => `new-${++next}`;
}

const none = new Map<NodeId, VfsNode[]>();

describe('planCopy — a single file', () => {
  const source = file('a', 'docs', 'report.txt', {
    sample: true,
    indexModel: 'minilm',
    trashedFrom: 'somewhere',
  });
  const { top, records } = planCopy([source], none, 'target', new Set(), NOW, ids());
  const copy = top[0]!;

  it('is a new node in the destination, under its own name', () => {
    expect(records).toHaveLength(1);
    expect(copy.id).toBe('new-1');
    expect(copy.parentId).toBe('target');
    expect(copy.name).toBe('report.txt');
  });

  it('shares the original bytes rather than duplicating them', () => {
    expect(copy.hash).toBe('hash-of-a');
    expect(copy.size).toBe(42);
    expect(copy.mime).toBe('text/plain');
  });

  it('is queued for indexing, because the index is per node and this one has no entry', () => {
    expect(copy.indexState).toBe('pending');
    expect(copy).not.toHaveProperty('indexModel');
  });

  it('does not inherit the flag that would let "clear sample data" delete the user’s copy', () => {
    expect(copy).not.toHaveProperty('sample');
    expect(copy).not.toHaveProperty('trashedFrom');
    expect(copy.trashed).toBe(false);
  });

  it('keeps the content’s modified date and takes a new creation date', () => {
    expect(copy.modifiedAt).toBe(OLD);
    expect(copy.createdAt).toBe(NOW);
  });
});

describe('planCopy — names in the destination', () => {
  it('becomes "name (2)" when pasted beside itself', () => {
    const { top } = planCopy(
      [file('a', 'docs', 'report.txt')],
      none,
      'docs',
      new Set(['report.txt']),
      NOW,
      ids(),
    );
    expect(top[0]!.name).toBe('report (2).txt');
  });

  it('keeps two same-named sources apart from each other, not only from what was there', () => {
    const { top } = planCopy(
      [file('a', 'x', 'notes.md'), file('b', 'y', 'notes.md')],
      none,
      'target',
      new Set(),
      NOW,
      ids(),
    );
    expect(top.map((node) => node.name)).toEqual(['notes.md', 'notes (2).md']);
  });
});

describe('planCopy — a folder and everything in it', () => {
  // projects/ holds plan.md and drafts/, which holds v1.md.
  const projects = folder('p', 'home', 'projects');
  const plan = file('f1', 'p', 'plan.md');
  const drafts = folder('d', 'p', 'drafts');
  const v1 = file('f2', 'd', 'v1.md');
  const tree = new Map<NodeId, VfsNode[]>([
    ['p', [plan, drafts]],
    ['d', [v1]],
  ]);

  const { top, records } = planCopy([projects], tree, 'archive', new Set(), NOW, ids());
  const byName = new Map(records.map((node) => [node.name, node]));

  it('copies every descendant, and only the one top-level node is returned', () => {
    expect(top).toHaveLength(1);
    expect(records.map((node) => node.name).sort()).toEqual(
      ['drafts', 'plan.md', 'projects', 'v1.md'].sort(),
    );
  });

  it('re-points every child at its parent’s new id, never the original’s', () => {
    const newProjects = byName.get('projects')!;
    const newDrafts = byName.get('drafts')!;
    expect(newProjects.parentId).toBe('archive');
    expect(byName.get('plan.md')!.parentId).toBe(newProjects.id);
    expect(newDrafts.parentId).toBe(newProjects.id);
    expect(byName.get('v1.md')!.parentId).toBe(newDrafts.id);
  });

  it('shares no id with the originals, so nothing is overwritten', () => {
    const originals = new Set(['p', 'f1', 'd', 'f2']);
    for (const node of records) expect(originals.has(node.id)).toBe(false);
  });

  it('writes each parent before any of its children', () => {
    const position = new Map(records.map((node, index) => [node.id, index]));
    for (const node of records) {
      if (node.parentId === 'archive') continue;
      expect(position.get(node.parentId!)!).toBeLessThan(position.get(node.id)!);
    }
  });

  it('gives folders no hash and no index state, and a fresh modified date', () => {
    const newProjects = byName.get('projects')!;
    expect(newProjects).not.toHaveProperty('hash');
    expect(newProjects).not.toHaveProperty('indexState');
    expect(newProjects.modifiedAt).toBe(NOW);
  });
});
