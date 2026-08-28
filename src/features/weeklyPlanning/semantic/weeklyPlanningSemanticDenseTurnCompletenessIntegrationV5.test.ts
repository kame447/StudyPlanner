import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

function semanticDocument(taskTitles: string[]): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: taskTitles.map((title, index) => ({
      localId: `task-${index + 1}`,
      existingPublicId: null,
      decompositionStatus: 'atomic',
      category: 'study',
      title,
      study: {
        purpose: 'self_study',
        activityKind: 'unknown',
        contextLabel: title,
        components: [],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: title,
    })),
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
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
        const response = sequence[index++];
        if (response === undefined) throw new Error('fake sequence exhausted');
        return response;
      },
    },
  };
}

const denseUserText = [
  '数学を進めたいです。物理も進めたいです。化学も進めたいです。英語は毎日やりたいです。',
  '平日は18時から22時まで勉強できます。9月末までに終わらせたいです。',
].join('').repeat(12);

describe('Stable V5 dense-turn completeness orchestration', () => {
  it('retries a schema-valid partial document when the AI coverage audit reports omissions', async () => {
    const partial = semanticDocument(['数学']);
    const complete = semanticDocument(['数学', '物理', '化学', '英語']);
    const fake = fakeClient([
      JSON.stringify(partial),
      JSON.stringify({
        decision: 'incomplete',
        missingFacts: ['物理・化学・英語の学習タスク', '平日の学習可能時間'],
      }),
      JSON.stringify(complete),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: denseUserText,
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks.map((task) => task.title)).toEqual([
      '数学',
      '物理',
      '化学',
      '英語',
    ]);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: false,
      providerError: null,
    });
    expect(fake.calls).toHaveLength(3);
    const auditFormat = fake.calls[1]?.responseFormat as { json_schema?: { name?: string } } | undefined;
    expect(auditFormat?.json_schema?.name).toBe('weekly_planning_dense_turn_completeness_audit_v5');
    expect(fake.calls[2]?.maxCompletionTokens).toBe(6400);
    const retryMessages = fake.calls[2]?.messages as Array<{ role: string; content: string }>;
    expect(retryMessages[retryMessages.length - 1]?.content).toContain(
      'one complete semantic document, not a patch',
    );
  });

  it('keeps the initial dense document when the audit says coverage is complete', async () => {
    const complete = semanticDocument(['数学', '物理']);
    const fake = fakeClient([
      JSON.stringify(complete),
      JSON.stringify({ decision: 'complete', missingFacts: [] }),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: denseUserText,
    });

    expect(result.status).toBe('accepted');
    expect(result.document).toEqual(complete);
    expect(result.diagnostics.attemptCount).toBe(1);
    expect(fake.calls).toHaveLength(2);
  });
});
