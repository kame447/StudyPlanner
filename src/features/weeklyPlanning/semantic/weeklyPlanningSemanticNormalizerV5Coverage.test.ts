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

function task(params: {
  title: string;
  amount: number;
  unitCode: 'page' | 'problem';
  unitLabel: string;
}): SemanticTaskV5 {
  return {
    localId: `task-${params.title}`,
    category: 'study',
    title: params.title,
    study: {
      purpose: 'self_study',
      contextLabel: null,
      components: [],
    },
    workloads: [{
      localId: `workload-${params.title}`,
      quantityRole: 'declared',
      amount: params.amount,
      unitCode: params.unitCode,
      unitLabel: params.unitLabel,
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: `${params.title}を${params.amount}${params.unitLabel}`,
    }],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: `${params.title}を${params.amount}${params.unitLabel}`,
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

describe('Stable V5 semantic normalizer evidence repair', () => {
  it('requests only the missing structured evidence instead of adding a scenario rule to the base prompt', async () => {
    const report = task({
      title: 'レポート',
      amount: 4,
      unitCode: 'page',
      unitLabel: 'ページ',
    });
    const exercises = task({
      title: '演習',
      amount: 12,
      unitCode: 'problem',
      unitLabel: '問',
    });
    const fake = fakeClient([
      document([report]),
      document([report, exercises]),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: '来週、レポートを4ページ、演習を12問進める予定を作ってください',
      traceRequestId: 'explicit-evidence-repair',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks.map((item) => item.title)).toEqual([
      'レポート',
      '演習',
    ]);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: [
        'document.tasks:explicit-work-evidence-omitted:演習:12:problem',
      ],
    });
    expect(fake.calls).toHaveLength(2);

    const baseMessages = fake.calls[0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(baseMessages[0]?.content).not.toContain('レポート');
    expect(baseMessages[0]?.content).not.toContain('演習');
    expect(baseMessages[0]?.content).not.toContain('Do not drop a later coordinated item');
    expect(baseMessages[0]?.content).not.toContain('restore every omitted explicitly quantified work item');

    const repairMessages = fake.calls[1].messages as Array<{
      role: string;
      content: string;
    }>;
    const payload = JSON.parse(
      repairMessages[repairMessages.length - 1]?.content ?? '{}',
    ) as {
      requiredChanges?: string[];
      missingEvidence?: unknown[];
      validationErrors?: string[];
    };

    expect(payload.requiredChanges).toEqual([
      'Restore each listed missing evidence item without deleting or changing already valid items.',
    ]);
    expect(payload.missingEvidence).toEqual([
      { label: '演習', amount: 12, unitCode: 'problem', unitLabel: '問' },
    ]);
    expect(JSON.stringify(payload)).not.toContain('clock');
    expect(JSON.stringify(payload)).not.toContain('parent identity');
    expect(JSON.stringify(payload)).not.toContain('planning-window');
  });
});
