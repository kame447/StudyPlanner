import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
  removeWeeklyPlanningPreviewBlock,
} from './weeklyPlanningPreviewBlocks';

const PROPERTY_SEED = 20260714;
const PROPERTY_RUNS = 60;
const CREATED_AT = '2026-06-30T00:00:00.000Z';

function candidate(year: number, index = 0): WeeklyDraftCandidate {
  return {
    stableKey: `candidate:math:${year}:2026-06-27:${String(9 + index).padStart(2, '0')}:00`,
    date: '2026-06-27',
    startTime: `${String(9 + index).padStart(2, '0')}:00`,
    endTime: `${String(10 + index).padStart(2, '0')}:00`,
    durationMinutes: 60,
    title: `数学・数理系 ${year}年度`,
    field: '数学・数理系',
    year,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: `数学・数理系:${year}`,
  };
}

const candidateArrayArbitrary = fc
  .uniqueArray(fc.integer({ min: 2000, max: 2030 }), { minLength: 0, maxLength: 8 })
  .map((years) => years.map((year, index) => candidate(year, index)));

describe('weekly planning preview block contract', () => {
  it('promotes a preview candidate with draft metadata but without preview-only fields', () => {
    const source = candidate(2020);
    const [block] = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: [source],
      userId: 'user-1',
      createdAt: CREATED_AT,
    });

    expect(block).toMatchObject({
      id: source.stableKey,
      userId: 'user-1',
      date: source.date,
      startTime: source.startTime,
      endTime: source.endTime,
      title: source.title,
      subject: source.field,
      type: 'study',
      label: source.field,
      materialId: null,
      materialName: '',
      source: 'ai',
      status: 'draft',
      userEdited: false,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    expect(block?.memo).toContain('year: 2020');
    expect(block?.memo).toContain('estimatedMinutes: 60');
    expect(block?.memo).toContain(`workItemKey: ${source.workItemKey}`);
    expect(block?.memo).toContain('dry-run preview');
    expect(block).not.toHaveProperty('isSaved');
    expect(block).not.toHaveProperty('approvalStatus');
  });
});

describe('weekly planning preview block properties', () => {
  it('preserves candidate order and stable identity across preview, display, and draft handoff', () => {
    fc.assert(fc.property(candidateArrayArbitrary, (candidates) => {
      const original = structuredClone(candidates);
      const previewBlocks = createWeeklyPlanningPreviewBlocks(candidates);
      const draftBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
        candidates,
        userId: 'user-1',
        createdAt: CREATED_AT,
      });

      expect(previewBlocks.map((block) => block.id)).toEqual(
        candidates.map((item) => item.stableKey),
      );
      expect(draftBlocks.map((block) => block.id)).toEqual(
        candidates.map((item) => item.stableKey),
      );
      previewBlocks.forEach((block, index) => {
        expect(block).toMatchObject({
          id: candidates[index].stableKey,
          stableKey: candidates[index].stableKey,
          status: 'preview',
          isSaved: false,
          source: 'weekly_exam_prep',
        });
        expect(createWeeklyPlanningPreviewDisplayBlock(block, 'user-1').id).toBe(
          draftBlocks[index].id,
        );
      });
      expect(candidates).toEqual(original);
    }), { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS });
  });

  it('removes only the matching stable ID and repeated or unknown removal is stable', () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.integer({ min: 2000, max: 2030 }), {
        minLength: 1,
        maxLength: 8,
      }),
      fc.nat(),
      (years, rawIndex) => {
        const candidates = years.map((year, index) => candidate(year, index));
        const previewBlocks = createWeeklyPlanningPreviewBlocks(candidates);
        const originalCandidates = structuredClone(candidates);
        const originalPreview = structuredClone(previewBlocks);
        const target = candidates[rawIndex % candidates.length];
        const result = removeWeeklyPlanningPreviewBlock({
          previewBlocks,
          candidates,
          blockId: target.stableKey,
        });
        const repeated = removeWeeklyPlanningPreviewBlock({
          ...result,
          blockId: target.stableKey,
        });
        const unknown = removeWeeklyPlanningPreviewBlock({
          ...result,
          blockId: 'unknown-id',
        });
        const expectedIds = candidates
          .filter((item) => item.stableKey !== target.stableKey)
          .map((item) => item.stableKey);

        expect(result.previewBlocks.map((block) => block.id)).toEqual(expectedIds);
        expect(result.candidates.map((item) => item.stableKey)).toEqual(expectedIds);
        expect(repeated).toEqual(result);
        expect(unknown).toEqual(result);
        expect(candidates).toEqual(originalCandidates);
        expect(previewBlocks).toEqual(originalPreview);
      },
    ), { seed: PROPERTY_SEED + 1, numRuns: PROPERTY_RUNS });
  });
});
