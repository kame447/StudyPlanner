import type {
  WeeklyPlanDraftBlock,
  WeeklyPlanningBehaviorMetadata,
} from '../types';
import type { BehaviorAwarePreviewMetadata } from '../planning/weeklyPlanningBehaviorAwarePreviewBridge';
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
  behaviorMetadata?: WeeklyPlanningBehaviorMetadata;
}

function acceptedDependencies(metadata: BehaviorAwarePreviewMetadata) {
  return metadata.acceptedAssumptionDependencies?.map((dependency) => ({ ...dependency }))
    ?? metadata.usedAssumptionProposalRefs.map((proposalId) => ({
      proposalId,
      targetRef: metadata.taskRef,
      proposalCreatedFromStateRevision: metadata.stateRevision,
    }));
}

function behaviorMetadataFromCandidate(
  candidate: WeeklyDraftCandidate,
  userId?: string,
): WeeklyPlanningBehaviorMetadata | undefined {
  const metadata = (candidate as WeeklyDraftCandidate & {
    behaviorMetadata?: BehaviorAwarePreviewMetadata;
  }).behaviorMetadata;
  if (!metadata) return undefined;
  const dependencies = acceptedDependencies(metadata);
  const previewMetadata = userId
    ? {
        previewId: `behavior-preview:${metadata.stateRevision}`,
        stateRevision: metadata.stateRevision,
        assumptionDependencies: dependencies,
        approvalEligibility: 'eligible' as const,
        stale: false,
        authorizedUserId: userId,
      }
    : undefined;

  return {
    stateRevision: metadata.stateRevision,
    sourceFactRefs: [...metadata.sourceFactRefs],
    usedAssumptionProposalRefs: [...metadata.usedAssumptionProposalRefs],
    ...(dependencies.length > 0 ? { acceptedAssumptionDependencies: dependencies } : {}),
    taskRef: metadata.taskRef,
    opportunityTags: [...metadata.opportunityTags],
    reasoningKey: metadata.reasoningKey,
    compatibility: {
      workItemSemantic: 'behavior_aware_task',
      schedulerInputSource: 'exam_prep_request',
      candidateSource: 'weekly_exam_prep',
    },
    ...(previewMetadata ? { previewMetadata } : {}),
  };
}

export function createWeeklyPlanningPreviewBlocks(
  draftCandidates: WeeklyDraftCandidate[],
): WeeklyPlanningPreviewBlock[] {
  return draftCandidates.map((candidate) => {
    const behaviorMetadata = behaviorMetadataFromCandidate(candidate);
    return {
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
      ...(behaviorMetadata ? { behaviorMetadata } : {}),
    };
  });
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
  const behaviorMetadata = block.behaviorMetadata
    ? {
        ...block.behaviorMetadata,
        previewMetadata: {
          previewId: `behavior-preview:${block.behaviorMetadata.stateRevision}`,
          stateRevision: block.behaviorMetadata.stateRevision,
          assumptionDependencies: block.behaviorMetadata.acceptedAssumptionDependencies?.map((dependency) => ({ ...dependency }))
            ?? block.behaviorMetadata.usedAssumptionProposalRefs.map((proposalId) => ({
              proposalId,
              targetRef: block.behaviorMetadata?.taskRef ?? '',
              proposalCreatedFromStateRevision: block.behaviorMetadata?.stateRevision ?? 0,
            })),
          approvalEligibility: 'eligible' as const,
          stale: false,
          authorizedUserId: userId,
        },
      }
    : undefined;

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
    ...(behaviorMetadata ? { behaviorMetadata } : {}),
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
  return candidates.map((candidate) => {
    const behaviorMetadata = behaviorMetadataFromCandidate(candidate, userId);
    return {
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
      ...(behaviorMetadata ? { behaviorMetadata } : {}),
      createdAt,
      updatedAt: createdAt,
    };
  });
}
