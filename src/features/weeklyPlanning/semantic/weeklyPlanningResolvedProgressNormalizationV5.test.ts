import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { normalizeResolvedProgressWorkloadsV5 } from './weeklyPlanningResolvedProgressNormalizationV5';

function workload(
  localId: string,
  quantityRole: 'declared' | 'completed' | 'remaining',
  amount: number,
  sourceText: string,
) {
  return {
    localId,
    quantityRole,
    amount,
    unitCode: 'page',
    unitLabel: 'ページ',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    sourceText,
  };
}

function response(workloads: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      existingPublicId: null,
      decompositionStatus: 'atomic',
      category: 'study',
      title: '数学のワーク',
      study: {
        purpose: 'unknown',
        contextLabel: '数学のワーク',
        components: [{
          localId: 'component-1',
          existingPublicId: null,
          parentLocalId: null,
          role: 'material',
          label: '数学のワーク',
          workloads,
          durableContextSignals: [],
          sourceText: '数学のワーク',
        }],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '数学のワークは全部で80ページで、30ページまで終わっています。残り50ページです。',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('Stable V5 resolved progress normalization', () => {
  it('removes only a declared total exactly resolved by explicit completed and remaining facts', () => {
    const raw = response([
      workload('total', 'declared', 80, '全部で80ページ'),
      workload('done', 'completed', 30, '30ページまで終わっています'),
      workload('left', 'remaining', 50, '残り50ページ'),
    ]);
    const result = normalizeResolvedProgressWorkloadsV5(raw);
    const parsed = JSON.parse(result.rawResponse) as {
      tasks: Array<{ study: { components: Array<{ workloads: Array<{ localId: string }> }> } }>;
    };

    expect(parsed.tasks[0]?.study.components[0]?.workloads.map((item) => item.localId)).toEqual([
      'done',
      'left',
    ]);
    expect(result.repairs).toEqual([
      'resolved-progress-declared-total-removed:component-1:total',
    ]);
  });

  it('does not guess when the arithmetic does not match or remaining is absent', () => {
    const mismatch = response([
      workload('total', 'declared', 80, '全部で80ページ'),
      workload('done', 'completed', 30, '30ページまで終わっています'),
      workload('left', 'remaining', 40, '残り40ページ'),
    ]);
    const incomplete = response([
      workload('total', 'declared', 80, '全部で80ページ'),
      workload('done', 'completed', 30, '30ページまで終わっています'),
    ]);

    expect(normalizeResolvedProgressWorkloadsV5(mismatch)).toEqual({ rawResponse: mismatch, repairs: [] });
    expect(normalizeResolvedProgressWorkloadsV5(incomplete)).toEqual({ rawResponse: incomplete, repairs: [] });
  });

  it('accepts fully resolved progress without a second provider request', async () => {
    const providerResponse = response([
      workload('total', 'declared', 80, '全部で80ページ'),
      workload('done', 'completed', 30, '30ページまで終わっています'),
      workload('left', 'remaining', 50, '残り50ページ'),
    ]);
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => providerResponse),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '数学のワークは全部で80ページで、30ページまで終わっています。残り50ページです。',
      traceRequestId: 'resolved-progress-normalization',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
      algorithmicRepairs: [
        'resolved-progress-declared-total-removed:component-1:total',
      ],
    });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });
});
