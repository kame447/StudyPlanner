import type { MaterialStructureItem } from './bookshelfMaterialDetails';

export type MaterialStructurePatch = Partial<Pick<
  MaterialStructureItem,
  'title' | 'startUnit' | 'endUnit' | 'progressRate'
>>;

/** Build an in-memory UI tree. Repair duplicate IDs without changing valid identities or storage. */
export function createMaterialStructureDraft(items: MaterialStructureItem[]): MaterialStructureItem[] {
  const reservedIds = new Set<string>();
  function reserve(rows: MaterialStructureItem[]) {
    rows.forEach(item => {
      reservedIds.add(item.id);
      if (item.children) reserve(item.children);
    });
  }
  reserve(items);
  const usedIds = new Set<string>();
  function clone(rows: MaterialStructureItem[]): MaterialStructureItem[] {
    return rows.map(item => {
      let id = item.id;
      if (usedIds.has(id)) {
        let suffix = 2;
        do { id = `${item.id}-duplicate-${suffix++}`; } while (reservedIds.has(id) || usedIds.has(id));
      }
      usedIds.add(id);
      return { ...item, id, ...(item.children ? { children: clone(item.children) } : {}) };
    });
  }
  return clone(items);
}

export function updateMaterialStructureItem(
  items: MaterialStructureItem[],
  itemId: string,
  patch: MaterialStructurePatch,
): MaterialStructureItem[] {
  return items.map(item => item.id === itemId
    ? { ...item, ...patch }
    : item.children ? { ...item, children: updateMaterialStructureItem(item.children, itemId, patch) } : item);
}

/** Removing a parent removes its subtree, as in the original root-only editor. */
export function removeMaterialStructureItem(items: MaterialStructureItem[], itemId: string): MaterialStructureItem[] {
  return items.filter(item => item.id !== itemId).map(item => item.children
    ? { ...item, children: removeMaterialStructureItem(item.children, itemId) } : item);
}

export function hasUnnamedMaterialStructureItem(items: MaterialStructureItem[]): boolean {
  return items.some(item => !item.title.trim()
    || Boolean(item.children && hasUnnamedMaterialStructureItem(item.children)));
}
