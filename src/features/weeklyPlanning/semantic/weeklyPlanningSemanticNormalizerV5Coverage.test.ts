import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function task(title: string, hours: number): SemanticTaskV5 {
  return {
    localId: `task-${title}`,
    category: 'study',
    title,
    study: {
      purpose: 'self_study',
      contextLabel: null,
      components: [],
    },
    workloads: [{
      localId: `workload-${title}`,
      quantityRole: 'declared',
      amount: hours,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: `${title}を${hours}時間`,
    }],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: `${title}を${hours}時間`,
  };
}

function document(tasks: SemanticTaskV5[]): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-next-week',
      kind: 'relative_week',
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週',
    },
    tasks,
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function fakeClient(sequence: WeeklyPlanningSemanticDocumentV5[]) {
  const calls: Array<Record<string, unknown>> = [];
  let index = 0;
  const client: OpenAiCompatibleClient = {
    async createChatCompletion(input) {
      calls.push(input as unknown as Record<string, unknown>);
      const response = sequence[index++];
      if (!response) throw new Error('fake response sequence exhausted');
      return JSON.stringify(response);
    },
  };
  return { client, calls };
}

describe('Stable V5 semantic normalizer direct work coverage repair', () => {
  it('repairs a schema-valid response that silently dropped one quantified task', async () => {
    const fake = fakeClient([
      document([task('英語', 2)]),
      document([task('英語', 2), task('数学', 3)]),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: '来週、英語を2時間、数学を3時間やる予定を作ってください',
      traceRequestId: 'direct-work-coverage-repair',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks.map((item) => item.title)).toEqual(['英語', '数学']);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: [
        'document.tasks:direct-work-omitted:数学:3:hour',
      ],
    });
    expect(fake.calls).toHaveLength(2);

    const systemMessages = fake.calls[0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(systemMessages[0]?.content).toContain(
      'Preserve every independently quantified work item',
    );

    const repairMessages = fake.calls[1].messages as Array<{
      role: string;
      content: string;
    }>;
    const repairInstruction = repairMessages[repairMessages.length - 1]?.content ?? '';
    expect(repairInstruction).toContain('direct-work-omitted:数学:3:hour');
    expect(repairInstruction).toContain('restore every omitted explicitly quantified work item');
  });
});
