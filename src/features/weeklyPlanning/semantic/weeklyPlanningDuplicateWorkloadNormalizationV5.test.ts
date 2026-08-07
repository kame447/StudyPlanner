import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  normalizeExactDuplicateWorkloadPlacementV5,
} from './weeklyPlanningDuplicateWorkloadNormalizationV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function workload(localId: string, amount = 2) {
  return {
    localId,
    quantityRole: 'target',
    amount,
    unitCode: 'hour',
    unitLabel: '時間',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    sourceText: `分野1を${amount}時間`,
  };
}

function response(params: {
  taskWorkloads: unknown[];
  componentWorkloads: unknown[][];
}): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      category: 'study',
      title: '学習',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: params.componentWorkloads.map((workloads, index) => ({
          localId: `component-${index + 1}`,
          parentLocalId: null,
          role: 'subject',
          label: `分野${index + 1}`,
          workloads,
          sourceText: `分野${index + 1}`,
        })),
      },
      workloads: params.taskWorkloads,
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '学習',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('Stable V5 duplicate workload placement normalization', () => {
  it('removes an exactly identical task-level copy when one component owns it', () => {
    const duplicated = workload('workload-1');
    const result = normalizeExactDuplicateWorkloadPlacementV5(response({
      taskWorkloads: [duplicated],
      componentWorkloads: [[{ ...duplicated }]],
    }));
    const parsed = JSON.parse(result.rawResponse) as {
      tasks: Array<{ workloads: unknown[]; study: { components: Array<{ workloads: unknown[] }> } }>;
    };

    expect(parsed.tasks[0]?.workloads).toEqual([]);
    expect(parsed.tasks[0]?.study.components[0]?.workloads).toEqual([duplicated]);
    expect(result.repairs).toEqual([
      'duplicate-workload-removed-from-task:task-1:workload-1',
    ]);
  });

  it('accepts the normalized document without a second provider request', async () => {
    const duplicated = workload('workload-1');
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => response({
        taskWorkloads: [duplicated],
        componentWorkloads: [[{ ...duplicated }]],
      })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '分野1を2時間進めます',
      traceRequestId: 'duplicate-workload-receiver',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0]?.workloads).toEqual([]);
    expect(result.document?.tasks[0]?.study?.components[0]?.workloads).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
      algorithmicRepairs: [
        'duplicate-workload-removed-from-task:task-1:workload-1',
      ],
    });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not remove conflicting facts that happen to reuse one local ID', () => {
    const rawResponse = response({
      taskWorkloads: [workload('workload-1', 2)],
      componentWorkloads: [[workload('workload-1', 3)]],
    });

    expect(normalizeExactDuplicateWorkloadPlacementV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });

  it('does not choose an owner when the same fact appears in multiple components', () => {
    const duplicated = workload('workload-1');
    const rawResponse = response({
      taskWorkloads: [duplicated],
      componentWorkloads: [[{ ...duplicated }], [{ ...duplicated }]],
    });

    expect(normalizeExactDuplicateWorkloadPlacementV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });

  it('leaves unrelated task and component workloads unchanged', () => {
    const rawResponse = response({
      taskWorkloads: [workload('workload-task')],
      componentWorkloads: [[workload('workload-component')]],
    });

    expect(normalizeExactDuplicateWorkloadPlacementV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });

  it('leaves invalid JSON untouched for normal validation', () => {
    expect(normalizeExactDuplicateWorkloadPlacementV5('not-json')).toEqual({
      rawResponse: 'not-json',
      repairs: [],
    });
  });
});
