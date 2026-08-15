import type { PlanType } from '../../../types/domain';
import type {
  WeeklyPlanDraftBlock,
  WeeklyPlanningBehaviorMetadata,
} from '../types';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import { recordWeeklyPlanningDraftPromotion } from '../trace/weeklyPlanningTraceRuntime';
import type { WeeklyPlanningStableV5PreviewProvenance } from '../weeklyPlanningPreviewProvenance';
import type { BehaviorAwarePreviewMetadata } from './weeklyPlanningPreviewCompatibility';

export type WeeklyPlanningStableV5PreviewMetadata =
  WeeklyPlanningStableV5PreviewProvenance;

type RuntimeStableV5PreviewMetadata = Omit<
  WeeklyPlanningStableV5PreviewMetadata,
  'conversationId'
> & {
  conversationId?: string;
};

type WeeklyDraftCandidateWithRuntimeMetadata = WeeklyDraftCandidate & {
  stableV5Metadata?: RuntimeStableV5PreviewMetadata;
};

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
  planType?: PlanType;
  stableV5Metadata?: WeeklyPlanningStableV5PreviewMetadata;
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

function stableV5MetadataFromCandidate(
  candidate: WeeklyDraftCandidate,
): WeeklyPlanningStableV5PreviewMetadata | undefined {
  const metadata = (candidate as WeeklyDraftCandidateWithRuntimeMetadata).stableV5Metadata;
  if (!metadata || metadata.runtime !== 'stable_v5') return undefined;
  return {
    ...metadata,
    conversationId: metadata.conversationId?.trim() ?? '',
    sourceFactRefs: [...metadata.sourceFactRefs],
    ...(metadata.weeklyPlanningObservationSource
      ? {
          weeklyPlanningObservationSource: {
            ...metadata.weeklyPlanningObservationSource,
          },
        }
      : {}),
  };
}

function behaviorMetadataFromCandidate(
  candidate: WeeklyDraftCandidate,
  userId?: string,
): WeeklyPlanningBehaviorMetadata | undefined {
  const stableV5Metadata = stableV5MetadataFromCandidate(candidate);
  if (stableV5Metadata) {
    const conversationId = stableV5Metadata.conversationId;
    return {
      conversationId,
      stateRevision: stableV5Metadata.graphRevision,
      sourceFactRefs: [...stableV5Metadata.sourceFactRefs],
      usedAssumptionProposalRefs: [],
      taskRef: stableV5Metadata.taskId,
      opportunityTags: [],
      reasoningKey: 'stable-v5-explicit-duration',
      compatibility: {
        workItemSemantic: 'generic_semantic_task',
        schedulerInputSource: 'stable_v5_generic_scheduler_input',
        candidateSource: 'stable_v5',
      },
      ...(stableV5Metadata.weeklyPlanningObservationSource
        ? {
            weeklyPlanningObservationSource: {
              ...stableV5Metadata.weeklyPlanningObservationSource,
            },
          }
        : {}),
      ...(userId
        ? {
            previewMetadata: {
              previewId: `stable-v5-preview:${conversationId}:${stableV5Metadata.graphRevision}`,
              conversationId,
              stateRevision: stableV5Metadata.graphRevision,
              assumptionDependencies: [],
              approvalEligibility: 'eligible' as const,
              stale: false,
              authorizedUserId: userId,
            },
          }
        : {}),
    };
  }

  const metadata = (candidate as WeeklyDraftCandidate & {
    behaviorMetadata?: BehaviorAwarePreviewMetadata;
  }).behaviorMetadata;
  if (!metadata) return undefined;
  const dependencies = acceptedDependencies(metadata);
  const previewMetadata = userId
    ? {
        previewId: metadata.conversationId
          ? `behavior-preview:${metadata.conversationId}:${metadata.stateRevision}`
          : `behavior-preview:${metadata.stateRevision}`,
        ...(metadata.conversationId ? { conversationId: metadata.conversationId } : {}),
        stateRevision: metadata.stateRevision,
        assumptionDependencies: dependencies,
        approvalEligibility: 'eligible' as const,
        stale: false,
        authorizedUserId: userId,
      }
    : undefined;

  return {
    ...(metadata.conversationId ? { conversationId: metadata.conversationId } : {}),
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
    const stableV5Metadata = stableV5MetadataFromCandidate(candidate);
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
      ...(stableV5Metadata
        ? { planType: stableV5Metadata.planType, stableV5Metadata }
        : {}),
      ...(behaviorMetadata ? { behaviorMetadata }
        : {}),
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

function stableV5Memo(block: WeeklyPlanningPreviewBlock): string {
  if (!block.stableV5Metadata) return `unsaved-preview: ${block.workItemKey}`;
  return [
    'Stable V5 preview',
    `graphRevision: ${block.stableV5Metadata.graphRevision}`,
    `workItemKey: ${block.workItemKey}`,
  ].join(' / ');
}

export function createWeeklyPlanningPreviewDisplayBlock(
  block: WeeklyPlanningPreviewBlock,
  userId: string,
): WeeklyPlanDraftBlock {
  const deterministicTimestamp = `${block.date}T${block.startTime}:00`;
  const behaviorMetadata = block.behaviorMetadata
    ? {
        ...block.behaviorMetadata,
        ...(block.behaviorMetadata.weeklyPlanningObservationSource
          ? {
              weeklyPlanningObservationSource: {
                ...block.behaviorMetadata.weeklyPlanningObservationSource,
              },
            }
          : {}),
        previewMetadata: {
          previewId: block.behaviorMetadata.conversationId
            ? block.behaviorMetadata.compatibility.candidateSource === 'stable_v5'
              ? `stable-v5-preview:${block.behaviorMetadata.conversationId}:${block.behaviorMetadata.stateRevision}`
              : `behavior-preview:${block.behaviorMetadata.conversationId}:${block.behaviorMetadata.stateRevision}`
            : `behavior-preview:${block.behaviorMetadata.stateRevision}`,
          ...(block.behaviorMetadata.conversationId
            ? { conversationId: block.behaviorMetadata.conversationId }
            : {}),
          stateRevision: block.behaviorMetadata.stateRevision,
          assumptionDependencies: block.behaviorMetadata.acceptedAssumptionDependencies?.map(
            (dependency) => ({ ...dependency }),
          ) ?? block.behaviorMetadata.usedAssumptionProposalRefs.map((proposalId) => ({
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
    type: block.planType ?? 'study',
    label: block.field,
    materialId: null,
    memo: stableV5Memo(block),
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
  const blocks = candidates.map((candidate) => {
    const behaviorMetadata = behaviorMetadataFromCandidate(candidate, userId);
    const stableV5Metadata = stableV5MetadataFromCandidate(candidate);
    const memo = stableV5Metadata
      ? [
          'Stable V5 preview',
          `graphRevision: ${stableV5Metadata.graphRevision}`,
          `workItemKey: ${candidate.workItemKey}`,
        ].join(' / ')
      : [
          `year: ${candidate.year}`,
          `estimatedMinutes: ${candidate.estimatedMinutes}`,
          `workItemKey: ${candidate.workItemKey}`,
          'source: dry-run preview',
        ].join(' / ');
    return {
      id: candidate.stableKey,
      userId,
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      title: candidate.title,
      subject: candidate.field,
      type: stableV5Metadata?.planType ?? 'study' as const,
      label: candidate.field,
      materialId: null,
      materialName: '',
      memo,
      source: 'ai' as const,
      status: 'draft' as const,
      userEdited: false,
      ...(behaviorMetadata ? { behaviorMetadata } : {}),
      createdAt,
      updatedAt: createdAt,
    };
  });
  recordWeeklyPlanningDraftPromotion({ userId, blocks });
  return blocks;
}
