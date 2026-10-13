import { describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { PlanDraft } from '../../../types/domain';
import { createWeeklyPlanningTestDraftBlock } from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { PlanningState, WeeklyPlanningAction, WeeklyPlanDraftBlock } from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { parseWeeklyPlanningCompatibilitySnapshot } from '../weeklyPlanningStorage';
import { validateWeeklyPreviewApproval } from '../planning/weeklyPlanningApproval';
import { classifyWeeklyPlanningApprovalAvailability } from './weeklyPlanningApprovalAvailability';
import { approveWeeklyPlanningDraftBlocks } from './weeklyPlanningApprovalApplication';

const OWNER = 'user-1';
const WEEK = '2026-07-13';

function block(id: string): WeeklyPlanDraftBlock {
  return createWeeklyPlanningTestDraftBlock({
    id,
    previewMetadata: {
      previewId: 'legacy-batch-issue128',
      stateRevision: 0,
      authorizedUserId: OWNER,
      approvalEligibility: 'eligible',
      stale: false,
      assumptionDependencies: [],
    },
  });
}

const invalidCases = [
  {
    name: 'missing assumption dependency',
    invalidate(value: WeeklyPlanDraftBlock) {
      value.behaviorMetadata!.previewMetadata!.assumptionDependencies = [{
        proposalId: 'missing-proposal',
        targetRef: 'missing-target',
        proposalCreatedFromStateRevision: 0,
      }];
    },
  },
  {
    name: 'stale block',
    invalidate(value: WeeklyPlanDraftBlock) {
      value.behaviorMetadata!.previewMetadata!.stale = true;
    },
  },
  {
    name: 'blocked-invalid block',
    invalidate(value: WeeklyPlanDraftBlock) {
      value.behaviorMetadata!.previewMetadata!.approvalEligibility = 'blocked_invalid';
    },
  },
];

async function approveReloaded(blocks: WeeklyPlanDraftBlock[]) {
  const original = { ...createInitialPlanningState(WEEK), draftBlocks: blocks };
  const restored = parseWeeklyPlanningCompatibilitySnapshot(
    JSON.stringify({ version: 2, state: original }), OWNER, WEEK,
  );
  // The reproduction must pass the real persisted-data reader first.
  expect(restored).not.toBeNull();
  expect(restored!.draftBlocks).toEqual(blocks);
  let state: PlanningState = restored!;
  let savedCount = 0;
  const save = vi.fn(async (draft: PlanDraft) => ({
    ...createPlanFromDraft(draft), id: `saved-${++savedCount}`,
  }));
  const completed = vi.fn();
  let error: unknown;
  try {
    await approveWeeklyPlanningDraftBlocks({
      userId: OWNER,
      plans: [],
      approvalOperations: [],
      getState: () => state,
      dispatch(action: WeeklyPlanningAction) {
        state = weeklyPlanningReducer(state, action);
        return state;
      },
      saveWeeklyApprovedPlan: save,
      onOperationCompleted: completed,
    });
  } catch (caught) {
    error = caught;
  }
  return { state, save, completed, error };
}

describe('Issue #128 restored multi-block approval must check every block', () => {
  it.each(invalidCases)('rejects $name in the second block without any saves', async ({ invalidate }) => {
    const good = block('good');
    const invalid = block('invalid');
    invalidate(invalid);
    const result = await approveReloaded([good, invalid]);
    // This deliberately fails on main819d5bac: both callbacks execute and drafts disappear.
    expect(result.save.mock.calls.length, JSON.stringify({
      saved: result.save.mock.calls.length,
      remainingDrafts: result.state.draftBlocks.length,
      operationCompleted: result.completed.mock.calls.length,
      rejected: result.error !== undefined,
    })).toBe(0);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.completed).not.toHaveBeenCalled();
    expect(result.state.draftBlocks).toEqual([good, invalid]);
  });

  it.each(invalidCases)('rejects $name in the first block (permutation control)', async ({ invalidate }) => {
    const invalid = block('invalid');
    invalidate(invalid);
    const good = block('good');
    const result = await approveReloaded([invalid, good]);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.save).not.toHaveBeenCalled();
    expect(result.completed).not.toHaveBeenCalled();
    expect(result.state.draftBlocks).toEqual([invalid, good]);
  });

  it('saves both valid restored blocks and removes the draft batch', async () => {
    const result = await approveReloaded([block('valid-a'), block('valid-b')]);
    expect(result.error).toBeUndefined();
    expect(result.save).toHaveBeenCalledTimes(2);
    expect(result.completed).toHaveBeenCalledTimes(1);
    expect(result.state.draftBlocks).toEqual([]);
  });
});

describe('Issue #128-B unresolved metadata-free recovery policy (separate from batch fix)', () => {
  it.fails('keeps restored metadata-free blocks unsaved until their approval provenance is recovered', async () => {
    const first = block('metadata-free-a');
    const second = block('metadata-free-b');
    delete first.behaviorMetadata;
    delete second.behaviorMetadata;
    const result = await approveReloaded([first, second]);
    // The existing security it.fails checks only the guard. This crosses codec,
    // runtime resolution, application, executor, mock saves and reducer instead.
    expect(result.save.mock.calls.length, JSON.stringify({
      saved: result.save.mock.calls.length,
      remainingDrafts: result.state.draftBlocks.length,
      rejected: result.error !== undefined,
    })).toBe(0);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.state.draftBlocks).toEqual([first, second]);
  });
});

function permutations<T>(values: T[]): T[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index))
    .map(rest => [value, ...rest]));
}

describe('Issue #128-A permutation and approval availability', () => {
  it.each(invalidCases)('blocks Save availability for $name at every position', ({ invalidate }) => {
    const invalid = block('invalid');
    invalidate(invalid);
    for (const ordered of permutations([block('valid-a'), block('valid-b'), invalid])) {
      expect(classifyWeeklyPlanningApprovalAvailability({ blocks: ordered, userId: OWNER }))
        .toMatchObject({ kind: 'blocked', reason: 'metadata_ineligible' });
    }
  });

  it('returns the same rejection payload for every mixed-error permutation', () => {
    const invalid = block('invalid');
    invalidCases[2].invalidate(invalid);
    const stale = block('stale');
    invalidCases[1].invalidate(stale);
    const dependency = block('dependency');
    invalidCases[0].invalidate(dependency);
    const results = permutations([invalid, stale, dependency]).map(blocks => validateWeeklyPreviewApproval({
      blocks, currentStateRevision: 0, userId: OWNER, proposalRecords: [], runtimeSnapshot: null,
    }));
    expect(results[0]).toMatchObject({ allowed: false, attempt: { kind: 'invalid_preview_approval_attempt' } });
    for (const result of results) expect(result).toEqual(results[0]);
  });

  it('allows every valid permutation without unioning operation dependencies', () => {
    const blocks = [block('valid-a'), block('valid-b'), block('valid-c')];
    for (const ordered of permutations(blocks)) {
      expect(validateWeeklyPreviewApproval({
        blocks: ordered, currentStateRevision: 0, userId: OWNER, proposalRecords: [], runtimeSnapshot: null,
      })).toEqual({ allowed: true, metadata: ordered[0].behaviorMetadata!.previewMetadata });
      expect(classifyWeeklyPlanningApprovalAvailability({ blocks: ordered, userId: OWNER }))
        .toEqual({ kind: 'eligible', reason: 'legacy_compatible' });
    }
  });

  it('validates an accepted dependency on a later block but returns the existing first-block metadata', () => {
    const first = block('valid-a');
    const dependent = block('valid-b');
    dependent.behaviorMetadata!.previewMetadata!.assumptionDependencies = [{
      proposalId: 'accepted-proposal', targetRef: 'task:valid-b', proposalCreatedFromStateRevision: 0,
    }];
    const result = validateWeeklyPreviewApproval({
      blocks: [first, dependent], currentStateRevision: 0, userId: OWNER, runtimeSnapshot: null,
      proposalRecords: [{
        proposalId: 'accepted-proposal', conversationId: 'legacy-conversation', slot: 'duration',
        targetRef: 'task:valid-b', proposedValue: 60, proposedUnit: 'minutes', reasonCode: 'missing_duration',
        sourceFactRefs: ['task:valid-b'], createdAtTurnId: 'turn-0', createdFromStateRevision: 0,
        status: 'accepted',
      }],
    });
    expect(result).toEqual({ allowed: true, metadata: first.behaviorMetadata!.previewMetadata });
    expect(first.behaviorMetadata!.previewMetadata!.assumptionDependencies).toEqual([]);
    expect(dependent.behaviorMetadata!.previewMetadata!.assumptionDependencies).toHaveLength(1);
  });
});
