import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [
      {
        localId: 'availability-1',
        kind: 'unavailable',
        dateExpression: null,
        namedTimePeriod: null,
        startTime: null,
        endTime: '18:00',
        recurrenceKind: 'weekdays',
        days: [],
        constraintLevel: 'hard',
        sourceText: '平日は18時まで勉強できない',
      },
    ],
    constraintSourceRequests: [
      {
        localId: 'source-1',
        kind: 'timetable',
        selector: 'active',
        requestedAction: 'use',
        sourceText: '時間割も使って',
      },
    ],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function tomorrowPlanningDocument(
  includePlanningWindow: boolean,
): WeeklyPlanningSemanticDocumentV5 {
  return {
    ...document(),
    planningWindow: includePlanningWindow
      ? {
          localId: 'window-tomorrow',
          kind: 'relative_day',
          value: 'tomorrow',
          start: null,
          end: null,
          sourceText: '明日',
        }
      : null,
    availabilityDeclarations: [],
    constraintSourceRequests: [],
  };
}

function priorityDocument(params: {
  invalidTemporalConstraint: boolean;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-today',
      kind: 'absolute',
      value: '2026-07-30',
      start: '2026-07-30',
      end: '2026-07-30',
      sourceText: '今日中に',
    },
    tasks: [
      {
        localId: 'task-research',
        category: 'study',
        title: '卒業研究',
        study: {
          purpose: 'research',
          contextLabel: '卒業研究',
          components: [],
        },
        workloads: [
          {
            localId: 'workload-research',
            quantityRole: 'target',
            amount: 4,
            unitCode: 'hour',
            unitLabel: '時間',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '卒業研究を4時間',
          },
        ],
        effortEstimates: [],
        temporalConstraints: params.invalidTemporalConstraint
          ? [
              {
                localId: 'constraint-research-priority',
                targetLocalId: 'task-research',
                kind: 'earliest_start',
                constraintLevel: 'unknown',
                dateExpression: 'today',
                namedTimePeriod: 'morning',
                startTime: null,
                endTime: null,
                precision: 'unspecified',
                sourceText: '優先順位は卒業研究',
              },
            ]
          : [],
        recurrence: [],
        sourceText: '卒業研究を4時間',
      },
      {
        localId: 'task-planner',
        category: 'non_study',
        title: 'StudyPlannerのログ確認',
        study: null,
        workloads: [
          {
            localId: 'workload-planner',
            quantityRole: 'target',
            amount: 2,
            unitCode: 'hour',
            unitLabel: '時間',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: 'StudyPlannerのログ確認を2時間',
          },
        ],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: 'StudyPlannerのログ確認を2時間',
      },
    ],
    relations: [
      {
        localId: 'priority-research-planner',
        kind: 'priority_over',
        fromLocalId: 'task-research',
        toLocalId: 'task-planner',
        sourceText: '優先順位は卒業研究、StudyPlannerの順',
      },
    ],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function client(sequence: Array<string | Error>): {
  value: OpenAiCompatibleClient;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  let index = 0;
  return {
    calls,
    value: {
      async createChatCompletion(input) {
        calls.push(input as unknown as Record<string, unknown>);
        const next = sequence[index++];
        if (next instanceof Error) throw next;
        if (next === undefined) throw new Error('fake sequence exhausted');
        return next;
      },
    },
  };
}

describe('Stable V5 semantic normalizer', () => {
  it('uses the direct Stable V5 schema and records version metadata', async () => {
    const raw = JSON.stringify(document());
    const fake = client([raw]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '平日は18時まで勉強できません。時間割も使ってください。',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.availabilityDeclarations).toHaveLength(1);
    expect(result.document?.constraintSourceRequests).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: 'weekly_planning_semantic_document_v5',
      normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
      attemptCount: 1,
      repairAttempted: false,
      providerError: null,
    });
    expect(fake.calls[0]).toMatchObject({
      purpose: 'weekly_planning_semantic_normalizer',
      maxCompletionTokens: 3200,
    });
    const responseFormat = fake.calls[0].responseFormat as {
      json_schema?: { name?: string };
    };
    expect(responseFormat.json_schema?.name).toBe('weekly_planning_semantic_document_v5');
  });

  it('preserves discontinuous dates and expands weekday ranges in the prompt', async () => {
    const fake = client([JSON.stringify(document())]);
    await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '7月8日、10日、11日と、水曜と金曜から日曜にやりたい',
    });

    const messages = fake.calls[0].messages as Array<{ role: string; content: string }>;
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('one allowed_date temporal constraint per date');
    expect(system).toContain('Do not collapse gaps into a continuous date range');
    expect(system).toContain('水曜と金曜から日曜 becomes days [wed, fri, sat, sun]');
    expect(system).toContain('one recurrence fact');
    expect(system).toContain('Priority and ordering statements describe task relations only');
    expect(system).toContain('Never invent a clock time from priority');
    expect(system).toContain('namedTimePeriod must be null');
    expect(system).toContain('Do not omit a whole-plan planningWindow');
  });

  it('repairs an omitted 明日 planning window instead of asking for the range again', async () => {
    const omitted = JSON.stringify(tomorrowPlanningDocument(false));
    const repaired = JSON.stringify(tomorrowPlanningDocument(true));
    const fake = client([omitted, repaired]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '明日の予定立てたいです',
      traceRequestId: 'trace-tomorrow-window-repair',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toMatchObject({
      kind: 'relative_day',
      value: 'tomorrow',
    });
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: ['document.planningWindow:direct-user-range-omitted:tomorrow'],
    });
    expect(fake.calls).toHaveLength(2);
    const repairMessages = fake.calls[1].messages as Array<{ role: string; content: string }>;
    const repairInstruction = repairMessages[repairMessages.length - 1]?.content ?? '';
    expect(repairInstruction).toContain('direct-user-range-omitted');
    expect(repairInstruction).toContain('relative_day/tomorrow for 明日');
  });

  it('repairs a short 明日 answer from machine pending state without reading rendered wording', async () => {
    const fake = client([
      JSON.stringify(tomorrowPlanningDocument(false)),
      JSON.stringify(tomorrowPlanningDocument(true)),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '明日',
      recentConversation: [{
        role: 'assistant',
        content: '対象範囲だけ先に決めさせてください。',
      }],
      publicStateSummary: {
        lastAssistantMessage: '期間判定用の固定文言を含まない',
        pendingQuestion: {
          actionId: 'stable-v5:turn-1:invalid_planning_horizon',
          questionCode: 'invalid_planning_horizon',
          targetFactId: null,
          graphRevision: 0,
        },
      },
      traceRequestId: 'trace-machine-pending-window',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toMatchObject({
      kind: 'relative_day',
      value: 'tomorrow',
    });
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: ['document.planningWindow:direct-user-range-omitted:tomorrow'],
    });
    const requestMessages = fake.calls[0].messages as Array<{ role: string; content: string }>;
    const requestPayload = JSON.parse(requestMessages[1].content) as {
      publicStateSummary?: Record<string, unknown>;
    };
    expect(requestPayload.publicStateSummary).toMatchObject({
      pendingQuestion: {
        questionCode: 'invalid_planning_horizon',
        graphRevision: 0,
      },
    });
  });

  it('does not infer a planning window from rendered wording without machine pending state', async () => {
    const fake = client([JSON.stringify(tomorrowPlanningDocument(false))]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '明日',
      recentConversation: [{
        role: 'assistant',
        content: 'どの期間の予定を立てましょうか？',
      }],
      publicStateSummary: {},
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toBeNull();
    expect(result.diagnostics.repairAttempted).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });

  it('does not promote a task-specific 明日 into the whole-plan planning window', async () => {
    const fake = client([JSON.stringify(document())]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '数学は明日やる',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toBeNull();
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('repairs at most once and never falls back to a parser', async () => {
    const fake = client(['not-json', JSON.stringify(document())]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '時間割も使って',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: ['document:invalid-json'],
    });
    expect(fake.calls).toHaveLength(2);
    const repairMessages = fake.calls[1].messages as Array<{ role: string; content: string }>;
    const repairInstruction = repairMessages[repairMessages.length - 1]?.content ?? '';
    expect(repairInstruction).toContain('Stable V5 JSON document only');
    expect(repairInstruction).toContain('save decisions');
  });

  it('repairs a priority-derived missing-start without inventing a clock', async () => {
    const invalid = JSON.stringify(priorityDocument({ invalidTemporalConstraint: true }));
    const repaired = JSON.stringify(priorityDocument({ invalidTemporalConstraint: false }));
    const fake = client([invalid, repaired]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '卒業研究を4時間、StudyPlannerのログ確認を2時間やりたいです。優先順位は卒業研究、StudyPlannerの順です。',
      traceRequestId: 'trace-priority-repair',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.relations).toEqual([
      expect.objectContaining({
        kind: 'priority_over',
        fromLocalId: 'task-research',
        toLocalId: 'task-planner',
      }),
    ]);
    expect(result.document?.tasks[0].temporalConstraints).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: ['document.tasks[0].temporalConstraints[0]:missing-start'],
    });

    const repairMessages = fake.calls[1].messages as Array<{ role: string; content: string }>;
    const repairInstruction = repairMessages[repairMessages.length - 1]?.content ?? '';
    expect(repairInstruction).toContain('Never invent a clock time');
    expect(repairInstruction).toContain('remove the unsupported earliest_start');
    expect(repairInstruction).toContain('Priority and ordering language must remain task relations');
    expect(repairInstruction).toContain('namedTimePeriod cannot coexist with startTime or endTime');
    expect(repairInstruction).toContain('document.tasks[0].temporalConstraints[0]:missing-start');
  });

  it('rejects when the single repair remains invalid', async () => {
    const fake = client(['not-json', '{}']);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '予定を見て',
    });

    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.attemptCount).toBe(2);
    expect(fake.calls).toHaveLength(2);
  });

  it('returns provider failure without semantic state', async () => {
    const fake = client([new Error('provider unavailable')]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '平日は無理です',
    });

    expect(result).toMatchObject({
      status: 'provider_failure',
      document: null,
      diagnostics: {
        attemptCount: 1,
        repairAttempted: false,
        providerError: 'provider unavailable',
      },
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('does not include raw response content in diagnostics', async () => {
    const raw = JSON.stringify(document());
    const fake = client([raw]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '時間割を使って',
    });

    expect(JSON.stringify(result.diagnostics)).not.toContain('時間割も使って');
    expect(result.diagnostics.responseLengths).toEqual([raw.length]);
  });
});
