import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  canonicalPlanningWindowInstructionV5,
  planningWindowCanonicalValueErrors,
  relativeWindowSourceExpectationV5,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function document(params: {
  kind: 'relative_day' | 'relative_week';
  value: string;
  sourceText: string;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'planning-window-1',
      kind: params.kind,
      value: params.value,
      start: null,
      end: null,
      sourceText: params.sourceText,
    },
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function fakeClient(sequence: string[]): {
  client: OpenAiCompatibleClient;
  calls: Array<Record<string, unknown>>;
} {
  let index = 0;
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    client: {
      async createChatCompletion(input) {
        calls.push(input as unknown as Record<string, unknown>);
        const value = sequence[index++];
        if (value === undefined) throw new Error('fake sequence exhausted');
        return value;
      },
    },
  };
}

describe('Stable V5 planning window canonical contract', () => {
  it('uses one vocabulary that every relative runtime expression can resolve', () => {
    for (const expression of [
      ...CANONICAL_RELATIVE_DAY_EXPRESSIONS,
      ...CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
    ]) {
      expect(resolveCanonicalDateExpression({
        expression,
        currentDate: '2026-08-03',
      }).status).toBe('resolved');
    }
  });

  it.each([
    ['次の日', { kind: 'relative_day', value: 'tomorrow' }],
    ['翌日の予定', { kind: 'relative_day', value: 'tomorrow' }],
    ['次の次の日', { kind: 'relative_day', value: 'day_after_tomorrow' }],
    ['翌々日', { kind: 'relative_day', value: 'day_after_tomorrow' }],
    ['翌週', { kind: 'relative_week', value: 'next_week' }],
    ['次の週', { kind: 'relative_week', value: 'next_week' }],
    ['今週', { kind: 'relative_week', value: 'this_week' }],
    ['8月4日', null],
  ])('grounds source expression to one canonical meaning: %s', (sourceText, expected) => {
    expect(relativeWindowSourceExpectationV5(sourceText)).toEqual(expected);
  });

  it('rejects invented aliases and valid canonical values with the wrong source meaning', () => {
    expect(planningWindowCanonicalValueErrors(document({
      kind: 'relative_day',
      value: 'next_day',
      sourceText: '次の日',
    }).planningWindow)).toEqual([
      'document.planningWindow.value:canonical-relative-day:next_day',
    ]);
    expect(planningWindowCanonicalValueErrors(document({
      kind: 'relative_week',
      value: 'following_week',
      sourceText: '翌週',
    }).planningWindow)).toEqual([
      'document.planningWindow.value:canonical-relative-week:following_week',
    ]);
    expect(planningWindowCanonicalValueErrors(document({
      kind: 'relative_day',
      value: 'day_after_tomorrow',
      sourceText: '次の日',
    }).planningWindow)).toEqual([
      'document.planningWindow:source-meaning-mismatch:expected-relative_day:tomorrow',
    ]);
    expect(planningWindowCanonicalValueErrors(document({
      kind: 'relative_day',
      value: 'tomorrow',
      sourceText: '翌日',
    }).planningWindow)).toEqual([]);
  });

  it.each([
    {
      userText: '次の日の勉強計画を立てたいです',
      kind: 'relative_day' as const,
      invalidValue: 'next_day',
      canonicalValue: 'tomorrow',
      sourceText: '次の日',
      expectedError: 'document.planningWindow.value:canonical-relative-day:next_day',
    },
    {
      userText: '翌日の予定を作りたいです',
      kind: 'relative_day' as const,
      invalidValue: 'following_day',
      canonicalValue: 'tomorrow',
      sourceText: '翌日',
      expectedError: 'document.planningWindow.value:canonical-relative-day:following_day',
    },
    {
      userText: '翌週の予定を組みたいです',
      kind: 'relative_week' as const,
      invalidValue: 'following_week',
      canonicalValue: 'next_week',
      sourceText: '翌週',
      expectedError: 'document.planningWindow.value:canonical-relative-week:following_week',
    },
  ])('repairs a noncanonical alias for $userText', async (testCase) => {
    const invalid = document({
      kind: testCase.kind,
      value: testCase.invalidValue,
      sourceText: testCase.sourceText,
    });
    const repaired = document({
      kind: testCase.kind,
      value: testCase.canonicalValue,
      sourceText: testCase.sourceText,
    });
    const fake = fakeClient([
      JSON.stringify(invalid),
      JSON.stringify(repaired),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: testCase.userText,
      traceRequestId: `canonical-window-${testCase.invalidValue}`,
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toMatchObject({
      kind: testCase.kind,
      value: testCase.canonicalValue,
    });
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: [testCase.expectedError],
    });
    expect(fake.calls).toHaveLength(2);

    const initialMessages = fake.calls[0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(initialMessages[0]?.content).toContain(
      canonicalPlanningWindowInstructionV5(),
    );

    const repairMessages = fake.calls[1].messages as Array<{
      role: string;
      content: string;
    }>;
    const repairMessage = repairMessages[repairMessages.length - 1]?.content ?? '';
    expect(repairMessage).toContain(testCase.expectedError);
    expect(repairMessage).toContain(
      'replace the invented alias with one of the exact canonical',
    );
  });

  it('repairs a valid canonical value when it contradicts the source expression', async () => {
    const mismatch = document({
      kind: 'relative_day',
      value: 'day_after_tomorrow',
      sourceText: '次の日',
    });
    const repaired = document({
      kind: 'relative_day',
      value: 'tomorrow',
      sourceText: '次の日',
    });
    const fake = fakeClient([
      JSON.stringify(mismatch),
      JSON.stringify(repaired),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: '次の日の勉強計画を立てたいです',
      traceRequestId: 'canonical-window-source-meaning',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toMatchObject({
      kind: 'relative_day',
      value: 'tomorrow',
    });
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: [
        'document.planningWindow:source-meaning-mismatch:expected-relative_day:tomorrow',
      ],
    });
    const repairMessages = fake.calls[1].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(repairMessages[repairMessages.length - 1]?.content).toContain(
      'source-meaning-mismatch:expected-relative_day:tomorrow',
    );
  });
});
