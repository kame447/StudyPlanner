/** Components whose ancestor path reaches a cycle, including tails into it. */
export function findCyclicComponentAncestryV5(
  parentById: ReadonlyMap<string, string | null>,
): ReadonlySet<string> {
  const reachesCycle = new Map<string, boolean>();
  for (const start of parentById.keys()) {
    if (reachesCycle.has(start)) continue;
    const path = new Set<string>();
    let current: string | null | undefined = start;
    while (current && parentById.has(current) && !reachesCycle.has(current) && !path.has(current)) {
      path.add(current);
      current = parentById.get(current);
    }
    const cyclic = Boolean(current && (path.has(current) || reachesCycle.get(current)));
    for (const id of path) reachesCycle.set(id, cyclic);
  }
  return new Set([...parentById.keys()].filter(id => reachesCycle.get(id)));
}
