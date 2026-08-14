import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

function invalidDocument(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [{
      localId: 'event-1',
      kind: 'goal_event',
      label: '共通テスト模試',
      value: '模試',
      dateExpression: '2週間後',
      sourceText: '2週間後に共通テスト模試がある',
    }],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('Stable V5 focused user-context date normalizer route', () => {
  it('repairs only dateExpression instead of invoking full-document generic repair', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const responses = [
      invalidDocument(),
      JSON.stringify({ dateExpression: '2026-08-28' }),
    ];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(input) {
        calls.push(input as unknown as Record<string, unknown>);
        const response = responses.shift();
        if (!response) throw new Error('response sequence exhausted');
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '2週間後に共通テスト模試がある',
      publicStateSummary: {
        calendarContext: {
          currentDate: '2026-08-14',
          timeZone: 'Asia/Tokyo',
        },
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.userContextFacts?.[0]).toMatchObject({
      kind: 'goal_event',
      label: '共通テスト模試',
      value: '模試',
      dateExpression: '2026-08-28',
      sourceText: '2週間後に共通テスト模試がある',
    });
    expect(result.document?.corrections).toEqual([]);
    expect(calls).toHaveLength(2);
    expect((calls[1].responseFormat as { json_schema?: { name?: string } })?.json_schema?.name)
      .toBe('weekly_planning_focused_user_context_date_repair_v5');
    expect(calls[1]).toMatchObject({
      maxCompletionTokens: 40,
      purpose: 'weekly_planning_semantic_normalizer',
    });
  });
});
