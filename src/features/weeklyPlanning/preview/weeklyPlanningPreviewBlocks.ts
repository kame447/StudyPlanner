import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';

export interface WeeklyPlanningPreviewBlock {
  id: string;
  stableKey: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  title: string;
  field: string;
  year: number;
  estimatedMinutes: number;
  source: 'weekly_exam_prep';
  status: 'preview';
  isSaved: false;
  workItemKey: string;
}

export function createWeeklyPlanningPreviewBlocks(
  draftCandidates: WeeklyDraftCandidate[],
): WeeklyPlanningPreviewBlock[] {
  return draftCandidates.map((candidate) => ({
    id: candidate.stableKey,
    stableKey: candidate.stableKey,
    date: candidate.date,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    durationMinutes: candidate.durationMinutes,
    title: candidate.title,
    field: candidate.field,
    year: candidate.year,
    estimatedMinutes: candidate.estimatedMinutes,
    source: candidate.source,
    status: 'preview',
    isSaved: false,
    workItemKey: candidate.workItemKey,
  }));
}