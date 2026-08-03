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

function groupedDocument(): WeeklyPlanningSemanticDocumentV5 {
  return baseDocument([{
    localId: 'task-grouped',
    category: 'study',
    title: '物理',
    study: {
      purpose: 'self_study',
      contextLabel: null,
      components: [
        {
          localId: 'component-physics',
          parentLocalId: null,
          role: 'subject',
          label: '物理',
          workloads: [{
            localId: 'workload-physics',
            quantityRole: 'declared',
            amount: 2,
            unitCode: 'hour',
            unitLabel: '時間',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '物理を2時間',
          }],
          sourceText: '物理',
        },
        {
          localId: 'component-chemistry',
          parentLocalId: null,
          role: 'subject',
          label: '化学',
          workloads: [{
            localId: 'workload-chemistry',
            quantityRole: 'declared',
            amount: 3,
            unitCode: 'hour',
            unitLabel: '時間',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '化学を3時間',
          }],
          sourceText: '化学',
        },
      ],
    },
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: '物理を2時間、化学を3時間',
  }]);
}

function fakeClient(response: WeeklyPlanningSemanticDocumentV5) {
  const calls: Array<Record<string, unknown>> = [];
  const client: OpenAiCompatibleClient = {
    async createChatCompletion(input) {
      calls.push(input as unknown as Record<string, unknown>);
      return JSON.stringify(response);
    },
  };
  return { client, calls };
}

describe('Stable V5 semantic normalizer task boundary normalization', () => {
  it('splits a structurally valid but mis-parented container without a second AI call', async () => {
    const fake = fakeClient(groupedDocument());

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText: '来週、物理を2時間、化学を3時間進めたいです',
      traceRequestId: 'task-boundary-normalization',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks.map((task) => task.title)).toEqual(['物理', '化学']);
    expect(result.document?.tasks.flatMap((task) =>
      task.study?.components.flatMap((component) =>
        component.workloads.map((workload) => workload.amount)) ?? [])).toEqual([2, 3]);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
      algorithmicRepairs: [
        'task-container-split-by-independent-roots:task-grouped',
      ],
    });
    expect(fake.calls).toHaveLength(1);

    const initialMessages = fake.calls[0].messages as Array<{
      role: string;
      content: string;
    }>;
    expect(initialMessages[0]?.content).not.toContain('物理');
    expect(initialMessages[0]?.content).not.toContain('化学');
    expect(initialMessages[0]?.content).not.toContain('split the independent subjects');
  });
});
