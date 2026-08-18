import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

function pendingEffortState() {
  return {
    graphRevision: 3,
    pendingQuestion: {
      actionId: null,
      questionCode: 'missing_effort_estimate',
      targetFactId: 'workload-slides',
      graphRevision: 3,
    },
    tasks: [{
      publicId: 'task-slides',
      category: 'study',
      title: '夏合宿のスライド',
    }],
    components: [],
    workloads: [{
      publicId: 'workload-slides',
      taskPublicId: 'task-slides',
      componentPublicId: null,
      quantityRole: 'remaining',
      amount: 8,
      unitCode: 'custom',
      unitLabel: '枚',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
    }],
  };
}

describe('Stable V5 focused contextual-answer retry', () => {
  it('retries the same focused interpretation once before generic fallback', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn()
        .mockRejectedValueOnce(new Error('temporary provider failure'))
        .mockResolvedValueOnce(JSON.stringify({
          decision: 'effort_per_unit_answer',
          minutes: 8,
          precision: 'approximate',
          quantityRole: null,
        })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '1枚あたりだいたい8分くらいです',
      publicStateSummary: pendingEffortState(),
      traceRequestId: 'retry-turn',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics.attemptCount).toBe(2);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.document?.tasks[0]).toMatchObject({
      existingPublicId: 'task-slides',
      effortEstimates: [expect.objectContaining({
        targetLocalId: 'workload-slides',
        kind: 'duration_per_unit',
        minutes: 8,
      })],
    });
  });
});
