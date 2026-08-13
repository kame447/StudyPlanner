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

function focusedQuantityRoleAnswer(): string {
  return JSON.stringify({
    decision: 'quantity_role_answer',
    minutes: null,
    precision: null,
    quantityRole: 'target',
  });
}

function focusedEffortAnswer(): string {
  return JSON.stringify({
    decision: 'effort_answer',
    minutes: 180,
    precision: 'exact',
    quantityRole: null,
  });
}

describe('Stable V5 normalizer AI-owned contextual answers', () => {
  it('accepts a quantity-role answer expressed by the focused AI', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => focusedQuantityRoleAnswer()),
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
    expect(vi.mocked(client.createChatCompletion).mock.calls[0][0].responseFormat)
      .toMatchObject({
        json_schema: { name: 'weekly_planning_focused_contextual_answer_v5' },
      });
  });

  it('accepts a focused AI effort estimate for the exact machine-selected workload', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => focusedEffortAnswer()),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '3時間です',
      publicStateSummary: stateSummary('missing_effort_estimate'),
      traceRequestId: 'ai-owned-effort',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0]?.effortEstimates[0]).toMatchObject({
      kind: 'total_duration',
      minutes: 180,
    });
    expect(result.diagnostics.algorithmicRepairs ?? []).not.toContain(
      'contextual-answer-grounded-from-machine-question:missing_effort_estimate',
    );
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.createChatCompletion).mock.calls[0][0].responseFormat)
      .toMatchObject({
        json_schema: { name: 'weekly_planning_focused_contextual_answer_v5' },
      });
  });

  it('falls through to generic AI repair instead of parsing an invalid short reply itself', async () => {
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
    expect(client.createChatCompletion).toHaveBeenCalledTimes(3);

    const calls = vi.mocked(client.createChatCompletion).mock.calls;
    expect(calls[0][0].responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_focused_contextual_answer_v5' },
    });
    expect(calls[1][0].responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_semantic_document_v5' },
    });
    expect(calls[2][0].responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_semantic_document_v5' },
    });
  });
});
