import { uniqueName, type NodeId, type VfsNode } from './types';

/**
 * Planning a copy, kept apart from the store that carries it out.
 *
 * The store has to read a subtree out of IndexedDB and write the result back, and none of that can
 * run outside a worker. What is worth testing is everything in between: a deep copy has to hand every
 * node a new id, re-point every child at its parent's *new* id rather than the old one, settle name
 * collisions in the destination, and decide which of the original's fields a copy inherits. That is
 * all pure, so it lives here, where a test can reach it without a file system.
 *
 * No bytes are copied, only records. Blobs are content-addressed and reference-counted
 * (`deleteForever` counts the remaining `by_hash` references before it removes anything), so a copy
 * that shares its original's hash is safe by construction: deleting either one leaves the bytes for
 * the other. Copying a 200 MB video costs one small record.
 */

export interface CopyPlan {
  /** The copies of the requested sources, in request order — what the caller asked for. */
  top: VfsNode[];
  /** Every record to write, each parent before its children. */
  records: VfsNode[];
}

/**
 * @param sources   What to copy. The caller has already refused the root, trashed nodes, and a
 *                  folder copied into itself.
 * @param children  Each source folder's live children, and theirs, keyed by parent id. Trashed
 *                  children are absent: a copy is of what the user can see.
 * @param taken     Names already in use in the destination.
 */
export function planCopy(
  sources: readonly VfsNode[],
  children: ReadonlyMap<NodeId, readonly VfsNode[]>,
  targetId: NodeId,
  taken: ReadonlySet<string>,
  now: number,
  newId: () => NodeId,
): CopyPlan {
  const names = new Set(taken);
  const top: VfsNode[] = [];
  const records: VfsNode[] = [];

  const clone = (source: VfsNode, parentId: NodeId, name: string): VfsNode => {
    /*
     * Built field by field rather than spread from the original, because most of what a node carries
     * describes that node's history rather than its content, and a copy has none of it. `sample` in
     * particular must not travel: it is how "clear sample data" finds what to remove, and a copy the
     * user made of a sample file is theirs. `trashedFrom` and `indexModel` would be equally wrong.
     */
    const copy: VfsNode = {
      id: newId(),
      parentId,
      name,
      kind: source.kind,
      mime: source.mime,
      size: source.size,
      createdAt: now,
      // A copied file's content is as old as the original's, so it keeps the date sorting by
      // "Modified" should find. A folder's listing, on the other hand, really was just made.
      modifiedAt: source.kind === 'file' ? source.modifiedAt : now,
      trashed: false,
      ...(source.hash ? { hash: source.hash } : {}),
      // The index is keyed by node, so a copy needs its own entry to be found by search at all.
      ...(source.kind === 'file' ? { indexState: 'pending' as const } : {}),
    };
    records.push(copy);
    for (const child of children.get(source.id) ?? []) clone(child, copy.id, child.name);
    return copy;
  };

  for (const source of sources) {
    // Only the top level can collide. Inside a copied folder the siblings are exactly the ones that
    // were already unique in the original.
    const name = uniqueName(source.name, names);
    names.add(name);
    top.push(clone(source, targetId, name));
  }

  return { top, records };
}
