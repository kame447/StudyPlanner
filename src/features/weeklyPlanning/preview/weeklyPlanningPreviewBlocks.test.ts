import { describe, expect, it } from 'vitest';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  removeWeeklyPlanningPreviewBlock,
} from './weeklyPlanningPreviewBlocks';

const candidate: WeeklyDraftCandidate = {
  stableKey: 'candidate:math:2020:2026-06-27:09:00',
  date: '2026-06-27',
  startTime: '09:00',
  endTime: '11:00',
  durationMinutes: 120,
  title: '数学・数理系 2020年度',
  field: '数学・数理系',
  year: 2020,
  estimatedMinutes: 120,
  source: 'weekly_exam_prep',
  approvalStatus: 'unapproved',
  workItemKey: '数学・数理系:2020',
};

describe('weekly planning preview blocks', () => {
  it('creates unsaved preview blocks from dry-run candidates', () => {
    const blocks = createWeeklyPlanningPreviewBlocks([candidate]);

    expect(blocks).toEqual([
      {
        id: candidate.stableKey,
        stableKey: candidate.stableKey,
        date: '2026-06-27',
        startTime: '09:00',
        endTime: '11:00',
        durationMinutes: 120,
        title: '数学・数理系 2020年度',
        field: '数学・数理系',
        year: 2020,
        estimatedMinutes: 120,
        source: 'weekly_exam_prep',
        status: 'preview',
        isSaved: false,
        workItemKey: '数学・数理系:2020',
      },
    ]);
  });

  it('promotes dry-run candidates to existing unapproved weekly draft blocks', () => {
    const [block] = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: [candidate],
      userId: 'user-1',
      createdAt: '2026-06-30T00:00:00.000Z',
    });

    expect(block).toMatchObject({
      id: candidate.stableKey,
      userId: 'user-1',
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      title: candidate.title,
      subject: candidate.field,
      type: 'study',
      label: candidate.field,
      materialId: null,
      materialName: '',
      source: 'ai',
      status: 'draft',
      userEdited: false,
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
    });
    expect(block?.memo).toContain('year: 2020');
    expect(block?.memo).toContain('estimatedMinutes: 120');
    expect(block?.memo).toContain(`workItemKey: ${candidate.workItemKey}`);
    expect(block?.memo).toContain('dry-run preview');
    expect(block).not.toHaveProperty('isSaved');
    expect(block).not.toHaveProperty('approvalStatus');
  });


  it('keeps the same block id when promoting preview blocks to drafts', () => {
    const [previewBlock] = createWeeklyPlanningPreviewBlocks([candidate]);
    const [draftBlock] = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: [candidate],
      userId: 'user-1',
      createdAt: '2026-06-30T00:00:00.000Z',
    });

    expect(draftBlock?.id).toBe(previewBlock?.id);
  });

  it('removes a local preview block and matching candidate by block id', () => {
    const secondCandidate: WeeklyDraftCandidate = {
      ...candidate,
      stableKey: 'candidate:math:2019:2026-06-27:11:00',
      year: 2019,
      title: '数学・数理系 2019年度',
      workItemKey: '数学・数理系:2019',
    };
    const previewBlocks = createWeeklyPlanningPreviewBlocks([candidate, secondCandidate]);
    const result = removeWeeklyPlanningPreviewBlock({
      previewBlocks,
      candidates: [candidate, secondCandidate],
      blockId: candidate.stableKey,
    });

    expect(result.previewBlocks.map((block) => block.id)).toEqual([
      secondCandidate.stableKey,
    ]);
    expect(result.candidates.map((item) => item.stableKey)).toEqual([
      secondCandidate.stableKey,
    ]);
  });

  it('returns an empty draft block list for empty candidates', () => {
    expect(createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: [],
      userId: 'user-1',
      createdAt: '2026-06-30T00:00:00.000Z',
    })).toEqual([]);
  });

  it('keeps preview blocks distinguishable from saved plans and approved drafts', () => {
    const [block] = createWeeklyPlanningPreviewBlocks([candidate]);

    expect(block?.isSaved).toBe(false);
    expect(block?.status).toBe('preview');
    expect(block?.source).toBe('weekly_exam_prep');
  });
});