import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

function publicStateSummary() {
  return {
    graphRevision: 11,
    previousCompatibilityStatus: 'revision_pending',
    pendingQuestion: {
      actionId: null,
      questionCode: 'missing_effort_estimate',
      targetFactId: 'workload-physics-em',
      graphRevision: 11,
      effortMeasurement: 'total_duration',
      estimateForWorkloadFactId: null,
      questionBasis: null,
    },
    tasks: [
      { publicId: 'task-math', category: 'study', title: '数学' },
      { publicId: 'task-physics', category: 'study', title: '物理' },
      { publicId: 'task-english', category: 'study', title: '英語' },
    ],
    components: [
      {
        publicId: 'component-physics-em',
        taskPublicId: 'task-physics',
        parentComponentPublicId: null,
        role: 'topic',
        label: '電磁気',
      },
    ],
    workloads: [
      {
        publicId: 'workload-physics-em',
        taskPublicId: 'task-physics',
        componentPublicId: 'component-physics-em',
        quantityRole: 'remaining',
        amount: 100,
        unitCode: 'custom',
        unitLabel: '%',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
      },
    ],
    relations: [
      {
        publicId: 'relation-math-over-english',
        kind: 'priority_over',
        fromTaskPublicId: 'task-math',
        toTaskPublicId: 'task-english',
      },
      {
        publicId: 'relation-physics-over-english',
        kind: 'priority_over',
        fromTaskPublicId: 'task-physics',
        toTaskPublicId: 'task-english',
      },
    ],
  };
}

describe('Stable V5 provisional timebox focused semantic route', () => {
  it('keeps unknown completion effort unknown and authorizes scheduler-only provisional allocation', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn()
        .mockResolvedValueOnce(JSON.stringify({
          decision: 'fallback',
          effortTarget: null,
          effortMeasurement: null,
          minutes: null,
          precision: null,
          quantityRole: null,
        }))
        .mockResolvedValueOnce(JSON.stringify({
          decision: 'provisional_timebox',
          effortDisposition: 'unavailable',
          allocationMode: 'available_capacity',
        })),
    };

    const userText =
      '総時間は分かりません。前に伝えた通り、完了に必要な合計時間という事実にはしないでください。今ある空き時間の中で、数学と物理を優先して暫定的に配分する計画にしてください。';

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText,
      publicStateSummary: publicStateSummary(),
      traceRequestId: 'turn-9',
    });

    expect(result.status).toBe('accepted');
    expect(result.contextualDirective).toEqual({
      kind: 'provisional_timebox',
      scope: 'current_missing_effort',
    });
    expect(result.document).toMatchObject({
      planningIntent: 'update_plan',
      tasks: [],
      relations: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);

    const provisionalRequest = vi.mocked(client.createChatCompletion).mock.calls[1][0];
    expect(provisionalRequest.responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_focused_provisional_timebox_v5' },
    });
    const serializedRequest = JSON.stringify(provisionalRequest.messages);
    expect(serializedRequest).toContain('relation-math-over-english');
    expect(serializedRequest).toContain('relation-physics-over-english');
    expect(serializedRequest).toContain('must never be expanded into new relation endpoints');
  });
});
