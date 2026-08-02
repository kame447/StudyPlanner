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

function baseDocument(tasks: SemanticTaskV5[]): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
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

function groupedInvalidDocument(): WeeklyPlanningSemanticDocumentV5 {
  return baseDocument([{
    localId: 'task-grouped',
    category: 'study',
    title: '英語',
    study: {
      purpose: 'self_study',
      contextLabel: null,
      components: [
        {
          localId: 'component-english',
          parentLocalId: null,
          role: 'subject',
          label: '英語',
          workloads: [{
            localId: 'workload-english',
            quantityRole: 'declared',
            amount: 2,
            unitCode: 'hour',
            unitLabel: '時間',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '英語を2時間',
          }],
          sourceText: '英語',
        },
        {
          localId: 'component-math',
          parentLocalId: null,
          role: 'subject',
          label: '数学',
          workloads: [{
            localId: 'workload-math',
            quantityRole: 'declared',
            amount: 3,
            unitCode: 'hour',
            unitLabel: '時間',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '数学を3時間',
          }],
          sourceText: '数学',
        },
      ],
    },
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: '英語を2時間、数学を3時間',
  }]);
}

function independentTasksDocument(): WeeklyPlanningSemanticDocumentV5 {
  return baseDocument([
    {
      localId: 'task-english',
      category: 'study',
      title: '英語',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-english',
        quantityRole: 'declared',
        amount: 2,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '英語を2時間',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '英語を2時間',
    },
    {
      localId: 'task-math',
      category: 'study',
      title: '数学',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-math',
        quantityRole: 'declared',
        amount: 3,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '数学を3時間',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学を3時間',
    },
  ]);
}

function fakeClient(sequence: string[]) {
  const calls: Array<Record<string, unknown>> = [];
  let index = 0;
  const client: OpenAiCompatibleClient = {
    async createChatCompletion(input) {
      calls.push(input as unknown as Record<string, unknown>);
      const response = sequence[index++];
      if (response === undefined) throw new Error('fake response sequence exhausted');
      return response;
    },
  };
  return { client, calls };
}

describe('Stable V5 semantic normalizer task boundary repair', () => {
  it('repairs independent quantified subjects into separate top-level tasks', async () => {
    const fake = fakeClient([
      JSON.stringify(groupedInvalidDocument()),
      JSON.stringify(independentTasksDocument()),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: '来週、英語を2時間、数学を3時間やりたいです',
      traceRequestId: 'task-boundary-repair',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks.map((task) => task.title)).toEqual(['英語', '数学']);
    expect(result.document?.tasks.map((task) => task.workloads[0]?.amount)).toEqual([2, 3]);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: [
        'document.tasks.task-grouped:parent-title-collides-with-subject:英語',
        'document.tasks.task-grouped:multiple-subjects-require-shared-context:英語|数学',
      ],
    });
    expect(fake.calls).toHaveLength(2);

    const initialMessages = fake.calls[0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(initialMessages[0]?.content).toContain(
      'create separate top-level tasks rather than sibling subject components',
    );

    const repairMessages = fake.calls[1].messages as Array<{
      role: string;
      content: string;
    }>;
    const repairInstruction = repairMessages[repairMessages.length - 1]?.content ?? '';
    expect(repairInstruction).toContain('parent-title-collides-with-subject');
    expect(repairInstruction).toContain('split the independent subjects into separate top-level tasks');
  });
});
