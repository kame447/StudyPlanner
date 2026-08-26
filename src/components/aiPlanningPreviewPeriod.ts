import type { WeeklyDraftCandidate } from '../features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { addDays, minutesBetween, sortByDateTime } from '../lib/date';

export interface AiPlanningPreviewDateRange {
  startDate: string;
  endDate: string;
}

export interface AiPlanningPreviewSummary {
  count: number;
  totalMinutes: number;
  dateRange: AiPlanningPreviewDateRange | null;
}

export function normalizeAiPlanningPreviewBlocks(
  blocks: readonly WeeklyPlanDraftBlock[],
): WeeklyPlanDraftBlock[] {
  const uniqueById = new Map<string, WeeklyPlanDraftBlock>();

  for (const block of blocks) {
    uniqueById.set(block.id, block);
  }

  return sortByDateTime(Array.from(uniqueById.values()));
}

export function getAiPlanningPreviewDateRange(
  blocks: readonly WeeklyPlanDraftBlock[],
): AiPlanningPreviewDateRange | null {
  const normalized = normalizeAiPlanningPreviewBlocks(blocks);
  const first = normalized[0];
  const last = normalized[normalized.length - 1];

  if (!first || !last) return null;

  return {
    startDate: first.date,
    endDate: last.date,
  };
}

export function buildAiPlanningPreviewSummary(
  blocks: readonly WeeklyPlanDraftBlock[],
): AiPlanningPreviewSummary {
  const normalized = normalizeAiPlanningPreviewBlocks(blocks);

  return {
    count: normalized.length,
    totalMinutes: normalized.reduce(
      (sum, block) => sum + minutesBetween(block.startTime, block.endTime),
      0,
    ),
    dateRange: getAiPlanningPreviewDateRange(normalized),
  };
}

export function buildAiPlanningPreviewDatePages(
  blocks: readonly WeeklyPlanDraftBlock[],
  daysPerPage = 7,
): string[][] {
  if (!Number.isInteger(daysPerPage) || daysPerPage <= 0) {
    throw new Error('daysPerPage must be a positive integer');
  }

  const range = getAiPlanningPreviewDateRange(blocks);
  if (!range) return [];

  const pages: string[][] = [];
  let pageStart = range.startDate;

  while (pageStart <= range.endDate) {
    const page: string[] = [];

    for (let offset = 0; offset < daysPerPage; offset += 1) {
      const date = addDays(pageStart, offset);
      if (date > range.endDate) break;
      page.push(date);
    }

    pages.push(page);
    pageStart = addDays(pageStart, daysPerPage);
  }

  return pages;
}

export function selectAiPlanningPreviewCandidates(
  candidates: readonly WeeklyDraftCandidate[],
  blocks: readonly WeeklyPlanDraftBlock[],
): WeeklyDraftCandidate[] {
  const blockIds = new Set(blocks.map((block) => block.id));
  return candidates.filter((candidate) => blockIds.has(candidate.stableKey));
}

export function clampAiPlanningPreviewPageIndex(
  pageIndex: number,
  pageCount: number,
): number {
  if (pageCount <= 0) return 0;
  return Math.min(Math.max(pageIndex, 0), pageCount - 1);
}
