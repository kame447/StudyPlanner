import type {
  WeeklyPreviewApprovalRuntimeSnapshot,
} from '../planning/weeklyPlanningApproval';
import {
  getWeeklyPlanningSessionRuntime,
} from '../planning/weeklyPlanningSessionRuntime';
import {
  getWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';

export type WeeklyPlanningStableV5ApprovalRuntimeLookupResult =
  | {
      kind: 'available';
      runtimeSnapshot: WeeklyPreviewApprovalRuntimeSnapshot;
    }
  | {
      kind: 'unavailable';
      runtimeSnapshot: null;
    }
  | {
      kind: 'owner_mismatch';
      runtimeSnapshot: null;
    };

export type WeeklyPlanningCompatibilityApprovalRuntimeLookupResult =
  | {
      kind: 'available';
      runtimeSnapshot: WeeklyPreviewApprovalRuntimeSnapshot;
    }
  | {
      kind: 'unavailable';
      runtimeSnapshot: null;
    };

export interface WeeklyPlanningApprovalRuntimeLookupServices {
  getStableV5RuntimeSession: typeof getWeeklyPlanningStableV5RuntimeSession;
  getCompatibilityRuntime: typeof getWeeklyPlanningSessionRuntime;
}

export interface WeeklyPlanningApprovalRuntimeLookup {
  stableV5(params: {
    conversationId: string;
    userId: string;
  }): WeeklyPlanningStableV5ApprovalRuntimeLookupResult;
  compatibility(): WeeklyPlanningCompatibilityApprovalRuntimeLookupResult;
}

const defaultServices: WeeklyPlanningApprovalRuntimeLookupServices = {
  getStableV5RuntimeSession: getWeeklyPlanningStableV5RuntimeSession,
  getCompatibilityRuntime: getWeeklyPlanningSessionRuntime,
};

export function createWeeklyPlanningApprovalRuntimeLookup(
  services: WeeklyPlanningApprovalRuntimeLookupServices = defaultServices,
): WeeklyPlanningApprovalRuntimeLookup {
  return {
    stableV5(params) {
      const runtime = services.getStableV5RuntimeSession(params.conversationId);
      if (!runtime) {
        return { kind: 'unavailable', runtimeSnapshot: null };
      }
      if (runtime.ownerId !== params.userId) {
        return { kind: 'owner_mismatch', runtimeSnapshot: null };
      }
      return {
        kind: 'available',
        runtimeSnapshot: {
          conversationId: runtime.conversationId,
          stateRevision: runtime.graph.revision,
          proposalRecords: [],
        },
      };
    },
    compatibility() {
      const runtime = services.getCompatibilityRuntime();
      if (!runtime) {
        return { kind: 'unavailable', runtimeSnapshot: null };
      }
      return {
        kind: 'available',
        runtimeSnapshot: {
          conversationId: runtime.conversationId,
          stateRevision: runtime.stateRevision,
          proposalRecords: runtime.proposalRecords,
        },
      };
    },
  };
}

export const weeklyPlanningApprovalRuntimeLookup =
  createWeeklyPlanningApprovalRuntimeLookup();
