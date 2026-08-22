/**
 * Grouping near-duplicates.
 *
 * The index can say which *pairs* of pictures are alike. What someone wants to see is *sets*: the
 * four copies of one photograph, together, so they can keep one. Turning pairs into sets is a
 * connected-components problem, solved here with union-find.
 *
 * Transitivity is deliberate and worth stating, because it is the one surprising property. If A is
 * a near-duplicate of B and B of C, then A, B and C are shown as one group even when A and C are
 * below the threshold — a crop of a crop. That is almost always what is meant, and the alternative
 * (only showing pairs that are all mutually similar) splits an obvious set of five into a
 * confusing lattice of overlapping pairs.
 */

export interface DuplicatePair {
  a: string;
  b: string;
  score: number;
}

export interface DuplicateGroup {
  ids: string[];
  /** Weakest link in the group — how loosely its members are related. */
  minScore: number;
  /** Closest pair in the group. */
  maxScore: number;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(id: string): string {
    const seen = this.parent.get(id);
    if (seen === undefined) {
      this.parent.set(id, id);
      return id;
    }
    if (seen === id) return id;
    const root = this.find(seen);
    // Path compression, so a long chain of crops does not become a long walk.
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

/**
 * Turns pairs into groups.
 *
 * `order` decides how members are listed within a group and how groups are listed relative to each
 * other — the caller passes the ids in the order it wants to prefer (largest first, say), so the
 * first member of a group is the one the UI suggests keeping.
 */
export function groupDuplicates(pairs: DuplicatePair[], order: string[] = []): DuplicateGroup[] {
  const sets = new UnionFind();
  for (const pair of pairs) sets.union(pair.a, pair.b);

  const members = new Map<string, Set<string>>();
  for (const pair of pairs) {
    for (const id of [pair.a, pair.b]) {
      const root = sets.find(id);
      const group = members.get(root);
      if (group) group.add(id);
      else members.set(root, new Set([id]));
    }
  }

  const rank = new Map(order.map((id, index) => [id, index]));
  const positionOf = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;

  const groups: DuplicateGroup[] = [];
  for (const [root, ids] of members) {
    const inGroup = pairs.filter((pair) => sets.find(pair.a) === root);
    const scores = inGroup.map((pair) => pair.score);
    groups.push({
      ids: [...ids].sort((a, b) => positionOf(a) - positionOf(b)),
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
    });
  }

  // Biggest piles first — they are the ones worth acting on — then by how alike they are.
  return groups.sort(
    (a, b) =>
      b.ids.length - a.ids.length ||
      b.maxScore - a.maxScore ||
      positionOf(a.ids[0] ?? '') - positionOf(b.ids[0] ?? ''),
  );
}

/**
 * How alike two pictures must be to count as the same picture.
 *
 * Measured on the sample set, which contains deliberate duplicates:
 *
 * | pair                                                  | score |
 * | ----------------------------------------------------- | ----- |
 * | a picture and the same picture saved at lower quality | 0.98  |
 * | a picture and a frame exported from a video of it     | 0.97  |
 * | a picture and a crop of itself                        | 0.95  |
 * | the two most similar *different* pictures in the set  | 0.79  |
 *
 * That last row is a sunset over the sea against a tropical beach: a horizon, a sky gradient and a
 * sun in both, and still only 0.79. Every genuinely different pair in the set scores 0.79 or less,
 * every copy scores 0.95 or more, and 0.92 sits in the empty band between them.
 *
 * Erring high is the right direction: a missed duplicate costs nothing, and a false one invites
 * someone to delete a photograph that was not a copy.
 */
export const DUPLICATE_THRESHOLD = 0.92;
