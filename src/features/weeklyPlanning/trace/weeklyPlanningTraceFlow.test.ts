import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runWeeklyPlanningBehaviorAwarePipeline,
  type BehaviorAwareDialoguePlanner,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import { createInMemoryWeeklyPlanningTraceRepository } from './weeklyPlanningTraceInMemoryRepository';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';
import {
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

async function waitForTrace(
  assertion: () => Promise<void>,
  maxAttempts = 20,
): Promise<void> {
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

describe('weekly planning trace end-to-end flow', () => {
  beforeEach(() => {
    resetWeeklyPlanningTraceRuntimeForTests();
  });

  afterEach(() => {
    resetWeeklyPlanningTraceRuntimeForTests();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
  });

  it('stores an actual pipeline turn and exposes it through the admin repository reads', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);

    const output = await runWeeklyPlanningBehaviorAwarePipeline({
      userText: '今日から日曜までの予定立てたい',
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
    }, {
      userId: 'user-1',
      conversationId: 'conversation-1',
      dialoguePlanner,
    });

    expect(output.state.missing).toContain('tasks_or_goals');

    await waitForTrace(async () => {
      const sessions = await repository.listSessionsForAdmin();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        userId: 'user-1',
        logicalConversationId: 'conversation-1',
        turnCount: 2,
      });

      const entries = await repository.listEntries('user-1', sessions[0].id);
      expect(entries.some((entry) =>
        entry.kind === 'turn'
        && entry.role === 'user'
        && entry.content === '今日から日曜までの予定立てたい'
      )).toBe(true);
      expect(entries.some((entry) =>
        entry.kind === 'turn'
        && entry.role === 'assistant'
        && entry.content === '計画したい学習内容や目標を教えてください。'
      )).toBe(true);
      expect(entries.some((entry) =>
        entry.kind === 'state_snapshot'
        && entry.stateRevision === output.behavior.snapshot.stateRevision
      )).toBe(true);
    });
  });
});
