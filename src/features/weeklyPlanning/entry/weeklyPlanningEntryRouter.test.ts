import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_ENTRY_ROUTER_MAX_COMPLETION_TOKENS,
  WEEKLY_PLANNING_ENTRY_ROUTER_RESPONSE_FORMAT,
  createWeeklyPlanningEntryRouterMessages,
  parseWeeklyPlanningEntryRoute,
  routeWeeklyPlanningEntry,
} from './weeklyPlanningEntryRouter';

function clientReturning(rawResponse: string): OpenAiCompatibleClient {
  return {
    createChatCompletion: vi.fn(async () => rawResponse),
  };
}

describe('weekly planning entry router', () => {
  it('uses one focused Luna-purpose structured request and returns traceable semantic output', async () => {
    const client = clientReturning('{"decision":"weekly_planning"}');
    const result = await routeWeeklyPlanningEntry(
      '来週の勉強予定を立てたい',
      client,
    );

    expect(result).toMatchObject({
      decision: 'weekly_planning',
      trace: {
        decision: 'weekly_planning',
        responseLength: 30,
        rawResponse: '{"decision":"weekly_planning"}',
      },
    });
    expect(result.trace.requestBytes).toBeGreaterThan(0);
    expect(client.createChatCompletion).toHaveBeenCalledWith({
      messages: createWeeklyPlanningEntryRouterMessages('来週の勉強予定を立てたい'),
      temperature: 0,
      responseFormat: WEEKLY_PLANNING_ENTRY_ROUTER_RESPONSE_FORMAT,
      purpose: 'weekly_planning_interpreter',
      maxCompletionTokens: WEEKLY_PLANNING_ENTRY_ROUTER_MAX_COMPLETION_TOKENS,
    });
  });

  it.each([
    ['{"decision":"chat"}', 'chat'],
    ['{"decision":"weekly_planning"}', 'weekly_planning'],
    ['{"decision":"ambiguous"}', 'ambiguous'],
  ] as const)('accepts the closed route vocabulary: %s', (raw, expected) => {
    expect(parseWeeklyPlanningEntryRoute(raw)).toBe(expected);
  });

  it.each([
    '',
    'weekly_planning',
    '{"decision":"unknown"}',
    '{"decision":"chat","reason":"extra"}',
  ])('rejects non-schema output without heuristic repair: %s', (raw) => {
    expect(parseWeeklyPlanningEntryRoute(raw)).toBeNull();
  });
});
