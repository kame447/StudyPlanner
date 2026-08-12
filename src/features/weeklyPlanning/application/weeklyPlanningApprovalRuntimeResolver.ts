import type {
  WeeklyPreviewApprovalRuntimeSnapshot,
} from '../planning/weeklyPlanningApproval';
import { getWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import type { WeeklyPlanDraftBlock } from '../types';
import {
  getWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';

export type WeeklyPlanningApprovalRuntimeResolution =
  | {
      kind: 'unbound';
      stableV5: boolean;
      runtimeSnapshot: null;
    }
  | {
      kind: 'available';
      stableV5: boolean;
      runtimeSnapshot: WeeklyPreviewApprovalRuntimeSnapshot;
    }
  | {
      kind: 'unavailable';
      stableV5: boolean;
      runtimeSnapshot: null;
    }
  | {
      kind: 'owner_mismatch';
      stableV5: true;
      runtimeSnapshot: null;
    }
  | {
      kind: 'mixed_runtime_sources';
      stableV5: false;
      runtimeSnapshot: null;
    };

export function resolveWeeklyPlanningApprovalRuntime(params: {
  blocks: readonly WeeklyPlanDraftBlock[];
  userId: string;
}): WeeklyPlanningApprovalRuntimeResolution {
  const stableFlags = params.blocks.map(
    (block) => block.behaviorMetadata?.compatibility.candidateSource === 'stable_v5',
  );
  const stableCount = stableFlags.filter(Boolean).length;
  if (stableCount > 0 && stableCount !== stableFlags.length) {
    return {
      kind: 'mixed_runtime_sources',
      stableV5: false,
      runtimeSnapshot: null,
    };
  }
  const stableV5 = stableFlags.length > 0 && stableCount === stableFlags.length;
  const conversationId = params.blocks[0]?.behaviorMetadata?.previewMetadata?.conversationId?.trim();
  if (!conversationId) {
    return { kind: 'unbound', stableV5, runtimeSnapshot: null };
  }

  if (stableV5) {
    const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
    if (!runtime) {
      return { kind: 'unavailable', stableV5: true, runtimeSnapshot: null };
    }
    if (runtime.ownerId !== params.userId) {
      return { kind: 'owner_mismatch', stableV5: true, runtimeSnapshot: null };
    }
    return {
      kind: 'available',
      stableV5: true,
      runtimeSnapshot: {
        conversationId: runtime.conversationId,
        stateRevision: runtime.graph.revision,
        proposalRecords: [],
      },
    };
  }

  const runtime = getWeeklyPlanningSessionRuntime();
  if (!runtime) {
    return { kind: 'unavailable', stableV5: false, runtimeSnapshot: null };
  }
  return {
    kind: 'available',
    stableV5: false,
    runtimeSnapshot: {
      conversationId: runtime.conversationId,
      stateRevision: runtime.stateRevision,
      proposalRecords: runtime.proposalRecords,
    },
  };
}
