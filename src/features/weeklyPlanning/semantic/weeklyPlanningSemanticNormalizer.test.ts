import { describe, expect, it } from 'vitest';
import type {
  OpenAiCompatibleClient,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';
import { createWeeklyPlanningSemanticNormalizer } from './weeklyPlanningSemanticNormalizer';

function createValidDocument(): WeeklyPlanningSemanticDocument {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 'task-1',
        category: 'study',
        title: '簿記の問題集',
        study: {
          purpose: 'exam',
          contextLabel: '簿記試験',
          components: [
            {
              localId: 'component-1',
              parentLocalId: null,
              role: 'material',
              label: '問題集',
              workloads: [
                {
                  localId: 'workload-1',
                  quantityRole: 'target',
                  amount: 20,
                  unitCode: 'problem',
                  unitLabel: '問',
                  rangeStart: null,
                  rangeEnd: null,
                  perOccurrence: false,
                  periodExpression: null,
                  sourceText: '20問進めたい',
                },
              ],
              sourceText: '簿記の問題集',
            },
          ],
        },
        workloads: [],
        effortEstimates: [
          {
            localId: 'effort-1',
            targetLocalId: 'component-1',
            kind: 'duration_per_unit',
            minutes: 10,
            unitCode: 'problem',
            precision: 'approximate',
            sourceText: '1問10分くらい',
          },
        ],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '簿記の問題集を20問進めたいです。1問10分くらいかかります。',
      },
    ],
    relations: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

interface CallRecord {
  purpose?: string;
  responseFormat?: JsonSchemaResponseFormat;
  messages: Array<{ role: string; content: string }>;
}

function createFakeClient(sequence: Array<string | Error>): {
  client: OpenAiCompatibleClient;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  let index = 0;
  const client: OpenAiCompatibleClient = {
    async createChatCompletion(input) {
      calls.push({
        purpose: input.purpose,
        responseFormat: input.responseFormat,
        messages: input.messages,
      });
      const value = sequence[index];
      index += 1;
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error('fake client sequence exhausted');
      return value;
    },
  };
  return { client, calls };
}

describe('weekly planning semantic normalizer', () => {
  it('accepts a valid first response with the dedicated purpose and schema', async () => {
    const { client, calls } = createFakeClient([JSON.stringify(createValidDocument())]);
    const result = await createWeeklyPlanningSemanticNormalizer(client).normalize({
      userText: '簿記の問題集を20問進めたいです。1問10分くらいかかります。',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0].title).toBe('簿記の問題集');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
      providerError: null,
    });
    expect(result.diagnostics.requestBytes[0]).toBeGreaterThan(0);
    expect(result.diagnostics.responseLengths).toEqual([
      JSON.stringify(createValidDocument()).length,
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].purpose).toBe('weekly_planning_semantic_normalizer');
    expect(calls[0].responseFormat?.json_schema.name)
      .toBe('weekly_planning_semantic_document_v5_alpha1');
  });

  it('repairs one invalid response and accepts the corrected document', async () => {
    const valid = JSON.stringify(createValidDocument());
    const { client, calls } = createFakeClient(['{"schemaVersion":"wrong"}', valid]);
    const result = await createWeeklyPlanningSemanticNormalizer(client).normalize({
      userText: '簿記を進めたい',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      providerError: null,
    });
    expect(result.diagnostics.validationErrors).toContain('document.schemaVersion');
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.at(-2)).toMatchObject({
      role: 'assistant',
      content: '{"schemaVersion":"wrong"}',
    });
    expect(calls[1].messages.at(-1)?.content).toContain('validationErrors');
  });

  it('rejects after one repair when both responses remain invalid', async () => {
    const { client, calls } = createFakeClient(['not-json', '{}']);
    const result = await createWeeklyPlanningSemanticNormalizer(client).normalize({
      userText: '予定を立てたい',
    });

    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.attemptCount).toBe(2);
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.diagnostics.validationErrors).toEqual(expect.arrayContaining([
      'initial:document:invalid-json',
      'repair:document.missing-key:schemaVersion',
    ]));
    expect(calls).toHaveLength(2);
  });

  it('fails closed on the initial provider error without a parser fallback', async () => {
    const { client, calls } = createFakeClient([new Error('provider unavailable')]);
    const result = await createWeeklyPlanningSemanticNormalizer(client).normalize({
      userText: '来週の予定を立てたい',
    });

    expect(result).toMatchObject({
      status: 'provider_failure',
      document: null,
      diagnostics: {
        attemptCount: 1,
        repairAttempted: false,
        validationErrors: [],
        providerError: 'provider unavailable',
      },
    });
    expect(calls).toHaveLength(1);
  });

  it('fails closed when the repair provider call fails', async () => {
    const { client, calls } = createFakeClient([
      'not-json',
      new Error('repair unavailable'),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizer(client).normalize({
      userText: '今日の計画を立てたい',
    });

    expect(result).toMatchObject({
      status: 'provider_failure',
      document: null,
      diagnostics: {
        attemptCount: 2,
        repairAttempted: true,
        validationErrors: ['document:invalid-json'],
        providerError: 'repair unavailable',
      },
    });
    expect(calls).toHaveLength(2);
  });

  it('does not expose or persist raw AI response text in diagnostics', async () => {
    const raw = JSON.stringify(createValidDocument());
    const { client } = createFakeClient([raw]);
    const result = await createWeeklyPlanningSemanticNormalizer(client).normalize({
      userText: '簿記を進めたい',
    });

    const diagnostics = result.diagnostics as unknown as Record<string, unknown>;
    expect(diagnostics.rawResponse).toBeUndefined();
    expect(diagnostics.rawContent).toBeUndefined();
    expect(JSON.stringify(diagnostics)).not.toContain('簿記の問題集');
    expect(diagnostics.responseLengths).toEqual([raw.length]);
  });
});
