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

  it('records an empty semantic provider response as a failed interpreter completion', async () => {
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
            status: 'failed',
            interpretationSource: 'ai_interpreter',
            stateMutationSource: 'none',
            failure: expect.objectContaining({ category: 'invalid_response' }),
          }),
        }),
      ]));
      expect(JSON.stringify(entries)).not.toContain(rawResponse);
    });
  });


  it('persists raw-response metadata without storing the AI response body', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const rawResponse = JSON.stringify({
      candidates: [{
        type: 'set_planning_range',
        range: {
          startDateTime: '2026-07-22T00:00:00',
          endDateTime: '2026-07-22T24:00:00',
          confidence: 'explicit',
        },
        sourceText: '今日',
        confidence: 'high',
      }],
      privateMarker: 'must-not-be-persisted',
    });

    await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(input({
      async interpretUserTurn() {
        return {
          candidates: [{
            command: {
              type: 'set_planning_range',
              range: {
                startDateTime: '2026-07-22T00:00:00',
                endDateTime: '2026-07-22T24:00:00',
                confidence: 'explicit',
              },
              sourceText: '今日',
              confidence: 'high',
            },
            origin: 'ai_interpreter',
            needsConfirmation: false,
          }],
          parseRejections: [],
          rawResponse,
        };
      },
    }), { userId: 'user-1', conversationId: 'conversation-redaction', dialoguePlanner });

    await waitForTrace(async () => {
      const [session] = await repository.listSessionsForAdmin();
      const entries = await repository.listEntries('user-1', session!.id);
      const interpreterEntry = entries.find((entry) =>
        entry.kind === 'internal_event' && entry.eventType === 'interpreter_completed'
      );
      expect(interpreterEntry).toMatchObject({
        kind: 'internal_event',
        payload: expect.objectContaining({ rawResponseLength: rawResponse.length }),
      });
      expect(JSON.stringify(entries)).not.toContain('must-not-be-persisted');
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
