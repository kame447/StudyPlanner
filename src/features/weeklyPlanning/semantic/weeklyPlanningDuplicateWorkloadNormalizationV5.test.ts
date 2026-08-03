import { describe, expect, it } from 'vitest';
import {
  normalizeExactDuplicateWorkloadPlacementV5,
} from './weeklyPlanningDuplicateWorkloadNormalizationV5';

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
    sourceText: `作業を${amount}時間`,
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
