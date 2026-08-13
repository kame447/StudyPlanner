import { describe, expect, it, vi } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  createWeeklyPlanningApprovalRuntimeLookup,
  type WeeklyPlanningApprovalRuntimeLookupServices,
} from './weeklyPlanningApprovalRuntimeLookup';

function services(
  overrides: Partial<WeeklyPlanningApprovalRuntimeLookupServices> = {},
): WeeklyPlanningApprovalRuntimeLookupServices {
  return {
    getStableV5RuntimeSession: vi.fn(() => null),
    getCompatibilityRuntime: vi.fn(() => null),
    ...overrides,
  };
}

describe('weeklyPlanningApprovalRuntimeLookup', () => {
  it('resolves Stable V5 runtime by conversation and authenticated owner', () => {
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 7,
    };
    const injected = services({
      getStableV5RuntimeSession: vi.fn(() => ({
        ownerId: 'user-1',
        weekStartDate: '2026-08-17',
        conversationId: 'conversation-1',
        graph,
        updatedAt: 1,
      })),
    });
    const lookup = createWeeklyPlanningApprovalRuntimeLookup(injected);

    expect(lookup.stableV5({
      conversationId: 'conversation-1',
      userId: 'user-1',
    })).toEqual({
      kind: 'available',
      runtimeSnapshot: {
        conversationId: 'conversation-1',
        stateRevision: 7,
        proposalRecords: [],
      },
    });
    expect(injected.getStableV5RuntimeSession).toHaveBeenCalledWith('conversation-1');
  });

  it('fails closed when Stable V5 runtime is absent or owned by another user', () => {
    const missing = createWeeklyPlanningApprovalRuntimeLookup(services());
    expect(missing.stableV5({
      conversationId: 'conversation-1',
      userId: 'user-1',
    })).toEqual({ kind: 'unavailable', runtimeSnapshot: null });

    const mismatched = createWeeklyPlanningApprovalRuntimeLookup(services({
      getStableV5RuntimeSession: vi.fn(() => ({
        ownerId: 'user-2',
        weekStartDate: '2026-08-17',
        conversationId: 'conversation-1',
        graph: createEmptyWeeklyPlanningFactGraphV5(),
        updatedAt: 1,
      })),
    }));
    expect(mismatched.stableV5({
      conversationId: 'conversation-1',
      userId: 'user-1',
    })).toEqual({ kind: 'owner_mismatch', runtimeSnapshot: null });
  });

  it('maps the legacy compatibility runtime without changing its proposal records contract', () => {
    const proposalRecord = {
      proposalId: 'proposal-1',
      targetRef: 'task:0',
      slot: 'duration' as const,
      proposedValue: 60,
      proposedUnit: 'minutes',
      reason: 'first-trial' as const,
      status: 'pending' as const,
      sourceFactRefs: ['task:0'],
      createdFromStateRevision: 3,
      createdAtTurnId: 'turn-1',
      createdBy: 'ai' as const,
    };
    const injected = services({
      getCompatibilityRuntime: vi.fn(() => ({
        conversationId: 'legacy-conversation',
        stateRevision: 3,
        proposalRecords: [proposalRecord],
        updatedAt: 1,
      })),
    });
    const lookup = createWeeklyPlanningApprovalRuntimeLookup(injected);

    expect(lookup.compatibility()).toEqual({
      kind: 'available',
      runtimeSnapshot: {
        conversationId: 'legacy-conversation',
        stateRevision: 3,
        proposalRecords: [proposalRecord],
      },
    });
  });
});
