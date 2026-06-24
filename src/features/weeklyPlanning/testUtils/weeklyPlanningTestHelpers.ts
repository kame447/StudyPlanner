import { expect } from 'vitest';
import type { Plan, PlanDraft } from '../../../types/domain';
import type { WeeklyPlanDraftBlock } from '../types';
import type {
  AvailabilityAwareWeeklyDraftResult,
  WeeklyPlanningDefaultConditions,
} from '../weeklyPlanningTypes';

export type WeeklyDraftBlock = WeeklyPlanDraftBlock;

export function planDraft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    userId: 'user-1',
    title: '英語課題',
    subject: '英語',
    date: '2026-06-22',
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: 'unit 3',
    sourceType: 'manual',
    sourceId: null,
    materialId: 'material-1',
    materialName: '英語ワーク',
    ...overrides,
  };
}

export function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: '大学',
    subject: '大学',
    date: '2026-06-26',
    startTime: '10:00',
    endTime: '11:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'school-event',
    memo: '',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    sourceType: 'manual',
    sourceId: null,
    ...overrides,
  };
}

export function minutesBetween(startTime: string, endTime: string): number {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
}

export function minutesFromClock(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function totalDraftMinutes(blocks: WeeklyDraftBlock[]): number {
  return blocks.reduce((sum, block) => sum + minutesBetween(block.startTime, block.endTime), 0);
}

export const sumDraftMinutes = totalDraftMinutes;

export function sumUnplacedMinutes(result: Pick<AvailabilityAwareWeeklyDraftResult, 'unplacedMinutes'>): number {
  return result.unplacedMinutes;
}

export function totalsByTitle(blocks: WeeklyDraftBlock[]): Record<string, number> {
  return blocks.reduce<Record<string, number>>((totals, block) => {
    totals[block.title] = (totals[block.title] ?? 0) + minutesBetween(block.startTime, block.endTime);
    return totals;
  }, {});
}

export function blocksGroupedByDate(blocks: WeeklyDraftBlock[]): Record<string, WeeklyDraftBlock[]> {
  return blocks.reduce<Record<string, WeeklyDraftBlock[]>>((groups, block) => {
    groups[block.date] = [...(groups[block.date] ?? []), block];
    return groups;
  }, {});
}

export const groupBlocksByDate = blocksGroupedByDate;

export function sortBlocksByStartTime(blocks: WeeklyDraftBlock[]): WeeklyDraftBlock[] {
  return blocks.slice().sort((left, right) => minutesFromClock(left.startTime) - minutesFromClock(right.startTime));
}

export function sortBlocksByDateTime(blocks: WeeklyDraftBlock[]): WeeklyDraftBlock[] {
  return blocks.slice().sort((left, right) => {
    const dateOrder = left.date.localeCompare(right.date);
    if (dateOrder !== 0) return dateOrder;
    return minutesFromClock(left.startTime) - minutesFromClock(right.startTime);
  });
}

export function countSubjectSwitches(blocks: WeeklyDraftBlock[]): number {
  const sortedBlocks = sortBlocksByStartTime(blocks);
  return sortedBlocks.reduce((switches, block, index) => {
    if (index === 0) return switches;
    return sortedBlocks[index - 1].title === block.title ? switches : switches + 1;
  }, 0);
}

export function countSameDaySubjectFragmentations(blocks: WeeklyDraftBlock[]): number {
  const runsByTitle = new Map<string, number>();
  let previousTitle: string | undefined;
  sortBlocksByStartTime(blocks).forEach((block) => {
    if (block.title !== previousTitle) runsByTitle.set(block.title, (runsByTitle.get(block.title) ?? 0) + 1);
    previousTitle = block.title;
  });
  return Array.from(runsByTitle.values()).reduce((total, runs) => total + Math.max(0, runs - 1), 0);
}

export function maxRunsForSameTitleInDay(blocks: WeeklyDraftBlock[]): number {
  const runsByTitle = new Map<string, number>();
  let previousTitle: string | undefined;
  sortBlocksByStartTime(blocks).forEach((block) => {
    if (block.title !== previousTitle) runsByTitle.set(block.title, (runsByTitle.get(block.title) ?? 0) + 1);
    previousTitle = block.title;
  });
  return Math.max(0, ...Array.from(runsByTitle.values()));
}

export function hasSameTitleReentry(blocks: WeeklyDraftBlock[]): boolean {
  return maxRunsForSameTitleInDay(blocks) > 1;
}

export function hasSameSubjectReentry(blocks: WeeklyDraftBlock[]): boolean {
  const runsBySubject = new Map<string, number>();
  let previousSubject: string | undefined;
  sortBlocksByStartTime(blocks).forEach((block) => {
    const subject = block.subject || block.title;
    if (subject !== previousSubject) runsBySubject.set(subject, (runsBySubject.get(subject) ?? 0) + 1);
    previousSubject = subject;
  });
  return Array.from(runsBySubject.values()).some((runs) => runs > 1);
}

export function averageStartMinutesByDateForTitle(blocks: WeeklyDraftBlock[], title: string): number[] {
  return Object.values(blocksGroupedByDate(blocks))
    .map((dateBlocks) => dateBlocks.filter((block) => block.title === title))
    .filter((dateBlocks) => dateBlocks.length > 0)
    .map((dateBlocks) => dateBlocks.reduce((sum, block) => sum + minutesFromClock(block.startTime), 0) / dateBlocks.length);
}

export function lateMinutesForTitles(blocks: WeeklyDraftBlock[], titlePattern: RegExp): number {
  return blocks.filter((block) => titlePattern.test(block.title)).reduce((total, block) => {
    const startMinutes = minutesFromClock(block.startTime);
    const endMinutes = minutesFromClock(block.endTime);
    return total + Math.max(0, endMinutes - Math.max(startMinutes, 22 * 60));
  }, 0);
}

export function hasOverlap(left: { startMinutes: number; endMinutes: number }, right: { startMinutes: number; endMinutes: number }): boolean {
  return Math.max(left.startMinutes, right.startMinutes) < Math.min(left.endMinutes, right.endMinutes);
}

export function hasOverlapWithExistingPlans(
  blocks: WeeklyDraftBlock[],
  existingPlans: Array<Pick<Plan, 'date' | 'startTime' | 'endTime'>>,
  bufferMinutes: number,
): boolean {
  return blocks.some((block) => {
    const blockInterval = { startMinutes: minutesFromClock(block.startTime), endMinutes: minutesFromClock(block.endTime) };
    return existingPlans.some((existingPlan) => existingPlan.date === block.date && hasOverlap(blockInterval, {
      startMinutes: minutesFromClock(existingPlan.startTime) - bufferMinutes,
      endMinutes: minutesFromClock(existingPlan.endTime) + bufferMinutes,
    }));
  });
}

export function hasOverlapWithUnavailableRanges(
  blocks: WeeklyDraftBlock[],
  unavailableRanges: WeeklyPlanningDefaultConditions['unavailableRanges'],
): boolean {
  return blocks.some((block) => {
    const blockInterval = { startMinutes: minutesFromClock(block.startTime), endMinutes: minutesFromClock(block.endTime) };
    return unavailableRanges.some((range) => hasOverlap(blockInterval, {
      startMinutes: minutesFromClock(range.startTime),
      endMinutes: minutesFromClock(range.endTime),
    }));
  });
}

export function findUnexplainedSameTitleGaps(
  blocks: WeeklyDraftBlock[],
  context: { breakMinutes: number; unavailableRanges?: WeeklyPlanningDefaultConditions['unavailableRanges'] },
): Array<{ date: string; title: string; gapMinutes: number }> {
  return Object.entries(blocksGroupedByDate(blocks)).flatMap(([date, dateBlocks]) => {
    const byTitle = dateBlocks.reduce<Record<string, WeeklyDraftBlock[]>>((groups, block) => {
      groups[block.title] = [...(groups[block.title] ?? []), block];
      return groups;
    }, {});
    return Object.entries(byTitle).flatMap(([title, titleBlocks]) => {
      const sortedBlocks = sortBlocksByStartTime(titleBlocks);
      return sortedBlocks.flatMap((block, index) => {
        if (index === 0) return [];
        const previous = sortedBlocks[index - 1];
        const gapStart = minutesFromClock(previous.endTime);
        const gapEnd = minutesFromClock(block.startTime);
        const gapMinutes = gapEnd - gapStart;
        if (gapMinutes <= context.breakMinutes) return [];
        const explainedByUnavailable = (context.unavailableRanges ?? []).some((range) => hasOverlap(
          { startMinutes: gapStart, endMinutes: gapEnd },
          { startMinutes: minutesFromClock(range.startTime), endMinutes: minutesFromClock(range.endTime) },
        ));
        return explainedByUnavailable ? [] : [{ date, title, gapMinutes }];
      });
    });
  });
}

export function expectTotalMinutesPreserved(result: Pick<AvailabilityAwareWeeklyDraftResult, 'placedMinutes' | 'unplacedMinutes' | 'blocks'>, requestedMinutes: number): void {
  expect(result.placedMinutes + result.unplacedMinutes).toBe(requestedMinutes);
  expect(totalDraftMinutes(result.blocks)).toBe(result.placedMinutes);
}

export function expectNoInvalidBlocks(blocks: WeeklyDraftBlock[]): void {
  blocks.forEach((block) => {
    const duration = minutesBetween(block.startTime, block.endTime);
    expect(duration).toBeGreaterThan(0);
    expect(Number.isFinite(duration)).toBe(true);
  });
}

export function expectNoSameDayTitleReentry(blocks: WeeklyDraftBlock[]): void {
  Object.values(blocksGroupedByDate(blocks)).forEach((dateBlocks) => {
    expect(hasSameTitleReentry(dateBlocks)).toBe(false);
  });
}

export function expectNoUnavailableOverlaps(blocks: WeeklyDraftBlock[], context: { unavailableRanges: WeeklyPlanningDefaultConditions['unavailableRanges'] }): void {
  expect(hasOverlapWithUnavailableRanges(blocks, context.unavailableRanges)).toBe(false);
}

export function expectBlocksSortedByDateAndStartTime(blocks: WeeklyDraftBlock[]): void {
  const seenDates = new Set<string>();
  let previousDate = '';
  let previousStartMinutes = -1;
  blocks.forEach((block) => {
    if (previousDate && block.date !== previousDate) {
      seenDates.add(previousDate);
      expect(seenDates.has(block.date)).toBe(false);
    }
    expect(block.date.localeCompare(previousDate)).toBeGreaterThanOrEqual(0);
    if (block.date === previousDate) {
      expect(minutesFromClock(block.startTime)).toBeGreaterThanOrEqual(previousStartMinutes);
    }
    previousDate = block.date;
    previousStartMinutes = minutesFromClock(block.startTime);
  });
}
