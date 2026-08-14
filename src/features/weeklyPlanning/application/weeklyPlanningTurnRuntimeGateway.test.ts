import { describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import {
  createWeeklyPlanningTurnRuntimeGateway,
} from './weeklyPlanningTurnRuntimeGateway';
import type { WeeklyPlanningEntryRoutingTrace } from '../entry/weeklyPlanningEntryRouter';

const pending = {
  conversationId: 'conversation-1',
  turnId: 'conversation-1:turn:1',
  requestId: 'conversation-1:request:1',
  weekStartDate: '2026-09-07',
  baseRevision: 0,
  startedAt: '2026-08-11T05:55:30.000Z',
};

describe('weeklyPlanningTurnRuntimeGateway', () => {
  it('binds runtime scope and derives request clock before executing the public turn runtime', async () => {
    const executeTurn = vi.fn(async () => ({
      state: createInitialPlanningIntakeState(),
      message: '確認しました。',
      draftCandidates: [],
    }));
    const bindStableV5SessionScope = vi.fn();
    const gateway = createWeeklyPlanningTurnRuntimeGateway({
      executeTurn,
      bindStableV5SessionScope,
    });
    const snapshot = createInitialPlanningState('2026-09-07');
    const entryRoutingTrace = {
      decision: 'weekly_planning',
      requestBytes: 512,
      request: {
        messages: [],
        temperature: 0,
        responseFormat: {
          type: 'json_schema',
          json_schema: { name: 'entry_route', schema: {}, strict: true },
        },
        purpose: 'weekly_planning_interpreter',
        maxCompletionTokens: 40,
      },
      responseLength: 30,
      rawResponse: '{"decision":"weekly_planning"}',
    } satisfies WeeklyPlanningEntryRoutingTrace;

    await gateway.execute({
      snapshot,
      pending,
      userText: '来週の予定を立てたい',
      selectedDate: '2026-09-10',
      userId: 'user-1',
      plans: [],
      scheduleTemplates: [],
      weekStartsOn: 'monday',
      timeZone: 'Asia/Tokyo',
      entryRoutingTrace,
    });

    expect(bindStableV5SessionScope).toHaveBeenCalledWith({
      ownerId: 'user-1',
      weekStartDate: '2026-09-07',
      conversationId: 'conversation-1',
    });
    expect(executeTurn).toHaveBeenCalledWith(expect.objectContaining({
      previousState: undefined,
      messages: [],
      userText: '来週の予定を立てたい',
      selectedDate: '2026-09-10',
      userId: 'user-1',
      conversationId: 'conversation-1',
      traceRequestId: 'conversation-1:request:1',
      weekStartsOn: 'monday',
      requestContext: {
        startedAtIso: '2026-08-11T05:55:30.000Z',
        timeZone: 'Asia/Tokyo',
        currentDate: '2026-08-11',
        currentTime: '14:55',
        notBeforeDate: '2026-08-11',
        notBeforeTime: '14:56',
        weekStartsOn: 'monday',
      },
      entryRoutingTrace,
    }));
  });

  it('uses the authenticated user id for the runtime scope and execution input', async () => {
    const executeTurn = vi.fn(async () => ({
      state: createInitialPlanningIntakeState(),
      message: '確認しました。',
      draftCandidates: [],
    }));
    const bindStableV5SessionScope = vi.fn();
    const gateway = createWeeklyPlanningTurnRuntimeGateway({
      executeTurn,
      bindStableV5SessionScope,
    });

    await gateway.execute({
      snapshot: createInitialPlanningState('2026-09-07'),
      pending,
      userText: '続けて',
      selectedDate: '2026-09-10',
      userId: 'authenticated-user',
      plans: [],
      scheduleTemplates: [],
    });

    expect(bindStableV5SessionScope).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'authenticated-user',
    }));
    expect(executeTurn).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'authenticated-user',
    }));
  });
});
