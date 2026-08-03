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

function document(params: {
  quantityRole?: 'target';
  minutes?: number;
}): string {
  const workload = {
    localId: 'workload-writing-answer',
    quantityRole: params.quantityRole ?? 'unknown',
    amount: 4,
    unitCode: 'page',
    unitLabel: 'ページ',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    sourceText: params.minutes ? '4ページ' : '今回進めたい量です',
  };
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'task-writing-answer',
      category: 'study',
      title: 'レポート執筆',
      study: {
        purpose: 'homework',
        contextLabel: null,
        components: [],
      },
      workloads: [workload],
      effortEstimates: params.minutes
        ? [{
            localId: 'effort-writing-answer',
            targetLocalId: workload.localId,
            kind: 'total_duration',
            minutes: params.minutes,
            unitCode: null,
            precision: 'exact',
            sourceText: '3時間です',
          }]
        : [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: params.minutes ? '3時間です' : '今回進めたい量です',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('Stable V5 normalizer AI-owned contextual answers', () => {
  it('accepts a quantity-role answer expressed by the AI', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => document({ quantityRole: 'target' })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '今回進めたい量です',
      publicStateSummary: stateSummary('quantity_role_unresolved'),
      traceRequestId: 'ai-owned-role',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0]?.workloads[0]).toMatchObject({
      quantityRole: 'target',
      amount: 4,
      unitCode: 'page',
    });
    expect(result.diagnostics.algorithmicRepairs ?? []).not.toContain(
      'contextual-answer-grounded-from-machine-question:quantity_role_unresolved',
    );
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('accepts an AI effort estimate targeting the exact workload', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => document({ minutes: 180 })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '3時間です',
      publicStateSummary: stateSummary('missing_effort_estimate'),
      traceRequestId: 'ai-owned-effort',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0]?.effortEstimates[0]).toMatchObject({
      targetLocalId: 'workload-writing-answer',
      kind: 'total_duration',
      minutes: 180,
    });
    expect(result.diagnostics.algorithmicRepairs ?? []).not.toContain(
      'contextual-answer-grounded-from-machine-question:missing_effort_estimate',
    );
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('repairs or rejects invalid AI output instead of parsing the short reply itself', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => 'not-json'),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '3時間です',
      publicStateSummary: stateSummary('missing_effort_estimate'),
      traceRequestId: 'ai-owned-invalid',
    });

    expect(result.status).toBe('rejected');
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.diagnostics.algorithmicRepairs).toEqual([]);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
  });
});
