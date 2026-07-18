import { describe, expect, it, vi } from 'vitest';
import { createWeeklyPlanningTestDraftBlock } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyDraftApprovalOperation } from './weeklyPlanningApproval';
import type { WeeklyPreviewMetadata } from './weeklyPlanningApprovalTypes';
import { executeInterruptibleWeeklyDraftApproval } from './weeklyPlanningInterruptibleApproval';

const metadata: WeeklyPreviewMetadata = {
  previewId: 'preview-interruption',
  stateRevision: 0,
  assumptionDependencies: [],
  approvalEligibility: 'eligible',
  stale: false,
  authorizedUserId: 'user-1',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function operation() {
  const blocks = [
    createWeeklyPlanningTestDraftBlock({ id: 'block-1', previewMetadata: metadata }),
    createWeeklyPlanningTestDraftBlock({ id: 'block-2', previewMetadata: metadata }),
  ];
  return {
    blocks,
    operation: createWeeklyDraftApprovalOperation({
      userId: 'user-1',
      metadata,
      blocks,
      now: '2026-07-18T00:00:00.000Z',
    }),
  };
}

describe('executeInterruptibleWeeklyDraftApproval', () => {
  it('finishes the active save but does not start the next item after ownership is lost', async () => {
    const fixture = operation();
    const firstSave = deferred<{ planId: string }>();
    let active = true;
    const lookedUp: string[] = [];
    const saved: string[] = [];

    const execution = executeInterruptibleWeeklyDraftApproval({
      ...fixture,
      shouldContinue: () => active,
      dependencies: {
        async findExistingPlanId({ sourceDraftBlockId }) {
          lookedUp.push(sourceDraftBlockId);
          return undefined;
        },
        async saveBlock({ block }) {
          saved.push(block.id);
          return block.id === 'block-1'
            ? firstSave.promise
            : { planId: `plan-${block.id}` };
        },
        now: () => '2026-07-18T00:01:00.000Z',
      },
    });

    await vi.waitFor(() => expect(saved).toEqual(['block-1']));
    active = false;
    firstSave.resolve({ planId: 'plan-block-1' });
    const result = await execution;

    expect(lookedUp).toEqual(['block-1']);
    expect(saved).toEqual(['block-1']);
    expect(result.status).toBe('partially_saved');
    expect(result.items.map((item) => item.status)).toEqual(['saved', 'pending']);
    expect(result.items[0].savedPlanId).toBe('plan-block-1');
  });

  it('does not call saveBlock when ownership is lost while duplicate lookup is pending', async () => {
    const fixture = operation();
    const lookup = deferred<string | undefined>();
    let active = true;
    const saveBlock = vi.fn(async () => ({ planId: 'unexpected-plan' }));

    const execution = executeInterruptibleWeeklyDraftApproval({
      ...fixture,
      shouldContinue: () => active,
      dependencies: {
        findExistingPlanId: () => lookup.promise,
        saveBlock,
        now: () => '2026-07-18T00:01:00.000Z',
      },
    });

    active = false;
    lookup.resolve(undefined);
    const result = await execution;

    expect(saveBlock).not.toHaveBeenCalled();
    expect(result.status).toBe('pending');
    expect(result.items.map((item) => item.status)).toEqual(['pending', 'pending']);
  });

  it('preserves the normal all-success behavior when ownership remains active', async () => {
    const fixture = operation();
    const result = await executeInterruptibleWeeklyDraftApproval({
      ...fixture,
      shouldContinue: () => true,
      dependencies: {
        async findExistingPlanId() {
          return undefined;
        },
        async saveBlock({ block }) {
          return { planId: `plan-${block.id}` };
        },
        now: () => '2026-07-18T00:01:00.000Z',
      },
    });

    expect(result.status).toBe('completed');
    expect(result.items.map((item) => item.status)).toEqual(['saved', 'saved']);
    expect(result.items.map((item) => item.savedPlanId)).toEqual([
      'plan-block-1',
      'plan-block-2',
    ]);
  });
});
