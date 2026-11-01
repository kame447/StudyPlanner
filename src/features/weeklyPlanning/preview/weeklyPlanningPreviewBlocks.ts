import type { WeeklyPlanDraftBlock } from '../types';
import { recordWeeklyPlanningDraftPromotion } from '../trace/weeklyPlanningTraceRuntime';
import { buildWeeklyDraftBlocksFromPreviewCandidates,
  type CreateWeeklyDraftBlocksFromPreviewCandidatesInput } from './weeklyPlanningPreviewBlocksCore';

export * from './weeklyPlanningPreviewBlocksCore';
export type { CreateWeeklyDraftBlocksFromPreviewCandidatesInput };

export function createWeeklyDraftBlocksFromPreviewCandidates(input: CreateWeeklyDraftBlocksFromPreviewCandidatesInput): WeeklyPlanDraftBlock[] {
  const blocks = buildWeeklyDraftBlocksFromPreviewCandidates(input);
  recordWeeklyPlanningDraftPromotion({ userId: input.userId, blocks });
  return blocks;
}
