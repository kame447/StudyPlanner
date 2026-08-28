import { describe, expect, it } from 'vitest';
import { searchBuiltInMaterialCatalog } from './builtInMaterialCatalog';

describe('built-in material catalog', () => {
  it('returns known material names from the existing StudyPlanner catalog', () => {
    const results = searchBuiltInMaterialCatalog('青チャート');

    expect(results[0]).toMatchObject({
      catalogEntryId: 'builtin:青チャート',
      title: '青チャート',
      authors: [],
    });
  });

  it('normalizes equivalent spacing variants and keeps one candidate', () => {
    const results = searchBuiltInMaterialCatalog('ターゲット 1900');

    expect(results.filter((candidate) => candidate.catalogEntryId === 'builtin:ターゲット1900'))
      .toHaveLength(1);
  });

  it('does not treat a subject label itself as a seeded material', () => {
    const results = searchBuiltInMaterialCatalog('数学');

    expect(results.some((candidate) => candidate.title === '数学')).toBe(false);
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
