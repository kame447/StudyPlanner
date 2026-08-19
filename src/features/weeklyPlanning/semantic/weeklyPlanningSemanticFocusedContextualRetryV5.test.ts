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

function completedWorkPaceState() {
  return {
    graphRevision: 4,
    pendingQuestion: {
      actionId: null,
      questionCode: 'missing_effort_estimate',
      targetFactId: 'completed-70',
      graphRevision: 4,
      effortMeasurement: 'total_duration',
      estimateForWorkloadFactId: 'remaining-30',
      questionBasis: 'completed_workload_total',
    },
    tasks: [{
      publicId: 'task-report',
      category: 'study',
      title: '研究室のレポート',
    }],
    components: [],
    workloads: [
      {
        publicId: 'completed-70',
        taskPublicId: 'task-report',
        componentPublicId: null,
        quantityRole: 'completed',
        amount: 70,
        unitCode: 'custom',
        unitLabel: '%',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
      },
      {
        publicId: 'remaining-30',
        taskPublicId: 'task-report',
        componentPublicId: null,
        quantityRole: 'remaining',
        amount: 30,
        unitCode: 'custom',
        unitLabel: '%',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
      },
    ],
  };
}

describe('Stable V5 focused contextual-answer retry', () => {
  it('retries the same focused interpretation once before generic fallback after provider failure', async () => {
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

  it('retries a dual-target completed-work pace question with a focused repair when the first result falls back', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn()
        .mockResolvedValueOnce(JSON.stringify({
          decision: 'fallback',
          minutes: null,
          precision: null,
          quantityRole: null,
        }))
        .mockResolvedValueOnce(JSON.stringify({
          decision: 'remaining_effort_answer',
          minutes: 45,
          precision: 'approximate',
          quantityRole: null,
        })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '残りは45分くらいです',
      publicStateSummary: completedWorkPaceState(),
      traceRequestId: 'remaining-effort-retry-turn',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics.attemptCount).toBe(2);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
    const secondRequest = vi.mocked(client.createChatCompletion).mock.calls[1][0];
    const repairMessage = secondRequest.messages[secondRequest.messages.length - 1];
    expect(repairMessage?.content).toContain('Re-evaluate only the current user text');
    expect(repairMessage?.content).toContain('remaining_effort_answer');
    expect(result.document?.tasks[0]).toMatchObject({
      existingPublicId: 'task-report',
      workloads: [expect.objectContaining({
        localId: 'remaining-30',
        quantityRole: 'remaining',
      })],
      effortEstimates: [expect.objectContaining({
        targetLocalId: 'remaining-30',
        kind: 'total_duration',
        minutes: 45,
      })],
    });
  });

  it('accepts an alternate per-unit answer for the schedulable remaining workload', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn().mockResolvedValueOnce(JSON.stringify({
        decision: 'effort_per_unit_answer',
        minutes: 8,
        precision: 'approximate',
        quantityRole: null,
      })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '1枚あたりだいたい8分くらいです',
      publicStateSummary: completedWorkPaceState(),
      traceRequestId: 'per-unit-alternate-turn',
    });

    expect(result.status).toBe('accepted');
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.document?.tasks[0]).toMatchObject({
      effortEstimates: [expect.objectContaining({
        targetLocalId: 'remaining-30',
        kind: 'duration_per_unit',
        minutes: 8,
      })],
    });
  });
});
