import { describe, expect, it } from 'vitest';
import type { MaterialStructureItem } from './bookshelfMaterialDetails';
import { createMaterialStructureDraft, hasUnnamedMaterialStructureItem, removeMaterialStructureItem, updateMaterialStructureItem } from './materialStructureEditor';

const items: MaterialStructureItem[] = [{ id: 'chapter', title: '章', children: [
  { id: 'section', title: '節', children: [{ id: 'subsection', title: '小節', startUnit: 4, endUnit: 8 }] },
  { id: 'sibling', title: '次の節' },
] }, { id: 'other', title: '次の章' }];

describe('material structure draft tree', () => {
  it('clones every level while preserving each valid identity and saved values', () => {
    const draft = createMaterialStructureDraft(items);
    expect(draft).toEqual(items);
    draft[0].children![0].children![0].title = '未保存';
    expect(items[0].children![0].children![0].title).toBe('小節');
  });
  it('repairs cross-level and sibling ID collisions without claiming another original ID', () => {
    const source = [{ id: 'same', title: '章', children: [
      { id: 'same', title: '節A' }, { id: 'same', title: '節B' },
    ] }, { id: 'same-duplicate-2', title: '既存の別章' }];
    const draft = createMaterialStructureDraft(source);
    expect(draft.map(item => item.id)).toEqual(['same', 'same-duplicate-2']);
    expect(draft[0].children!.map(item => item.id)).toEqual(['same-duplicate-3', 'same-duplicate-4']);
    expect(createMaterialStructureDraft(draft)).toEqual(draft);
    const edited = updateMaterialStructureItem(draft, 'same-duplicate-4', { title: '修正B' });
    expect(edited[0].title).toBe('章');
    expect(edited[0].children!.map(item => item.title)).toEqual(['節A', '修正B']);
    expect(source[0].children!.map(item => item.id)).toEqual(['same', 'same']);
  });
  it('updates a deep item immutably and keeps parent, siblings and optional progress', () => {
    const before = structuredClone(items);
    const edited = updateMaterialStructureItem(items, 'subsection', { title: '修正', startUnit: 5, endUnit: undefined, progressRate: 25 });
    expect(edited[0].children![0].children![0]).toEqual({ id: 'subsection', title: '修正', startUnit: 5, endUnit: undefined, progressRate: 25 });
    expect(edited[0].children![1]).toEqual(items[0].children![1]);
    expect(edited[1]).toEqual(items[1]);
    expect(items).toEqual(before);
    expect(updateMaterialStructureItem(items, 'missing', { title: 'none' })).toEqual(items);
  });
  it('deletes exactly a deep subtree and preserves all other branches', () => {
    const removed = removeMaterialStructureItem(items, 'section');
    expect(removed[0].children).toEqual([{ id: 'sibling', title: '次の節' }]);
    expect(removed[1]).toEqual(items[1]);
    expect(removeMaterialStructureItem(items, 'chapter')).toEqual([items[1]]);
    expect(items[0].children![0].children).toHaveLength(1);
  });
  it('detects an empty name at any level before persistence can drop that subtree', () => {
    expect(hasUnnamedMaterialStructureItem(items)).toBe(false);
    expect(hasUnnamedMaterialStructureItem(updateMaterialStructureItem(items, 'section', { title: '  ' }))).toBe(true);
    expect(hasUnnamedMaterialStructureItem([])).toBe(false);
  });
});
