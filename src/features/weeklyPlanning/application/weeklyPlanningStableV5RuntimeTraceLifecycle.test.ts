import { beforeEach, describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_ENTRY_ROUTER_RESPONSE_FORMAT,
  createWeeklyPlanningEntryRouterMessages,
} from '../entry/weeklyPlanningEntryRouter';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import { weeklyPlanningStableV5RuntimeTraceLifecycle } from './weeklyPlanningStableV5RuntimeTraceLifecycle';

describe('Stable V5 runtime entry-routing trace', () => {
  beforeEach(() => resetWeeklyPlanningStableV5DebugTraceForTest());

  it('captures the focused provider request, raw response and validated decision on the first weekly turn', () => {
    weeklyPlanningStableV5RuntimeTraceLifecycle.start({
      messages: [],
      userText: '来週の勉強予定を立てたい',
      selectedDate: '2026-08-14',
      userId: 'owner-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-entry-route',
      traceRequestId: 'request-entry-route',
      entryRoutingTrace: {
        decision: 'weekly_planning',
        requestBytes: 512,
        request: {
          messages: createWeeklyPlanningEntryRouterMessages('来週の勉強予定を立てたい'),
          temperature: 0,
          responseFormat: WEEKLY_PLANNING_ENTRY_ROUTER_RESPONSE_FORMAT,
          purpose: 'weekly_planning_interpreter',
          maxCompletionTokens: 40,
        },
        responseLength: 30,
        rawResponse: '{"decision":"weekly_planning"}',
      },
    });

    expect(takeWeeklyPlanningStableV5DebugTrace('request-entry-route')).toEqual([
      expect.objectContaining({
        stage: 'runtime_turn_input',
        data: expect.objectContaining({ entryRoute: 'weekly_planning' }),
      }),
      expect.objectContaining({
        stage: 'semantic_provider_request',
        data: expect.objectContaining({
          attempt: 'entry_routing',
          requestBytes: 512,
          request: expect.objectContaining({ purpose: 'weekly_planning_interpreter' }),
        }),
      }),
      expect.objectContaining({
        stage: 'semantic_provider_response',
        data: expect.objectContaining({
          attempt: 'entry_routing',
          rawResponse: '{"decision":"weekly_planning"}',
        }),
      }),
      expect.objectContaining({
        stage: 'semantic_validation_result',
        data: expect.objectContaining({
          attempt: 'entry_routing',
          accepted: true,
          parsedDocument: { decision: 'weekly_planning' },
        }),
      }),
    ]);
  });
});
