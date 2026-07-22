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
