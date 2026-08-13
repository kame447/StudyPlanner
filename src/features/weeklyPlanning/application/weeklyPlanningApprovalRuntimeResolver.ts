import type {
  WeeklyPreviewApprovalRuntimeSnapshot,
} from '../planning/weeklyPlanningApproval';
import type { WeeklyPlanDraftBlock } from '../types';
import {
  weeklyPlanningApprovalRuntimeLookup,
} from './weeklyPlanningApprovalRuntimeLookup';

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
    const resolution = weeklyPlanningApprovalRuntimeLookup.stableV5({
      conversationId,
      userId: params.userId,
    });
    return {
      ...resolution,
      stableV5: true,
    };
  }

  const resolution = weeklyPlanningApprovalRuntimeLookup.compatibility();
  return {
    ...resolution,
    stableV5: false,
  };
}
