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
  normalizePlanningWindowCanonicalV5,
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

  it('normalizes a source-grounded alias or wrong valid value deterministically', () => {
    const alias = document({
      kind: 'relative_day',
      value: 'next_day',
      sourceText: '次の日',
    }).planningWindow;
    const mismatch = document({
      kind: 'relative_week',
      value: 'this_week',
      sourceText: '翌週',
    }).planningWindow;

    expect(normalizePlanningWindowCanonicalV5(alias)).toMatchObject({
      window: { kind: 'relative_day', value: 'tomorrow' },
      repairs: [
        'planning-window-source-canonicalized:planning-window-1:relative_day:next_day->relative_day:tomorrow',
      ],
    });
    expect(normalizePlanningWindowCanonicalV5(mismatch)).toMatchObject({
      window: { kind: 'relative_week', value: 'next_week' },
    });
  });

  it('leaves ungrounded aliases for validation rather than guessing', () => {
    const window = document({
      kind: 'relative_day',
      value: 'next_day',
      sourceText: '次の期間',
    }).planningWindow;

    expect(normalizePlanningWindowCanonicalV5(window)).toEqual({
      window,
      repairs: [],
    });
    expect(planningWindowCanonicalValueErrors(window)).toEqual([
      'document.planningWindow.value:canonical-relative-day:next_day',
    ]);
  });

  it.each([
    {
      userText: '次の日の勉強計画を立てたいです',
      kind: 'relative_day' as const,
      value: 'day_after_tomorrow',
      canonicalValue: 'tomorrow',
      sourceText: '次の日',
    },
    {
      userText: '翌週の予定を組みたいです',
      kind: 'relative_week' as const,
      value: 'following_week',
      canonicalValue: 'next_week',
      sourceText: '翌週',
    },
  ])('normalizes $userText without a second AI request', async (testCase) => {
    const initial = document({
      kind: testCase.kind,
      value: testCase.value,
      sourceText: testCase.sourceText,
    });
    const fake = fakeClient([JSON.stringify(initial)]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: testCase.userText,
      traceRequestId: `canonical-window-${testCase.value}`,
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toMatchObject({
      kind: testCase.kind,
      value: testCase.canonicalValue,
    });
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
    });
    expect(result.diagnostics.algorithmicRepairs).toHaveLength(1);
    expect(fake.calls).toHaveLength(1);

    const initialMessages = fake.calls[0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(initialMessages[0]?.content).not.toContain(
      '次の日, 翌日, and 明日 mean tomorrow',
    );
    expect(initialMessages[0]?.content).not.toContain('following_week');
  });

  it('uses a targeted repair only when source evidence cannot determine the canonical value', async () => {
    const invalid = document({
      kind: 'relative_day',
      value: 'next_day',
      sourceText: '次の期間',
    });
    const repaired = document({
      kind: 'relative_day',
      value: 'tomorrow',
      sourceText: '次の期間',
    });
    const fake = fakeClient([
      JSON.stringify(invalid),
      JSON.stringify(repaired),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: '次の期間の計画を作りたいです',
      traceRequestId: 'canonical-window-ungrounded-alias',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: [
        'document.planningWindow.value:canonical-relative-day:next_day',
      ],
    });

    const repairMessages = fake.calls[1].messages as Array<{
      role: string;
      content: string;
    }>;
    const payload = JSON.parse(
      repairMessages[repairMessages.length - 1]?.content ?? '{}',
    ) as { requiredChanges?: string[] };
    expect(payload.requiredChanges).toEqual([
      'Correct only the planning-window kind or value required by the source meaning and listed error.',
    ]);
  });
});
