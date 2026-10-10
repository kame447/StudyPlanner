import { describe, expect, it, vi } from 'vitest';
import { canonicalCandidateSerialization } from '../application/candidateSelection/canonical';
import { areWeeklyPlanningJsonValuesEqual } from './weeklyPlanningJsonValueEquality';
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

  it('removes the exact same typed and evidence payload when only localId differs', () => {
    const taskCopy = workload('workload-task');
    const componentCopy = workload('workload-component');
    const result = normalizeExactDuplicateWorkloadPlacementV5(response({
      taskWorkloads: [taskCopy],
      componentWorkloads: [[componentCopy]],
    }));
    const parsed = JSON.parse(result.rawResponse) as {
      tasks: Array<{ workloads: unknown[]; study: { components: Array<{ workloads: unknown[] }> } }>;
    };

    expect(parsed.tasks[0]?.workloads).toEqual([]);
    expect(parsed.tasks[0]?.study.components[0]?.workloads).toEqual([componentCopy]);
    expect(result.repairs).toEqual([
      'duplicate-workload-removed-from-task:task-1:workload-task',
    ]);
  });

  it('keeps exact duplicate ownership when nested object keys arrive in a different order', () => {
    const taskCopy = { ...workload('workload-task'), futureEvidence: { start: 1, end: 2 } };
    const componentCopy = Object.fromEntries(Object.entries({
      ...workload('workload-component'), futureEvidence: { end: 2, start: 1 },
    }).reverse());
    const result = normalizeExactDuplicateWorkloadPlacementV5(response({
      taskWorkloads: [taskCopy], componentWorkloads: [[componentCopy]],
    }));

    expect(JSON.parse(result.rawResponse).tasks[0].workloads).toEqual([]);
    expect(JSON.parse(result.rawResponse).tasks[0].study.components[0].workloads).toEqual([componentCopy]);
    expect(result.repairs).toEqual(['duplicate-workload-removed-from-task:task-1:workload-task']);
  });

  it('accepts different-localId duplicate placement without a second provider request', async () => {
    const taskCopy = workload('workload-task');
    const componentCopy = workload('workload-component');
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => response({
        taskWorkloads: [taskCopy],
        componentWorkloads: [[componentCopy]],
      })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '学習として分野1を2時間進めます',
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
        'duplicate-workload-removed-from-task:task-1:workload-task',
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
    const taskCopy = workload('workload-task');
    const rawResponse = response({
      taskWorkloads: [taskCopy],
      componentWorkloads: [[workload('workload-component-1')], [workload('workload-component-2')]],
    });

    expect(normalizeExactDuplicateWorkloadPlacementV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });

  it('leaves workloads with distinct evidence unchanged', () => {
    const taskWorkload = workload('workload-task');
    const componentWorkload = {
      ...workload('workload-component'),
      sourceText: '分野1の別枠を2時間',
    };
    const rawResponse = response({
      taskWorkloads: [taskWorkload],
      componentWorkloads: [[componentWorkload]],
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


describe('active JSON equality preserves the previous preview comparator contract', () => {
  it.each([
    { name: 'nested object keys', left: { workloads: [{ id: 'work', future: { limit: 17, mode: 'exact' } }] },
      right: { workloads: [{ future: { mode: 'exact', limit: 17 }, id: 'work' }] }, equal: true },
    { name: 'array order', left: { workloads: [{ id: 'first' }, { id: 'second' }] },
      right: { workloads: [{ id: 'second' }, { id: 'first' }] }, equal: false },
    { name: 'unknown nested value', left: { workloads: [{ future: { limit: 17 } }] },
      right: { workloads: [{ future: { limit: 18 } }] }, equal: false },
    { name: 'undefined optional object field', left: { workloads: [{ id: 'work', optional: undefined }] },
      right: { workloads: [{ id: 'work' }] }, equal: true },
    { name: 'absent versus explicit null', left: { workloads: [{ id: 'work' }] },
      right: { workloads: [{ id: 'work', optional: null }] }, equal: false },
    { name: 'numeric-looking object keys', left: { future: { '10': 'ten', '02': 'two', '1': 'one' } },
      right: { future: { '1': 'one', '02': 'two', '10': 'ten' } }, equal: true },
    { name: 'exact strings', left: { tasks: [{ title: '数学' }] },
      right: { tasks: [{ title: '数学 ' }] }, equal: false },
  ])('$name', ({ left, right, equal }) => {
    // The previous projector normalizes optional fields to valid graph JSON before comparing.
    const previousEqual = canonicalCandidateSerialization(JSON.parse(JSON.stringify(left)))
      === canonicalCandidateSerialization(JSON.parse(JSON.stringify(right)));
    expect(previousEqual).toBe(equal);
    expect(areWeeklyPlanningJsonValuesEqual(left, right)).toBe(previousEqual);
  });
});
