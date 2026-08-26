import { describe, expect, it } from 'vitest';
import type { WeeklyDraftCandidate } from '../features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import {
  buildAiPlanningPreviewDatePages,
  buildAiPlanningPreviewSummary,
  clampAiPlanningPreviewPageIndex,
  getAiPlanningPreviewDateRange,
  normalizeAiPlanningPreviewBlocks,
  selectAiPlanningPreviewCandidates,
} from './aiPlanningPreviewPeriod';

function block(id: string, date: string): WeeklyPlanDraftBlock {
  return {
    id,
    userId: 'user-1',
    date,
    startTime: '19:00',
    endTime: '20:00',
    title: '金フレ',
    subject: 'TOEIC',
    type: 'study',
    label: '金フレ',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  };
}

function candidate(id: string, date: string): WeeklyDraftCandidate {
  return {
    stableKey: id,
    date,
    startTime: '19:00',
    endTime: '20:00',
    durationMinutes: 60,
    title: '金フレ',
    field: 'TOEIC',
    year: 1,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: 'gold-phrase',
  };
}

const GOLD_PHRASE_DATES = [
  '2026-08-27',
  '2026-08-28',
  '2026-08-29',
  '2026-08-30',
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
  '2026-09-05',
  '2026-09-06',
  '2026-09-07',
] as const;

describe('aiPlanningPreviewPeriod', () => {
  it('keeps the full 12-day plan instead of truncating it to the current week', () => {
    const blocks = GOLD_PHRASE_DATES.map((date, index) =>
      block(`gold-${index + 1}`, date),
    );

    const normalized = normalizeAiPlanningPreviewBlocks([
      blocks[7]!,
      ...blocks,
      blocks[0]!,
    ]);

    expect(normalized).toHaveLength(12);
    expect(normalized.map((item) => item.date)).toEqual(GOLD_PHRASE_DATES);
    expect(getAiPlanningPreviewDateRange(normalized)).toEqual({
      startDate: '2026-08-27',
      endDate: '2026-09-07',
    });
  });

  it('summarizes the exact 金フレ plan as 12 sessions and 12 hours across the full period', () => {
    const blocks = GOLD_PHRASE_DATES.map((date, index) =>
      block(`gold-${index + 1}`, date),
    );

    expect(buildAiPlanningPreviewSummary(blocks)).toEqual({
      count: 12,
      totalMinutes: 720,
      dateRange: {
        startDate: '2026-08-27',
        endDate: '2026-09-07',
      },
    });
  });

  it('paginates a 12-day plan into seven days and the remaining five days', () => {
    const blocks = GOLD_PHRASE_DATES.map((date, index) =>
      block(`gold-${index + 1}`, date),
    );

    expect(buildAiPlanningPreviewDatePages(blocks)).toEqual([
      [
        '2026-08-27',
        '2026-08-28',
        '2026-08-29',
        '2026-08-30',
        '2026-08-31',
        '2026-09-01',
        '2026-09-02',
      ],
      [
        '2026-09-03',
        '2026-09-04',
        '2026-09-05',
        '2026-09-06',
        '2026-09-07',
      ],
    ]);
  });

  it('keeps every full-period candidate when the preview is promoted', () => {
    const blocks = GOLD_PHRASE_DATES.map((date, index) =>
      block(`gold-${index + 1}`, date),
    );
    const candidates = GOLD_PHRASE_DATES.map((date, index) =>
      candidate(`gold-${index + 1}`, date),
    );

    expect(selectAiPlanningPreviewCandidates(candidates, blocks)).toHaveLength(12);
    expect(
      selectAiPlanningPreviewCandidates(candidates, blocks).map((item) => item.date),
    ).toEqual(GOLD_PHRASE_DATES);
  });

  it('includes empty calendar days inside the plan range so each page stays chronological', () => {
    const blocks = [
      block('first', '2026-08-27'),
      block('last', '2026-09-03'),
    ];

    expect(buildAiPlanningPreviewDatePages(blocks)).toEqual([
      [
        '2026-08-27',
        '2026-08-28',
        '2026-08-29',
        '2026-08-30',
        '2026-08-31',
        '2026-09-01',
        '2026-09-02',
      ],
      ['2026-09-03'],
    ]);
  });

  it('clamps stale page state after a plan is regenerated with fewer pages', () => {
    expect(clampAiPlanningPreviewPageIndex(3, 2)).toBe(1);
    expect(clampAiPlanningPreviewPageIndex(-1, 2)).toBe(0);
    expect(clampAiPlanningPreviewPageIndex(1, 0)).toBe(0);
  });
});
