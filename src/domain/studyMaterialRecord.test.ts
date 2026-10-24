import { describe, expect, it } from 'vitest';
import type { StudyMaterial, StudyMaterialDraft, StudySubject } from '../types/domain';
import { prepareStudyMaterialRecord } from './studyMaterialRecord';

const subject: StudySubject = { id: 'subject', userId: 'owner', name: 'Math', color: '#123456',
  createdAt: 'old', updatedAt: 'old' };
const draft: StudyMaterialDraft = { userId: 'ignored', name: ' ignored ', subjectId: 'ignored', subjectName: 'ignored' };
const previous: StudyMaterial = { id: 'prior', userId: 'owner', name: 'Prior', subjectId: subject.id,
  subjectName: subject.name, createdAt: 'created', updatedAt: 'previous', catalogEntryId: 'catalog',
  catalogTitle: 'Title', catalogIsbn10: 'isbn10', catalogIsbn13: 'isbn13', aliases: ['Prior'],
  status: 'archived', studyStatus: 'completed', progressUnit: 'custom', progressUnitLabel: 'old label' };
function prepare(changes: Partial<StudyMaterialDraft> = {}, currentMaterial?: StudyMaterial) {
  return prepareStudyMaterialRecord({ draft: { ...draft, ...changes }, subject, currentMaterial,
    userId: 'owner', materialId: 'id', name: 'Admitted name', now: 'now' });
}

describe('prepareStudyMaterialRecord', () => {
  it('uses explicit admitted identity and creation defaults without a clock or ID generator', () => {
    expect(prepare()).toEqual({ id: 'id', userId: 'owner', name: 'Admitted name', subjectId: 'subject',
      subjectName: 'Math', color: '#123456', coverImageUrl: undefined, coverImageDataUrl: undefined,
      catalogEntryId: undefined, catalogTitle: undefined, catalogIsbn10: undefined, catalogIsbn13: undefined,
      aliases: [], status: 'active', studyStatus: 'studying', paceEnabled: false, progressUnit: 'page',
      progressUnitLabel: undefined, totalUnits: undefined, currentUnit: undefined, targetDate: undefined,
      estimatedMinutesPerUnit: undefined, maxUnitsPerDay: undefined, createdAt: 'now', updatedAt: 'now' });
  });

  it.each([
    [undefined, -3, undefined, -3], // Existing compatibility: no total does not clamp a negative current.
    [10, -3, 10, 0], [10, 15, 10, 10], [-2, 4, 0, 0],
    [Number.NaN, Number.NaN, undefined, undefined],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, undefined],
    [2.5, 1.5, 2.5, 1.5],
  ])('preserves numeric normalization for total %s / current %s', (totalUnits, currentUnit, total, current) => {
    const result = prepare({ totalUnits, currentUnit });
    expect(result.totalUnits).toBe(total);
    expect(result.currentUnit).toBe(current);
  });

  it.each([[-2, 0], [1.5, 1.5], [Number.NaN, undefined], [Infinity, undefined], [undefined, undefined]])(
    'preserves pace quantity normalization for %s', (value, expected) => {
      const result = prepare({ estimatedMinutesPerUnit: value, maxUnitsPerDay: value, paceEnabled: true });
      expect(result.estimatedMinutesPerUnit).toBe(expected);
      expect(result.maxUnitsPerDay).toBe(expected);
      expect(result.paceEnabled).toBe(true);
    },
  );

  it('retains catalog and status fallbacks but not an inherited custom label', () => {
    const result = prepare({ catalogEntryId: ' ', catalogTitle: '', catalogIsbn10: undefined }, previous);
    expect(result).toMatchObject({ catalogEntryId: 'catalog', catalogTitle: 'Title', catalogIsbn10: 'isbn10',
      catalogIsbn13: 'isbn13', aliases: ['Prior'], status: 'archived', studyStatus: 'completed',
      progressUnit: 'custom', progressUnitLabel: undefined, createdAt: 'created', updatedAt: 'now' });
  });

  it('preserves explicit empty arrays/colors, trims catalog and custom labels, and clears blank cover/date', () => {
    expect(prepare({ color: '', aliases: [], status: 'active', studyStatus: 'studying',
      catalogEntryId: ' new ', catalogTitle: ' New title ', catalogIsbn10: ' 10 ', catalogIsbn13: ' 13 ',
      progressUnit: 'custom', progressUnitLabel: ' lessons ', coverImageUrl: '', coverImageDataUrl: '',
      targetDate: '   ' }, previous)).toMatchObject({ color: '', aliases: [], status: 'active', studyStatus: 'studying',
      catalogEntryId: 'new', catalogTitle: 'New title', catalogIsbn10: '10', catalogIsbn13: '13',
      progressUnitLabel: 'lessons', coverImageUrl: undefined, coverImageDataUrl: undefined, targetDate: undefined });
    expect(prepare({ progressUnit: 'page', progressUnitLabel: 'ignored', targetDate: ' 2026-11-01 ',
      coverImageUrl: ' url ', coverImageDataUrl: ' data ' })).toMatchObject({ progressUnitLabel: undefined,
      targetDate: '2026-11-01', coverImageUrl: ' url ', coverImageDataUrl: ' data ' });
  });

  it('does not mutate any input and retains the original aliases reference', () => {
    const aliases = ['Alias'];
    const input = { draft: { ...draft, aliases }, subject: { ...subject }, currentMaterial: { ...previous },
      userId: 'owner', materialId: 'id', name: 'Name', now: 'now' };
    const snapshot = structuredClone(input);
    Object.freeze(aliases); Object.freeze(input.draft); Object.freeze(input.subject); Object.freeze(input.currentMaterial);
    const result = prepareStudyMaterialRecord(input);
    expect(input).toEqual(snapshot);
    expect(result.aliases).toBe(aliases);
    expect(result).not.toBe(input.currentMaterial);
  });
});
