import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
  type BehaviorAwareDialoguePlanner,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';
import { createInMemoryWeeklyPlanningTraceRepository } from './weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { resetWeeklyPlanningTraceRuntimeForTests } from './weeklyPlanningTraceRuntime';

const dialoguePlanner: BehaviorAwareDialoguePlanner = {
  async plan() {
    return { message: '確認します。', response: null, source: 'ai' };
  },
};

function input(interpreter: WeeklyPlanningIntakeInterpreter) {
  return {
    userText: '今日の予定を立てたいです',
    planningStartDate: '2026-07-21',
    planningDayCount: 7,
    currentDateTime: '2026-07-21T23:24:00',
    existingPlans: [],
    scheduleTemplates: [],
    interpreter,
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

describe('weekly planning interpreter trace observability', () => {
  beforeEach(() => resetWeeklyPlanningTraceRuntimeForTests());
  afterEach(() => {
    resetWeeklyPlanningTraceRuntimeForTests();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
  });

  it('records the redaction-boundary raw provider response with interpreter completion', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const rawResponse = JSON.stringify({ candidates: [] });

    await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(input({
      async interpretUserTurn() {
        return { candidates: [], parseRejections: [], rawResponse };
      },
    }), { userId: 'user-1', conversationId: 'conversation-raw', dialoguePlanner });

    await waitForTrace(async () => {
      const [session] = await repository.listSessionsForAdmin();
      const entries = await repository.listEntries('user-1', session!.id);
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'internal_event',
          eventType: 'interpreter_completed',
          payload: expect.objectContaining({
            status: 'empty',
            interpretationSource: 'ai_interpreter',
            stateMutationSource: 'none',
            rawResponse,
          }),
        }),
      ]));
    });
  });

  it('records provider failure without marking a parser fallback', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);

    await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(input({
      async interpretUserTurn() {
        throw new Error('A message was too long.');
      },
    }), { userId: 'user-1', conversationId: 'conversation-fallback', dialoguePlanner });

    await waitForTrace(async () => {
      const [session] = await repository.listSessionsForAdmin();
      expect(session?.hasFallback).toBe(false);
      expect(session?.hasError).toBe(true);
      const entries = await repository.listEntries('user-1', session!.id);
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'internal_event',
          eventType: 'interpreter_completed',
          severity: 'error',
          payload: expect.objectContaining({
            status: 'failed',
            interpretationSource: 'ai_interpreter',
            stateMutationSource: 'none',
            failure: expect.objectContaining({
              category: 'provider_error',
              message: 'A message was too long.',
            }),
          }),
        }),
        expect.objectContaining({
          kind: 'turn',
          role: 'assistant',
          responseSource: 'system',
        }),
      ]));
      expect(entries).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ eventType: 'fallback_used' }),
      ]));
    });
  });
});
