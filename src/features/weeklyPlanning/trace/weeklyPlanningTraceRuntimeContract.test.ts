import { runLegacyWeeklyPlanningBehaviorAwarePipelineForTests } from '../pipeline/weeklyPlanningLegacyBehaviorAwareIntakePipeline.testSupport';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type BehaviorAwareDialoguePlanner,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningIntakePipelineInput } from '../pipeline/weeklyPlanningIntakePipeline';
import { createInMemoryWeeklyPlanningTraceRepository } from './weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanDraftBlock } from '../types';
import {
  recordWeeklyPlanningApprovalTrace,
  recordWeeklyPlanningDraftPromotion,
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

    const first = await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
      pipelineInput('今日から日曜までの予定立てたい'),
      { userId: 'user-1', dialoguePlanner },
    );
    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
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

    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(input, { userId: 'user-1', dialoguePlanner });
    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(input, { userId: 'user-1', dialoguePlanner });

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

    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
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

    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
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

    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
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

  it('同じ初期発話でも別input objectは別conversationとして保存する', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);

    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
      pipelineInput('来週の予定を作りたい'),
      { userId: 'user-1', dialoguePlanner },
    );
    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
      pipelineInput('来週の予定を作りたい'),
      { userId: 'user-1', dialoguePlanner },
    );

    await waitForTrace(async () => {
      const sessions = await repository.listSessionsForAdmin();
      expect(sessions).toHaveLength(2);
      expect(new Set(sessions.map((session) => session.logicalConversationId)).size).toBe(2);
    });
  });

  it('preview相関を使い並行会話AのapprovalをAだけへ記録する', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);

    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
      pipelineInput('会話A'),
      { userId: 'user-1', conversationId: 'conversation-a', dialoguePlanner },
    );
    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
      pipelineInput('会話B'),
      { userId: 'user-1', conversationId: 'conversation-b', dialoguePlanner },
    );
    await waitForTrace(async () => {
      expect(await repository.listSessionsForAdmin()).toHaveLength(2);
    });

    recordWeeklyPlanningDraftPromotion({
      userId: 'user-1',
      blocks: [{
        id: 'block-a',
        behaviorMetadata: {
          previewMetadata: {
            previewId: 'preview-a',
            conversationId: 'conversation-a',
            stateRevision: 1,
            assumptionDependencies: [],
            approvalEligibility: 'eligible',
            stale: false,
            authorizedUserId: 'user-1',
          },
        },
      } as unknown as WeeklyPlanDraftBlock],
    });
    recordWeeklyPlanningApprovalTrace({
      userId: 'user-1',
      phase: 'completed',
      payload: { previewId: 'preview-a', items: [] },
    });

    await waitForTrace(async () => {
      const sessions = await repository.listSessionsForAdmin();
      const sessionA = sessions.find((session) => session.logicalConversationId === 'conversation-a');
      const sessionB = sessions.find((session) => session.logicalConversationId === 'conversation-b');
      expect(sessionA?.status).toBe('completed');
      expect(sessionB?.status).toBe('active');
      const entriesA = await repository.listEntries('user-1', sessionA!.id);
      const entriesB = await repository.listEntries('user-1', sessionB!.id);
      expect(entriesA.some((entry) =>
        entry.kind === 'internal_event' && entry.eventType === 'approval_completed'
      )).toBe(true);
      expect(entriesB.some((entry) =>
        entry.kind === 'internal_event' && entry.eventType === 'approval_completed'
      )).toBe(false);
    });
  });

  it('遅延write失敗を次の成功writeで一度だけ診断event化する', async () => {
    const stored = createInMemoryWeeklyPlanningTraceRepository();
    let appendCallCount = 0;
    let releaseFirstWrite: (() => void) | undefined;
    let firstWriteStarted: (() => void) | undefined;
    const firstWriteStartedPromise = new Promise<void>((resolve) => { firstWriteStarted = resolve; });
    const firstWriteBlocker = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    setWeeklyPlanningTraceRepositoryForTests({
      ...stored,
      async appendEntries(params) {
        appendCallCount += 1;
        if (appendCallCount === 1) {
          firstWriteStarted?.();
          await firstWriteBlocker;
          throw new Error('delayed-write-failure');
        }
        await stored.appendEntries(params);
      },
    });

    const first = await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
      pipelineInput('予定を作りたい'),
      { userId: 'user-1', conversationId: 'conversation-write', dialoguePlanner },
    );
    await firstWriteStartedPromise;
    const second = await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
      pipelineInput('英語を3時間やりたい', first.state),
      { userId: 'user-1', conversationId: 'conversation-write', dialoguePlanner },
    );
    expect(second.state).toBeDefined();
    releaseFirstWrite?.();

    await waitForTrace(async () => {
      const [session] = await stored.listSessionsForAdmin();
      expect(session?.hasError).toBe(true);
      const entries = await stored.listEntries('user-1', session!.id);
      const failures = entries.filter((entry) =>
        entry.kind === 'internal_event' && entry.eventType === 'trace_write_failed'
      );
      expect(failures).toHaveLength(1);
    });
  });


  it('明示request IDが同じretryを別input objectでも重複保存しない', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const options = {
      userId: 'user-1',
      conversationId: 'conversation-retry',
      traceRequestId: 'request-retry-1',
      dialoguePlanner,
    };

    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(pipelineInput('同じ発話'), options);
    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(pipelineInput('同じ発話'), options);

    await waitForTrace(async () => {
      const [session] = await repository.listSessionsForAdmin();
      const entries = await repository.listEntries('user-1', session!.id);
      expect(entries.filter((entry) =>
        entry.kind === 'internal_event' && entry.eventType === 'user_turn_received'
      )).toHaveLength(1);
    });
  });

  it('runtime reset後の同じ初期発話を新しいconversationとして保存する', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);
    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
      pipelineInput('同じ発話'),
      { userId: 'user-1', dialoguePlanner },
    );
    await waitForTrace(async () => {
      expect(await repository.listSessionsForAdmin()).toHaveLength(1);
    });

    resetWeeklyPlanningTraceRuntimeForTests();
    await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests(
      pipelineInput('同じ発話'),
      { userId: 'user-1', dialoguePlanner },
    );

    await waitForTrace(async () => {
      const sessions = await repository.listSessionsForAdmin();
      expect(sessions).toHaveLength(2);
      expect(new Set(sessions.map((session) => session.logicalConversationId)).size).toBe(2);
    });
  });

});
