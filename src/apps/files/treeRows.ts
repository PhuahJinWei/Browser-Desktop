/**
 * The folder tree's rows, worked out from what has been read and what is open.
 *
 * Kept apart from the component so the part that decides where the period's dotted lines go can
 * be tested without a file system: a line that should stop and does not, or a folder offered an
 * expander it cannot use, is a bug the eye forgives and a user notices.
 */

export interface TreeRow {
  id: string;
  name: string;
  depth: number;
  /** Unknown until the folder's listing has been read; no expander is drawn until then. */
  hasChildren: boolean | null;
  expanded: boolean;
  /** For each ancestor level, whether a later sibling continues the line down past this row. */
  continues: boolean[];
  /** The last of its siblings, where the line from the parent stops. */
  last: boolean;
}

export function treeRows(
  root: { id: string; name: string },
  children: ReadonlyMap<string, readonly { id: string; name: string }[]>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (id: string, name: string, depth: number, continues: boolean[], last: boolean) => {
    const list = children.get(id);
    const open = expanded.has(id);
    out.push({
      id,
      name,
      depth,
      hasChildren: list === undefined ? null : list.length > 0,
      expanded: open,
      continues,
      last,
    });
    if (!open || !list) return;
    list.forEach((child, index) =>
      walk(child.id, child.name, depth + 1, [...continues, !last], index === list.length - 1),
    );
  };
  walk(root.id, root.name, 0, [], true);
  return out;
}
