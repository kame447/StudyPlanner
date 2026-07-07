import type { WeeklyPlanDraftBlock } from '../types';
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

export interface RemoveWeeklyPlanningPreviewBlockInput {
  previewBlocks: WeeklyPlanningPreviewBlock[];
  candidates: WeeklyDraftCandidate[];
  blockId: string;
}

export function removeWeeklyPlanningPreviewBlock({
  previewBlocks,
  candidates,
  blockId,
}: RemoveWeeklyPlanningPreviewBlockInput): {
  previewBlocks: WeeklyPlanningPreviewBlock[];
  candidates: WeeklyDraftCandidate[];
} {
  return {
    previewBlocks: previewBlocks.filter((block) => block.id !== blockId),
    candidates: candidates.filter((candidate) => candidate.stableKey !== blockId),
  };
}

export function createWeeklyPlanningPreviewDisplayBlock(
  block: WeeklyPlanningPreviewBlock,
  userId: string,
): WeeklyPlanDraftBlock {
  const deterministicTimestamp = `${block.date}T${block.startTime}:00`;

  return {
    id: block.id,
    userId,
    date: block.date,
    startTime: block.startTime,
    endTime: block.endTime,
    title: block.title,
    subject: block.field,
    type: 'study',
    label: block.field,
    materialId: null,
    memo: `unsaved-preview: ${block.workItemKey}`,
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: deterministicTimestamp,
    updatedAt: deterministicTimestamp,
  };
}

export interface CreateWeeklyDraftBlocksFromPreviewCandidatesInput {
  candidates: WeeklyDraftCandidate[];
  userId: string;
  createdAt: string;
}

export function createWeeklyDraftBlocksFromPreviewCandidates({
  candidates,
  userId,
  createdAt,
}: CreateWeeklyDraftBlocksFromPreviewCandidatesInput): WeeklyPlanDraftBlock[] {
  return candidates.map((candidate) => ({
    id: candidate.stableKey,
    userId,
    date: candidate.date,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    title: candidate.title,
    subject: candidate.field,
    type: 'study',
    label: candidate.field,
    materialId: null,
    materialName: '',
    memo: [
      `year: ${candidate.year}`,
      `estimatedMinutes: ${candidate.estimatedMinutes}`,
      `workItemKey: ${candidate.workItemKey}`,
      'source: dry-run preview',
    ].join(' / '),
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt,
    updatedAt: createdAt,
  }));
}
