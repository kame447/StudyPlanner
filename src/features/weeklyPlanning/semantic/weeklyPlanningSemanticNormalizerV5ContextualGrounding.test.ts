import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function stateSummary(questionCode: 'quantity_role_unresolved' | 'missing_effort_estimate') {
  return {
    graphRevision: 3,
    pendingQuestion: {
      actionId: `action-${questionCode}`,
      questionCode,
      targetFactId: 'workload-writing',
      graphRevision: 3,
    },
    tasks: [{
      publicId: 'task-writing',
      category: 'study',
      title: 'レポート執筆',
    }],
    workloads: [{
      publicId: 'workload-writing',
      taskPublicId: 'task-writing',
      componentPublicId: null,
      quantityRole: 'unknown',
      amount: 4,
      unitCode: 'page',
      unitLabel: 'ページ',
    }],
  };
}

describe('Stable V5 normalizer machine-grounded contextual answers', () => {
  it('uses the machine target and raw answer even when the AI returns invalid JSON', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => 'not-json'),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '今回進めたい量です',
      publicStateSummary: stateSummary('quantity_role_unresolved'),
      traceRequestId: 'machine-grounded-role',
    });

    expect(result.status).toBe('accepted');
    expect(result.document).toMatchObject({
      planningIntent: 'discuss',
      tasks: [{
        title: 'レポート執筆',
        workloads: [{
          quantityRole: 'target',
          amount: 4,
          unitCode: 'page',
        }],
      }],
      uncertainties: [],
      corrections: [],
    });
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
      algorithmicRepairs: [
        'contextual-answer-grounded-from-machine-question:quantity_role_unresolved',
      ],
    });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('uses a grounded duration without trusting an invented response-local target', async () => {
    const invalidReferenceDocument = JSON.stringify({
      schemaVersion: 'weekly-planning-semantic-v5',
      planningIntent: 'discuss',
      planningWindow: null,
      tasks: [],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      uncertainties: [{
        localId: 'uncertainty-invented',
        targetLocalId: 'invented-local-id',
        field: 'duration',
        reason: 'model invented a response-local target',
        sourceText: '3時間です',
      }],
      corrections: [],
      decisions: [],
    });
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => invalidReferenceDocument),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '3時間です',
      publicStateSummary: stateSummary('missing_effort_estimate'),
      traceRequestId: 'machine-grounded-effort',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0]?.effortEstimates).toEqual([
      expect.objectContaining({
        kind: 'total_duration',
        minutes: 180,
        precision: 'exact',
      }),
    ]);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      algorithmicRepairs: [
        'contextual-answer-grounded-from-machine-question:missing_effort_estimate',
      ],
    });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not override the provider result for an answer that also adds a new scheduling fact', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => 'not-json'),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '今回進めたい量で、明日にします',
      publicStateSummary: stateSummary('quantity_role_unresolved'),
      traceRequestId: 'machine-grounding-not-answer-only',
    });

    expect(result.status).toBe('rejected');
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.diagnostics.algorithmicRepairs).toEqual([]);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
  });
});
