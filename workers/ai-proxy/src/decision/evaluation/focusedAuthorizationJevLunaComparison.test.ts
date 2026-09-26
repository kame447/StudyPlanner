import { describe, expect, it, vi } from 'vitest';
import {
  FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS,
  FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
  createFocusedAuthorizationMessagesV5,
} from '../../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedAuthorizationV5';
import type {
  DecisionEvaluation,
  DecisionMetadata,
  DecisionProvider,
} from '../decisionProvider';
import {
  compareFocusedAuthorizationCandidates,
  exactClopperPearsonUpperBound95,
  exactTwoSidedMcNemarPValue,
  wilsonInterval95,
} from './focusedAuthorizationJevLunaComparison';
import {
  createLunaFocusedAuthorizationEvaluator,
  type LunaFocusedAuthorizationEvaluation,
  type LunaFocusedAuthorizationEvaluator,
} from './focusedAuthorizationLunaEvaluation';
import type { FocusedAuthorizationSyntheticCandidate } from './focusedAuthorizationSyntheticCandidates';

function decisionMetadata(overrides: Partial<DecisionMetadata> = {}): DecisionMetadata {
  return {
    provider: 'openrouter',
    requestedModel: 'mock-jev',
    servedModel: 'mock-jev',
    latencyMs: 10,
    inputTokens: 11,
    outputTokens: 3,
    costUsd: null,
    requestBytes: 10,
    responseBytes: 10,
    ...overrides,
  };
}

function jevEvaluation(options: {
  decision?: 'create_plan' | 'fallback';
  confidence?: number;
  conditionChange?: number;
  independentMeaning?: number;
  metadata?: Partial<DecisionMetadata>;
} = {}): DecisionEvaluation {
  const decision = options.decision ?? 'create_plan';
  return {
    status: 'evaluated',
    decision,
    confidence: options.confidence ?? 0.999,
    probabilities: decision === 'create_plan'
      ? { create_plan: 0.999, fallback: 0.001 }
      : { create_plan: 0.001, fallback: 0.999 },
    conditionChange: options.conditionChange ?? (decision === 'fallback' ? 0.999 : 0.001),
    independentMeaning: options.independentMeaning ?? (decision === 'fallback' ? 0.999 : 0.001),
    metadata: decisionMetadata(options.metadata),
  };
}

function lunaEvaluation(
  decision: 'create_plan' | 'fallback',
  options: {
    latencyMs?: number;
    promptTokens?: number | null;
    completionTokens?: number | null;
    costUsd?: number | null;
  } = {},
): LunaFocusedAuthorizationEvaluation {
  return {
    status: 'evaluated',
    decision,
    metadata: {
      requestedModel: 'gpt-5.6-luna',
      servedModel: 'gpt-5.6-luna',
      latencyMs: options.latencyMs ?? 20,
      promptTokens: options.promptTokens === undefined ? 13 : options.promptTokens,
      completionTokens: options.completionTokens === undefined ? 2 : options.completionTokens,
      costUsd: options.costUsd === undefined ? null : options.costUsd,
    },
  };
}

function candidate(
  id: string,
  expected: 'create_plan' | 'fallback' = 'fallback',
  split: 'tuning' | 'holdout' = 'tuning',
): FocusedAuthorizationSyntheticCandidate {
  return {
    id,
    conversationGroupId: `group-${id}`,
    layer: 'plain_authorization',
    lastAssistantMessage: `assistant-${id}`,
    currentUserText: `user-${id}`,
    expected,
    split,
    reviewStatus: 'synthetic_unreviewed',
  };
}

function queuedJev(evaluations: DecisionEvaluation[]): DecisionProvider {
  return {
    evaluate: vi.fn(async () => {
      const evaluation = evaluations.shift();
      if (!evaluation) throw new Error('Unexpected Jev evaluation.');
      return evaluation;
    }),
  };
}

function queuedLuna(
  evaluations: LunaFocusedAuthorizationEvaluation[],
): LunaFocusedAuthorizationEvaluator {
  return {
    evaluate: vi.fn(async () => {
      const evaluation = evaluations.shift();
      if (!evaluation) throw new Error('Unexpected Luna evaluation.');
      return evaluation;
    }),
  };
}

describe('Luna focused-authorization evaluation adapter', () => {
  it('reuses the production request contract and records explicit-price usage without exposing raw data', async () => {
    const context = {
      currentUserText: '今の条件でお願いします',
      lastAssistantMessage: 'この条件で案を作りますか？',
    };
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        model: 'gpt-5.6-luna',
        messages: createFocusedAuthorizationMessagesV5({
          userText: context.currentUserText,
          publicStateSummary: { lastAssistantMessage: context.lastAssistantMessage },
        }),
        response_format: FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
        max_completion_tokens: FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS,
      });
      expect(init?.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-openai-key',
      });
      return Response.json({
        model: 'gpt-5.6-luna',
        choices: [{ message: { content: '{"decision":"create_plan"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });
    });
    const evaluator = createLunaFocusedAuthorizationEvaluator({
      apiKey: 'test-openai-key',
      fetch: fetchMock,
      pricing: {
        'gpt-5.6-luna': { promptUsdPerMillion: 1, completionUsdPerMillion: 2 },
      },
    });

    expect(await evaluator.evaluate(context)).toMatchObject({
      status: 'evaluated',
      decision: 'create_plan',
      metadata: {
        requestedModel: 'gpt-5.6-luna',
        servedModel: 'gpt-5.6-luna',
        promptTokens: 100,
        completionTokens: 20,
        costUsd: 0.00014,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps cost unknown without an explicit table and classifies invalid/unavailable coarsely', async () => {
    const context = { currentUserText: 'はい', lastAssistantMessage: null };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      model: 'gpt-5.6-luna',
      choices: [{ message: { content: '{"decision":"other"}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    }));
    const invalid = createLunaFocusedAuthorizationEvaluator({
      apiKey: 'test-openai-key', fetch: fetchMock,
    });
    expect(await invalid.evaluate(context)).toMatchObject({
      status: 'invalid', reason: 'invalid_response', metadata: { costUsd: null },
    });

    const noKeyFetch = vi.fn<typeof fetch>();
    const unavailable = createLunaFocusedAuthorizationEvaluator({ fetch: noKeyFetch });
    expect(await unavailable.evaluate(context)).toMatchObject({
      status: 'unavailable', reason: 'configuration', metadata: { costUsd: null },
    });
    expect(noKeyFetch).not.toHaveBeenCalled();
  });
});

describe('Jev/Luna focused-boundary comparison', () => {
  it('passes identical conversation context to Jev and the Luna production prompt', async () => {
    const value = candidate('same-context', 'fallback');
    let jevContext: unknown;
    let lunaPromptContext: unknown;
    const jev: DecisionProvider = {
      evaluate: vi.fn(async (context) => {
        jevContext = context;
        return jevEvaluation();
      }),
    };
    const luna = createLunaFocusedAuthorizationEvaluator({
      apiKey: 'test-openai-key',
      fetch: vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        lunaPromptContext = JSON.parse(body.messages[1].content);
        return Response.json({
          model: 'gpt-5.6-luna',
          choices: [{ message: { content: '{"decision":"create_plan"}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      }),
    });

    await compareFocusedAuthorizationCandidates(
      [value],
      { [value.id]: { expected: 'create_plan', labelStatus: 'human_reviewed_gold' } },
      { jev, luna },
    );

    expect(jevContext).toEqual({
      currentUserText: value.currentUserText,
      lastAssistantMessage: value.lastAssistantMessage,
    });
    expect(lunaPromptContext).toEqual(jevContext);
  });

  it('uses gated Jev decisions for routing and reports focused-boundary sequential cost and latency', async () => {
    const candidates = [
      candidate('accepted-create', 'fallback'),
      candidate('auxiliary-fallback'),
      candidate('abstained', 'fallback', 'holdout'),
      candidate('unavailable', 'create_plan', 'holdout'),
    ];
    const jev = queuedJev([
      jevEvaluation({ metadata: { latencyMs: 10, costUsd: 0.1 } }),
      jevEvaluation({
        conditionChange: 0.99,
        metadata: { latencyMs: 20, costUsd: 0.2 },
      }),
      jevEvaluation({ confidence: 0.5, metadata: { latencyMs: 30, costUsd: null } }),
      {
        status: 'unavailable', reason: 'timeout',
        metadata: decisionMetadata({ latencyMs: 50, costUsd: 0.5 }),
      },
    ]);
    const luna = queuedLuna([
      lunaEvaluation('fallback', { latencyMs: 100, costUsd: null }),
      lunaEvaluation('create_plan', { latencyMs: 100, costUsd: null }),
      lunaEvaluation('create_plan', { latencyMs: 40, costUsd: null }),
      lunaEvaluation('fallback', { latencyMs: 60, costUsd: 0.6 }),
    ]);
    const labels = {
      'accepted-create': { expected: 'create_plan', labelStatus: 'synthetic_unreviewed' },
      'auxiliary-fallback': { expected: 'fallback', labelStatus: 'synthetic_unreviewed' },
      abstained: { expected: 'create_plan', labelStatus: 'synthetic_unreviewed' },
      unavailable: { expected: 'fallback', labelStatus: 'synthetic_unreviewed' },
    } as const;

    const report = await compareFocusedAuthorizationCandidates(candidates, labels, { jev, luna });

    expect(report.cases.map((value) => value.focusedBoundary.route)).toEqual([
      'jev_accepted',
      'jev_accepted',
      'luna_after_jev_abstain',
      'luna_after_jev_unavailable',
    ]);
    expect(report.cases[1]).toMatchObject({
      jev: { rawChoice: 'create_plan', gateOutcome: 'accepted_fallback' },
      focusedBoundary: {
        finalDecision: 'fallback',
        totalLatencyMs: 20,
        continuesToGenericSemantic: true,
      },
    });
    expect(report.cases[2].focusedBoundary).toMatchObject({
      finalDecision: 'create_plan',
      totalLatencyMs: 70,
      totalCostUsd: {
        componentCount: 2,
        unknownComponentCount: 2,
        completeTotal: null,
      },
    });
    expect(report.metrics.global.focusedBoundary).toMatchObject({
      coverage: { numerator: 4, denominator: 4, value: 1 },
      selectiveAccuracy: { numerator: 4, denominator: 4, value: 1 },
      continuesToGenericSemantic: { numerator: 2, denominator: 4, value: 0.5 },
      costUsd: {
        componentCount: 6,
        reportedComponentCount: 4,
        unknownComponentCount: 2,
        knownSubtotal: 1.4,
        completeTotal: null,
      },
      uncertainty95: {
        byClass: {
          create_plan: {
            precision: { method: 'wilson', confidenceLevel: 0.95 },
            recall: { method: 'wilson', confidenceLevel: 0.95 },
          },
        },
        falseCreateRate: { method: 'clopper_pearson_exact', confidenceLevel: 0.95 },
        createPlanMissRate: { method: 'clopper_pearson_exact', confidenceLevel: 0.95 },
      },
    });
    expect(report.metrics.global.jevLunaAgreement).toMatchObject({
      basis: 'jev_gated_decision_vs_luna_decision',
      comparableCaseCount: 2,
      nonComparableCaseCount: 2,
      agreement: { numerator: 0, denominator: 2, value: 0 },
      discordantPairCounts: {
        jevCreatePlanLunaFallback: 1,
        jevFallbackLunaCreatePlan: 1,
      },
    });
    expect(report.scopeNote).toContain('exclude downstream generic-semantic');
    expect(report.cases[0].expected).toBe('create_plan');
    expect(report.cases[0].reviewStatus).toBe('synthetic_unreviewed');
    expect(report.cases[0].labelStatus).toBe('synthetic_unreviewed');
  });

  it('keeps raw agreement separate from label-based accuracy and counts discordant pairs', async () => {
    const values = [candidate('agreed-wrong'), candidate('discordant')];
    const report = await compareFocusedAuthorizationCandidates(
      values,
      {
        'agreed-wrong': { expected: 'fallback', labelStatus: 'human_reviewed_gold' },
        discordant: { expected: 'fallback', labelStatus: 'human_reviewed_gold' },
      },
      {
        jev: queuedJev([jevEvaluation(), jevEvaluation()]),
        luna: queuedLuna([lunaEvaluation('create_plan'), lunaEvaluation('fallback')]),
      },
    );

    expect(report.metrics.global.jevLunaAgreement).toEqual({
      basis: 'jev_gated_decision_vs_luna_decision',
      note: 'Agreement is not accuracy and is not compared with labels.',
      comparableCaseCount: 2,
      nonComparableCaseCount: 0,
      agreement: { numerator: 1, denominator: 2, value: 0.5 },
      discordantPairCounts: {
        jevCreatePlanLunaFallback: 1,
        jevFallbackLunaCreatePlan: 0,
      },
      labelStatusCounts: { human_reviewed_gold: 2 },
      provisional: false,
    });
    expect(report.metrics.global.jev.selectiveAccuracy)
      .toEqual({ numerator: 0, denominator: 2, value: 0 });
    expect(report.metrics.global.luna.selectiveAccuracy)
      .toEqual({ numerator: 1, denominator: 2, value: 0.5 });
  });

  it('runs Luna only when the production decision context rejects a candidate', async () => {
    const candidates = [
      { ...candidate('empty'), currentUserText: '' },
      { ...candidate('whitespace'), currentUserText: ' \n\t ' },
      candidate('eligible'),
    ];
    const jev = queuedJev([jevEvaluation({ decision: 'fallback' })]);
    const luna = queuedLuna([
      lunaEvaluation('fallback', { latencyMs: 21 }),
      lunaEvaluation('fallback', { latencyMs: 22 }),
      lunaEvaluation('fallback', { latencyMs: 23 }),
    ]);
    const labels = Object.fromEntries(candidates.map((value) => [value.id, {
      expected: 'fallback' as const,
      labelStatus: 'synthetic_unreviewed',
    }]));

    const report = await compareFocusedAuthorizationCandidates(candidates, labels, { jev, luna });

    expect(jev.evaluate).toHaveBeenCalledTimes(1);
    expect(luna.evaluate).toHaveBeenCalledTimes(3);
    expect(report.cases.slice(0, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jev: expect.objectContaining({
          gateOutcome: 'rejected_before_provider',
          latencyMs: null,
          requestedModel: null,
        }),
        focusedBoundary: expect.objectContaining({
          route: 'luna_only_invalid_context',
          finalDecision: 'fallback',
          totalLatencyMs: expect.any(Number),
          totalCostUsd: expect.objectContaining({ componentCount: 1 }),
        }),
      }),
    ]));
    expect(report.cases.map((value) => value.focusedBoundary.route)).toEqual([
      'luna_only_invalid_context',
      'luna_only_invalid_context',
      'jev_accepted',
    ]);
    expect(report.metrics.global.jev).toMatchObject({
      caseCount: 3,
      evaluationEligibleCaseCount: 1,
      rejectedBeforeProviderCount: 2,
      coverage: { numerator: 1, denominator: 1, value: 1 },
      abstainRate: { numerator: 0, denominator: 1, value: 0 },
      labelStatusCounts: { synthetic_unreviewed: 3 },
      provisional: true,
    });
    expect(report.metrics.global.luna).toMatchObject({
      caseCount: 3,
      evaluationEligibleCaseCount: 3,
      rejectedBeforeProviderCount: 0,
    });
  });

  it('reports paired label correctness, fallback-risk discordance and provisional status', async () => {
    const values = [
      candidate('overall-b'),
      candidate('overall-c'),
      candidate('fallback-b'),
      candidate('fallback-c'),
    ];
    const report = await compareFocusedAuthorizationCandidates(
      values,
      {
        'overall-b': { expected: 'create_plan', labelStatus: 'human_reviewed_gold' },
        'overall-c': { expected: 'create_plan', labelStatus: 'human_reviewed_gold' },
        'fallback-b': { expected: 'fallback', labelStatus: 'human_reviewed_gold' },
        'fallback-c': { expected: 'fallback', labelStatus: 'synthetic_unreviewed' },
      },
      {
        jev: queuedJev([
          jevEvaluation({ decision: 'fallback' }),
          jevEvaluation({ decision: 'create_plan' }),
          jevEvaluation({ decision: 'create_plan' }),
          jevEvaluation({ decision: 'fallback' }),
        ]),
        luna: queuedLuna([
          lunaEvaluation('create_plan'),
          lunaEvaluation('fallback'),
          lunaEvaluation('fallback'),
          lunaEvaluation('create_plan'),
        ]),
      },
    );

    expect(report.metrics.global.pairedVsLabels).toMatchObject({
      overall: {
        caseCount: 4,
        bLunaCorrectFocusedBoundaryWrong: 2,
        cFocusedBoundaryCorrectLunaWrong: 2,
        exactTwoSidedMcNemarPValue: 1,
        provisional: true,
      },
      expectedFallbackFalseCreateRisk: {
        caseCount: 2,
        bLunaCorrectFocusedBoundaryWrong: 1,
        cFocusedBoundaryCorrectLunaWrong: 1,
        exactTwoSidedMcNemarPValue: 1,
        labelStatusCounts: { human_reviewed_gold: 1, synthetic_unreviewed: 1 },
        provisional: true,
      },
      labelStatusCounts: { human_reviewed_gold: 3, synthetic_unreviewed: 1 },
      provisional: true,
    });
    expect(report.metrics.global.jev.provisional).toBe(true);
    expect(report.metrics.global.luna.provisional).toBe(true);
    expect(report.metrics.global.focusedBoundary.provisional).toBe(true);
    expect(report.independenceNote).toContain('not independent observations');
  });

  it('validates externally supplied labels before either provider can make a network call', async () => {
    const value = candidate('missing-label');
    const jev = { evaluate: vi.fn() } as unknown as DecisionProvider;
    const luna = { evaluate: vi.fn() } as unknown as LunaFocusedAuthorizationEvaluator;

    await expect(compareFocusedAuthorizationCandidates([value], {}, { jev, luna }))
      .rejects.toThrow('Missing or invalid comparison label: missing-label');
    expect(jev.evaluate).not.toHaveBeenCalled();
    expect(luna.evaluate).not.toHaveBeenCalled();
  });
});

describe('focused-authorization exact statistical helpers', () => {
  it('matches known exact and Wilson values without external dependencies', () => {
    expect(exactClopperPearsonUpperBound95(0, 16)).toBeCloseTo(0.17075, 5);
    // Regression: near k = n the summation used to underflow and understate the bound.
    expect(exactClopperPearsonUpperBound95(130, 131)).toBeCloseTo(0.99961, 5);
    expect(exactClopperPearsonUpperBound95(500, 1000)).toBeCloseTo(0.52648, 5);
    expect(exactClopperPearsonUpperBound95(0, 299)).toBeCloseTo(0.00997, 5);
    expect(exactTwoSidedMcNemarPValue(0, 5)).toBe(0.0625);
    expect(exactTwoSidedMcNemarPValue(0, 0)).toBe(1);
    const interval = wilsonInterval95(5, 10);
    expect(interval.lower).toBeCloseTo(0.23659, 5);
    expect(interval.upper).toBeCloseTo(0.76341, 5);
  });

  it('returns null bounds for empty denominators', () => {
    expect(exactClopperPearsonUpperBound95(0, 0)).toBeNull();
    expect(wilsonInterval95(0, 0)).toMatchObject({ lower: null, upper: null });
  });
});
