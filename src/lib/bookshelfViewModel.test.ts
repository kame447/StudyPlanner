import { describe, expect, it } from 'vitest';
import {
  filterBookshelfMaterials,
  prepareBookshelfStructurePreferences,
  selectFrequentBookshelfMaterials,
  selectRecentBookshelfMaterials,
} from './bookshelfViewModel';
import {
  getDefaultMaterialDetailPreferences,
  type MaterialDetailPreferences,
} from './bookshelfMaterialDetails';
import type { Actual, StudyMaterial } from '../types/domain';

function material(id: string, patch: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id,
    userId: 'user-1',
    name: id,
    subjectId: 'english',
    subjectName: '英語',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  };
}

function actual(patch: Partial<Actual>): Actual {
  return {
    id: 'actual-1',
    userId: 'user-1',
    planId: null,
    occurrenceDate: '2026-08-01',
    actualStartTime: '10:00',
    actualEndTime: '11:00',
    subject: '英語',
    note: '',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  };
}

describe('filterBookshelfMaterials', () => {
  const materials = Object.freeze([
    material('vocabulary', { name: 'TOEIC 単語集', aliases: ['金フレ', 'Gold'] }),
    material('math', { name: '数学演習', subjectId: 'math', subjectName: '数学' }),
    material('grammar', { name: '文法問題集' }),
  ]);

  it.each([
    ['', ['vocabulary', 'math', 'grammar']],
    [' \t　', ['vocabulary', 'math', 'grammar']],
    ['　toeic　', ['vocabulary']],
    ['英語', ['vocabulary', 'grammar']],
    ['金フレ', ['vocabulary']],
    [' GOLD ', ['vocabulary']],
    ['存在しない教材', []],
  ])('searches names, subjects and aliases for %j in input order', (searchQuery, ids) => {
    expect(filterBookshelfMaterials({ materials, activeSubjectId: 'all', searchQuery })
      .map((item) => item.id)).toEqual(ids);
  });

  it('combines the selected subject with search, including an unknown subject', () => {
    expect(filterBookshelfMaterials({ materials, activeSubjectId: 'math', searchQuery: '' }))
      .toEqual([materials[1]]);
    expect(filterBookshelfMaterials({ materials, activeSubjectId: 'math', searchQuery: '金フレ' }))
      .toEqual([]);
    expect(filterBookshelfMaterials({ materials, activeSubjectId: 'missing', searchQuery: '' }))
      .toEqual([]);
  });
});

describe('selectFrequentBookshelfMaterials', () => {
  it('prioritizes favorites over session count, then recent updates, and shows at most three', () => {
    const favorite = material('favorite');
    const oftenStudied = material('often');
    const recentlyUpdated = material('updated', { updatedAt: '2026-08-03T00:00:00.000Z' });
    const older = material('older');
    const materials = Object.freeze([older, recentlyUpdated, oftenStudied, favorite]);
    const actuals = Object.freeze([
      actual({ id: 'session-1', materialId: oftenStudied.id }),
      actual({ id: 'session-2', materialId: oftenStudied.id }),
    ]);
    const preferencesByMaterialId = new Map([
      [favorite.id, { ...getDefaultMaterialDetailPreferences(), favorite: true }],
      [older.id, getDefaultMaterialDetailPreferences()],
    ]);

    expect(selectFrequentBookshelfMaterials({ materials, actuals, preferencesByMaterialId }))
      .toEqual([favorite, oftenStudied, recentlyUpdated]);
    expect(materials).toEqual([older, recentlyUpdated, oftenStudied, favorite]);
    expect(actuals).toHaveLength(2);
    expect(preferencesByMaterialId.size).toBe(2);
  });

  it('orders favorites by frequency and update time, preserving input order on a full tie', () => {
    const first = material('first');
    const tied = material('tied');
    const recent = material('recent', { updatedAt: '2026-08-02T00:00:00.000Z' });
    const studied = material('studied');
    const materials = Object.freeze([first, tied, recent, studied]);
    const preferencesByMaterialId = new Map(materials.map((item) => [
      item.id,
      { ...getDefaultMaterialDetailPreferences(), favorite: true },
    ]));

    expect(selectFrequentBookshelfMaterials({
      materials,
      actuals: [actual({ materialId: studied.id })],
      preferencesByMaterialId,
    })).toEqual([studied, recent, first]);
  });

  it('uses material IDs before names and retains trimmed legacy-name matching', () => {
    const idLinked = material('id-linked', { name: '改名後' });
    const nameLinked = material('name-linked', { name: '旧教材', aliases: ['別名'] });
    const unstudied = material('unstudied', { updatedAt: '2026-08-10T00:00:00.000Z' });

    expect(selectFrequentBookshelfMaterials({
      materials: [unstudied, nameLinked, idLinked],
      actuals: [
        actual({ materialId: idLinked.id, materialName: nameLinked.name }),
        actual({ materialId: idLinked.id, materialName: '以前の名前' }),
        actual({ materialId: null, materialName: ` ${nameLinked.name} ` }),
        actual({ materialId: 'other', materialName: unstudied.name }),
        actual({ materialName: '別名' }),
        actual({ materialName: ' ' }),
        actual({ materialProgressUpdates: [{ materialId: unstudied.id }] }),
      ],
      preferencesByMaterialId: new Map(),
    })).toEqual([idLinked, nameLinked, unstudied]);
  });

  it('returns empty and short lists without inventing entries', () => {
    const options = { actuals: [], preferencesByMaterialId: new Map() };
    expect(selectFrequentBookshelfMaterials({ ...options, materials: [] })).toEqual([]);
    const only = material('only');
    expect(selectFrequentBookshelfMaterials({ ...options, materials: [only] })).toEqual([only]);
  });
});

describe('selectRecentBookshelfMaterials', () => {
  it('uses creation time rather than updates, caps at three and preserves tied input order', () => {
    const old = material('old', { updatedAt: '2026-08-30T00:00:00.000Z' });
    const first = material('first', { createdAt: '2026-08-02T00:00:00.000Z' });
    const tied = material('tied', { createdAt: first.createdAt });
    const newest = material('newest', { createdAt: '2026-08-03T00:00:00.000Z' });
    const materials = Object.freeze([old, first, tied, newest]);

    expect(selectRecentBookshelfMaterials(materials)).toEqual([newest, first, tied]);
    expect(materials).toEqual([old, first, tied, newest]);
    expect(selectRecentBookshelfMaterials([])).toEqual([]);
    expect(selectRecentBookshelfMaterials([old])).toEqual([old]);
  });
});

describe('prepareBookshelfStructurePreferences', () => {
  it('trims top-level titles and drops empty items without changing nested data or the draft', () => {
    const preferences: MaterialDetailPreferences = {
      structureEnabled: true,
      structureVisible: true,
      favorite: true,
      structureItems: [
        {
          id: 'keep',
          title: '　基礎編  ',
          startUnit: 0,
          endUnit: 100,
          progressRate: 25,
          children: [{ id: 'child', title: ' 子項目 ' }],
        },
        { id: 'empty', title: ' \t　', children: [{ id: 'orphan', title: 'child' }] },
        { id: 'last', title: '応用編' },
      ],
    };
    const original = structuredClone(preferences);

    const prepared = prepareBookshelfStructurePreferences(preferences);

    expect(prepared).toEqual({
      ...original,
      structureItems: [
        { ...original.structureItems[0], title: '基礎編' },
        original.structureItems[2],
      ],
    });
    expect(preferences).toEqual(original);
    expect(prepared).not.toBe(preferences);
    expect(prepared.structureItems[0]).not.toBe(preferences.structureItems[0]);
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('resolves visibility for enabled=%s and visible=%s', (structureEnabled, structureVisible, expected) => {
    const preferences = {
      ...getDefaultMaterialDetailPreferences(),
      structureEnabled,
      structureVisible,
    };
    expect(prepareBookshelfStructurePreferences(preferences)).toEqual({
      ...preferences,
      structureVisible: expected,
    });
  });
});
