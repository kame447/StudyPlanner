import { describe, expect, it } from 'vitest';
import { parseMaterialContentsPhotoResult } from '../../shared/materialContentsPhoto';
import { materialContentsToStructure } from './materialContentsPhoto';
import { prepareBookshelfStructurePreferences } from './bookshelfViewModel';
const row = { title: ' 基礎 ', level: 1, startPage: 3, endPage: null };
describe('material contents photo boundary', () => {
  it('preserves chapter, section and subsection pages without inventing end pages', () => {
    const structureItems = materialContentsToStructure([row, { ...row, title: '節', level: 2 }, { ...row, title: '小節', level: 3, endPage: 5 }, { ...row, title: '章2', startPage: 10 }]);
    expect(structureItems).toHaveLength(2);
    expect(structureItems[0]).toMatchObject({ title: '基礎', startUnit: 3, children: [{ title: '節', children: [{ title: '小節', endUnit: 5 }] }] });
    expect(structureItems[0].endUnit).toBeUndefined();
    expect(prepareBookshelfStructurePreferences({ structureItems, structureEnabled: true, structureVisible: true, favorite: true }).structureItems).toEqual(structureItems);
  });
  it('imports headings and hierarchy without page-based progress for non-page materials', () => {
    const items = materialContentsToStructure([row, { ...row, level: 2, endPage: 5 }], false);
    expect(items[0].startUnit).toBeUndefined();
    expect(items[0].children?.[0].endUnit).toBeUndefined();
    expect(items[0].children?.[0].title).toBe('基礎');
  });
  it.each([
    { items: [] }, { items: [row], extra: true }, { items: [{ ...row, extra: true }] },
    { items: [{ ...row, level: 2 }] }, { items: [row, { ...row, level: 3 }] },
    { items: [{ ...row, startPage: '3' }] }, { items: [{ ...row, startPage: 0 }] },
    { items: [{ ...row, startPage: 1.5 }] }, { items: [{ ...row, endPage: 2 }] },
    { items: [{ ...row, title: ' ' }] }, { items: [{ ...row, title: 'a'.repeat(301) }] },
    { items: Array.from({ length: 151 }, () => row) },
  ])('rejects malformed output atomically: %j', value => {
    expect(parseMaterialContentsPhotoResult(value)).toBeNull();
    if (!('extra' in value)) expect(() => materialContentsToStructure(value.items as never)).toThrow();
  });
});
