import { describe, expect, it } from 'vitest';
import { MATERIAL_CATALOG_SEED_ENTRIES } from '../data/material-catalog';
import { searchBuiltInMaterialCatalog } from './builtInMaterialCatalog';

describe('built-in material catalog', () => {
  it('ships a broad curated material seed instead of relying on generic NLP keywords', () => {
    expect(MATERIAL_CATALOG_SEED_ENTRIES.length).toBeGreaterThanOrEqual(250);
    expect(new Set(MATERIAL_CATALOG_SEED_ENTRIES.map((entry) => entry.id)).size)
      .toBe(MATERIAL_CATALOG_SEED_ENTRIES.length);
    expect(new Set(MATERIAL_CATALOG_SEED_ENTRIES.map((entry) => entry.subject)).size)
      .toBeGreaterThanOrEqual(12);
  });

  it('resolves common aliases to a canonical seeded material', () => {
    expect(searchBuiltInMaterialCatalog('金フレ')[0]).toMatchObject({
      catalogEntryId: 'seed:eng-kintore',
      title: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
      subjectHint: '英語',
      materialKind: 'TOEIC',
    });

    expect(searchBuiltInMaterialCatalog('ターゲット 1900')[0]).toMatchObject({
      catalogEntryId: 'seed:eng-target1900',
      title: '英単語ターゲット1900',
    });
  });

  it('returns multiple concrete candidates when a series alias maps to several books', () => {
    const results = searchBuiltInMaterialCatalog('青チャート');

    expect(results.map((candidate) => candidate.title)).toEqual([
      '青チャート 数学I+A',
      '青チャート 数学II+B+C',
      '青チャート 数学III+C',
    ]);
    expect(results.every((candidate) => candidate.subjectHint === '数学')).toBe(true);
  });

  it('keeps useful long legacy candidates without promoting short generic NLP terms', () => {
    expect(searchBuiltInMaterialCatalog('経済セミナー')[0]).toMatchObject({
      catalogEntryId: 'builtin-legacy:経済セミナー',
      title: '経済セミナー',
    });
    expect(searchBuiltInMaterialCatalog('関正生')).toEqual([]);
    expect(searchBuiltInMaterialCatalog('微分')).toEqual([]);
  });

  it('does not short-circuit external search for partial or ambiguous terms', () => {
    expect(searchBuiltInMaterialCatalog('チャート')).toEqual([]);
    expect(searchBuiltInMaterialCatalog('微')).toEqual([]);
  });

  it('leaves ISBN and unknown titles to the shared catalog/provider path', () => {
    expect(searchBuiltInMaterialCatalog('9784023315686')).toEqual([]);
    expect(searchBuiltInMaterialCatalog('存在しない教材XYZ987')).toEqual([]);
  });
});
