import { afterEach, describe, expect, it } from 'vitest';
import type { WeeklyPreviewMetadata } from '../planning/weeklyPlanningApprovalTypes';
import {
  clearWeeklyPlanningSessionRuntime,
  publishWeeklyPlanningSessionRuntime,
} from '../planning/weeklyPlanningSessionRuntime';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningTestDraftBlock } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { classifyWeeklyPlanningApprovalAvailability } from './weeklyPlanningApprovalAvailability';
import {
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const metadata: WeeklyPreviewMetadata = {
  previewId: 'preview-restored',
  conversationId: 'conversation-current',
  stateRevision: 3,
  assumptionDependencies: [],
  approvalEligibility: 'eligible',
  stale: false,
  authorizedUserId: 'user-1',
};

function behaviorBlock(override: Partial<WeeklyPreviewMetadata> = {}) {
  return createWeeklyPlanningTestDraftBlock({
    id: 'block-1',
    previewMetadata: { ...metadata, ...override },
  });
}

function stableV5Block(override: Partial<WeeklyPreviewMetadata> = {}) {
  const block = behaviorBlock(override);
  block.behaviorMetadata = {
    ...block.behaviorMetadata!,
    reasoningKey: 'stable-v5-explicit-duration',
    compatibility: {
      workItemSemantic: 'generic_semantic_task',
      schedulerInputSource: 'stable_v5_generic_scheduler_input',
      candidateSource: 'stable_v5',
    },
  };
  return block;
}

function hydrateStableV5Session(params: {
  conversationId: string;
  revision: number;
  ownerId?: string;
}): void {
  hydrateWeeklyPlanningStableV5RuntimeSession({
    ownerId: params.ownerId ?? 'user-1',
    weekStartDate: '2026-07-27',
    conversationId: params.conversationId,
    graph: {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: params.revision,
    },
  });
}

describe('classifyWeeklyPlanningApprovalAvailability', () => {
  afterEach(() => {
    clearWeeklyPlanningSessionRuntime();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });

  it('allows a behavior-aware draft while the matching runtime remains active', () => {
    publishWeeklyPlanningSessionRuntime({
      conversationId: 'conversation-current',
      stateRevision: 3,
      proposalRecords: [],
    });

    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [behaviorBlock()],
      userId: 'user-1',
    })).toEqual({ kind: 'eligible', reason: 'current_session' });
  });

  it('requires recomputation when reload removes the session runtime', () => {
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [behaviorBlock()],
      userId: 'user-1',
    })).toEqual({
      kind: 'recompute_required',
      reason: 'session_runtime_unavailable',
      message: '再読み込み前の仮予定です。最新条件で作り直してください。',
    });
  });

  it('requires recomputation for conversation or revision mismatch', () => {
    publishWeeklyPlanningSessionRuntime({
      conversationId: 'another-conversation',
      stateRevision: 3,
      proposalRecords: [],
    });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [behaviorBlock()],
      userId: 'user-1',
    }).reason).toBe('conversation_mismatch');

    publishWeeklyPlanningSessionRuntime({
      conversationId: 'conversation-current',
      stateRevision: 4,
      proposalRecords: [],
    });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [behaviorBlock()],
      userId: 'user-1',
    }).reason).toBe('state_revision_mismatch');
  });

  it('keeps modal close and reopen eligible while the same runtime remains active', () => {
    publishWeeklyPlanningSessionRuntime({
      conversationId: 'conversation-current',
      stateRevision: 3,
      proposalRecords: [],
    });

    const beforeClose = classifyWeeklyPlanningApprovalAvailability({
      blocks: [behaviorBlock()],
      userId: 'user-1',
    });
    const afterReopen = classifyWeeklyPlanningApprovalAvailability({
      blocks: [behaviorBlock()],
      userId: 'user-1',
    });

    expect(beforeClose.kind).toBe('eligible');
    expect(afterReopen.kind).toBe('eligible');
  });

  it('checks a Stable V5 draft against its own conversation even when another conversation is current', () => {
    hydrateStableV5Session({ conversationId: 'conversation-current', revision: 3 });
    hydrateStableV5Session({ conversationId: 'another-conversation', revision: 8 });

    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [stableV5Block()],
      userId: 'user-1',
    })).toEqual({ kind: 'eligible', reason: 'current_session' });
  });

  it('requires Stable V5 recomputation when its own conversation is unavailable or revised', () => {
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [stableV5Block()],
      userId: 'user-1',
    }).reason).toBe('session_runtime_unavailable');

    hydrateStableV5Session({ conversationId: 'conversation-current', revision: 4 });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [stableV5Block()],
      userId: 'user-1',
    }).reason).toBe('state_revision_mismatch');
  });

  it('never approves a Stable V5 draft against another owner runtime', () => {
    hydrateStableV5Session({
      conversationId: 'conversation-current',
      revision: 3,
      ownerId: 'user-2',
    });

    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [stableV5Block()],
      userId: 'user-1',
    })).toMatchObject({ kind: 'blocked', reason: 'user_mismatch' });
  });

  it('preserves the metadata-less legacy approval path', () => {
    const block = createWeeklyPlanningTestDraftBlock({ id: 'legacy-block' });
    delete block.behaviorMetadata;

    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [block],
      userId: 'user-1',
    })).toEqual({ kind: 'eligible', reason: 'legacy_compatible' });
  });

  it('never upgrades stale, mixed, or another-user drafts to eligible', () => {
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [behaviorBlock({ stale: true })],
      userId: 'user-1',
    }).kind).toBe('blocked');

    const legacyBlock = createWeeklyPlanningTestDraftBlock({ id: 'legacy-block' });
    delete legacyBlock.behaviorMetadata;
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [behaviorBlock(), legacyBlock],
      userId: 'user-1',
    }).reason).toBe('mixed_metadata');

    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: [behaviorBlock()],
      userId: 'user-2',
    }).reason).toBe('user_mismatch');
  });
});
