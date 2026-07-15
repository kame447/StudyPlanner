import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runWeeklyPlanningBehaviorAwarePipeline,
  type BehaviorAwareDialoguePlanner,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningIntakePipelineInput } from '../pipeline/weeklyPlanningIntakePipeline';
import { createInMemoryWeeklyPlanningTraceRepository } from './weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import {
  recordWeeklyPlanningApprovalTrace,
  resetWeeklyPlanningTraceRuntimeForTests,
} from './weeklyPlanningTraceRuntime';

const dialoguePlanner: BehaviorAwareDialoguePlanner = {
  async plan() {
    return {
      message: '計画したい学習内容や目標を教えてください。',
      response: null,
      source: 'deterministic_fallback',
    };
  },
};

function pipelineInput(
  userText: string,
  previousState?: PlanningIntakeState,
): WeeklyPlanningIntakePipelineInput {
  return {
    ...(previousState ? { previousState } : {}),
    userText,
    planningStartDate: '2026-07-15',
    planningDayCount: 7,
    currentDateTime: '2026-07-15T12:00:00',
    sessionPolicy: {
      firstDayStartTime: '09:00',
      dayStartTime: '09:00',
      dayEndTime: '22:00',
      breakMinutes: 10,
    },
    existingPlans: [],
    scheduleTemplates: [],
  };
}

async function waitForTrace(assertion: () => Promise<void>, maxAttempts = 30): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

describe('weekly planning trace runtime contract', () => {
  beforeEach(() => {
    resetWeeklyPlanningTraceRuntimeForTests();
  });

  afterEach(() => {
    resetWeeklyPlanningTraceRuntimeForTests();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
  });

  it('UIからconversationIdを渡さなくてもpreviousStateで同じsessionを継続する', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);

    const first = await runWeeklyPlanningBehaviorAwarePipeline(
      pipelineInput('今日から日曜までの予定立てたい'),
      { userId: 'user-1', dialoguePlanner },
    );
    await runWeeklyPlanningBehaviorAwarePipeline(
      pipelineInput('英語を3時間やりたい', first.state),
      { userId: 'user-1', dialoguePlanner },
    );

    await waitForTrace(async () => {
      const sessions = await repository.listSessionsForAdmin();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.logicalConversationId).toMatch(/^weekly-planning-conversation-/);
      expect(sessions[0]?.turnCount).toBe(4);
    });
  });

  it('同じ初期requestの即時retryを重複turnとして保存しない', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const input = pipelineInput('来週の予定を作りたい');

    await runWeeklyPlanningBehaviorAwarePipeline(input, { userId: 'user-1', dialoguePlanner });
    await runWeeklyPlanningBehaviorAwarePipeline(input, { userId: 'user-1', dialoguePlanner });

    await waitForTrace(async () => {
      const sessions = await repository.listSessionsForAdmin();
      expect(sessions).toHaveLength(1);
      const entries = await repository.listEntries('user-1', sessions[0]!.id);
      expect(entries.filter((entry) => entry.kind === 'turn')).toHaveLength(2);
      expect(entries.filter((entry) =>
        entry.kind === 'internal_event' && entry.eventType === 'user_turn_received'
      )).toHaveLength(1);
    });
  });

  it('custom AI plannerのdeterministic fallbackをrulesと誤分類しない', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);

    await runWeeklyPlanningBehaviorAwarePipeline(
      pipelineInput('予定を作りたい'),
      { userId: 'user-1', dialoguePlanner },
    );

    await waitForTrace(async () => {
      const [session] = await repository.listSessionsForAdmin();
      expect(session?.hasFallback).toBe(true);
      const entries = await repository.listEntries('user-1', session!.id);
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'turn',
          role: 'assistant',
          responseSource: 'deterministic_fallback',
        }),
        expect.objectContaining({
          kind: 'internal_event',
          eventType: 'fallback_used',
        }),
      ]));
    });
  });

  it('snapshotは30日、turnとeventは90日のexpireAtを持つ', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);

    await runWeeklyPlanningBehaviorAwarePipeline(
      pipelineInput('予定を作りたい'),
      { userId: 'user-1', dialoguePlanner },
    );

    await waitForTrace(async () => {
      const [session] = await repository.listSessionsForAdmin();
      const entries = await repository.listEntries('user-1', session!.id);
      const snapshot = entries.find((entry) => entry.kind === 'state_snapshot');
      const turn = entries.find((entry) => entry.kind === 'turn');
      expect(snapshot).toBeDefined();
      expect(turn).toBeDefined();
      const snapshotDays = (
        new Date(snapshot!.expireAt).getTime() - new Date(snapshot!.occurredAt).getTime()
      ) / 86400000;
      const turnDays = (
        new Date(turn!.expireAt).getTime() - new Date(turn!.occurredAt).getTime()
      ) / 86400000;
      expect(snapshotDays).toBe(30);
      expect(turnDays).toBe(90);
    });
  });

  it('approval completionからitem保存・重複抑止・失敗を個別event化する', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);

    await runWeeklyPlanningBehaviorAwarePipeline(
      pipelineInput('予定を作りたい'),
      { userId: 'user-1', dialoguePlanner },
    );
    await waitForTrace(async () => {
      expect(await repository.listSessionsForAdmin()).toHaveLength(1);
    });

    recordWeeklyPlanningApprovalTrace({
      userId: 'user-1',
      phase: 'completed',
      failed: true,
      payload: {
        approvalOperationId: 'operation-1',
        items: [
          { sourceDraftBlockId: 'block-1', status: 'saved', savedPlanId: 'plan-1' },
          { sourceDraftBlockId: 'block-2', status: 'skipped_duplicate', savedPlanId: 'plan-2' },
          { sourceDraftBlockId: 'block-3', status: 'failed', lastErrorCode: 'save-failed' },
        ],
      },
    });

    await waitForTrace(async () => {
      const [session] = await repository.listSessionsForAdmin();
      expect(session?.hasApprovalFailure).toBe(true);
      const entries = await repository.listEntries('user-1', session!.id);
      const itemEvents = entries.filter((entry) =>
        entry.kind === 'internal_event'
        && (entry.eventType === 'approval_item_saved' || entry.eventType === 'approval_item_failed')
      );
      expect(itemEvents).toHaveLength(3);
      expect(itemEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: 'approval_item_saved',
          payload: expect.objectContaining({ duplicateSuppressed: true }),
        }),
        expect.objectContaining({ eventType: 'approval_item_failed' }),
      ]));
    });
  });
});
