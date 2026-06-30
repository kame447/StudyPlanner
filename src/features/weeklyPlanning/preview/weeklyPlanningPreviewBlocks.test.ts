import { describe, expect, it } from 'vitest';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import { createWeeklyPlanningPreviewBlocks } from './weeklyPlanningPreviewBlocks';

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

  it('keeps preview blocks distinguishable from saved plans and approved drafts', () => {
    const [block] = createWeeklyPlanningPreviewBlocks([candidate]);

    expect(block?.isSaved).toBe(false);
    expect(block?.status).toBe('preview');
    expect(block?.source).toBe('weekly_exam_prep');
  });
});