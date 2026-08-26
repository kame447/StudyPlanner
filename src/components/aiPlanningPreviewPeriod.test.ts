import { describe, expect, it } from 'vitest';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { addDays } from '../lib/date';
import {
  buildAiPlanningPreviewDatePages,
  clampAiPlanningPreviewPageIndex,
  getAiPlanningPreviewDateRange,
  normalizeAiPlanningPreviewBlocks,
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

function dailyBlocks(startDate: string, dayCount: number): WeeklyPlanDraftBlock[] {
  return Array.from({ length: dayCount }, (_, index) =>
    block(`daily-${index + 1}`, addDays(startDate, index)),
  );
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

  it('paginates a 30-day plan into four full weeks and two remaining days', () => {
    const pages = buildAiPlanningPreviewDatePages(dailyBlocks('2026-08-01', 30));

    expect(pages.map((page) => page.length)).toEqual([7, 7, 7, 7, 2]);
    expect(pages[0]?.[0]).toBe('2026-08-01');
    expect(pages[4]).toEqual(['2026-08-29', '2026-08-30']);
    expect(pages.flat()).toHaveLength(30);
  });

  it('paginates a 31-day plan into four full weeks and three remaining days', () => {
    const pages = buildAiPlanningPreviewDatePages(dailyBlocks('2026-08-01', 31));

    expect(pages.map((page) => page.length)).toEqual([7, 7, 7, 7, 3]);
    expect(pages[4]).toEqual(['2026-08-29', '2026-08-30', '2026-08-31']);
    expect(pages.flat()).toHaveLength(31);
  });

  it('keeps a 31-day month-crossing plan continuous while paging every seven days', () => {
    const blocks = dailyBlocks('2026-08-27', 31);
    const pages = buildAiPlanningPreviewDatePages(blocks);

    expect(getAiPlanningPreviewDateRange(blocks)).toEqual({
      startDate: '2026-08-27',
      endDate: '2026-09-26',
    });
    expect(pages.map((page) => page.length)).toEqual([7, 7, 7, 7, 3]);
    expect(pages[0]).toEqual([
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
    expect(pages[4]).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
    expect(pages.flat().map((date, index) => date === addDays('2026-08-27', index)))
      .not.toContain(false);
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
