import { describe, expect, it } from 'vitest';
import type { UserContextRoutingDecisionContext } from '../../../../../shared/userContextRoutingDecision';
import type { DecisionEvaluation, DecisionProvider } from '../decisionProvider';
import type { UserContextRoutingDecision } from '../userContextRoutingPolicy';
import {
  compareUserContextRoutingPaired,
  evaluateUserContextRoutingCase,
  evaluateUserContextRoutingLunaBaseline,
  summarizeUserContextRouting,
  summarizeUserContextRoutingLunaBaseline,
  userContextRoutingClopperPearsonUpper95,
} from './userContextRoutingEvaluation';
import type { UserContextRoutingEvaluationCandidate } from './userContextRoutingCorpus';
import type {
  UserContextRoutingLunaEvaluation,
  UserContextRoutingLunaEvaluator,
} from './userContextRoutingLunaEvaluation';

const metadata = {
  provider: 'typesafe' as const,
  requestedModel: 'injected-routing-model',
  servedModel: 'injected-routing-model',
  latencyMs: 4,
  inputTokens: 20,
  outputTokens: 5,
  costUsd: 0.00001,
  requestBytes: 50,
  responseBytes: 60,
};

function candidate(
  id: string,
  evaluationClass: UserContextRoutingEvaluationCandidate['evaluationClass'],
  expectedRoute: UserContextRoutingEvaluationCandidate['expectedRoute'],
  expectedTargetDomain: UserContextRoutingEvaluationCandidate['expectedTargetDomain'],
): UserContextRoutingEvaluationCandidate {
  return {
    id,
    conversationGroupId: `${id}-group`,
    split: 'tuning',
    evaluationClass,
    currentUserText: `synthetic-${id}`,
    expectedRoute,
    expectedTargetDomain,
    labelStatus: evaluationClass === 'mixed_negative'
      ? 'opus-5.5-limited-judge'
      : 'synthetic_unreviewed',
  };
}

function evaluated(
  decision: UserContextRoutingDecision,
): DecisionEvaluation<UserContextRoutingDecision> {
  const selected = 0.995;
  const remainder = (1 - selected) / 5;
  return {
    status: 'evaluated',
    decision,
    confidence: 0.999,
    probabilities: {
      user_context: decision === 'user_context' ? selected : remainder,
      bookshelf: decision === 'bookshelf' ? selected : remainder,
      timetable: decision === 'timetable' ? selected : remainder,
      schedule: decision === 'schedule' ? selected : remainder,
      actual: decision === 'actual' ? selected : remainder,
      uncertain: decision === 'uncertain' ? selected : remainder,
    },
    conditionChange: 0.001,
    independentMeaning: 0.001,
    metadata,
  };
}

function provider(
  evaluation: DecisionEvaluation<UserContextRoutingDecision>,
): DecisionProvider<UserContextRoutingDecisionContext['state'], UserContextRoutingDecision> {
  return { evaluate: async () => evaluation };
}

function lunaEvaluation(
  targetDomain: 'user_context' | 'bookshelf' | 'timetable' | 'schedule' | 'actual',
): Extract<UserContextRoutingLunaEvaluation, { status: 'evaluated' }> {
  const userContext = targetDomain === 'user_context';
  const interpretation = {
    targetDomain,
    kind: userContext ? 'concern' as const : null,
    label: userContext ? '数学' : null,
    value: userContext ? '確率が苦手' : null,
    dateExpression: null,
    displayText: 'synthetic display',
    reason: 'synthetic reason',
  };
  return {
    status: 'evaluated',
    interpretation,
    content: JSON.stringify(interpretation),
    metadata: {
      requestedModel: 'gpt-5.6-luna',
      servedModel: 'gpt-5.6-luna',
      latencyMs: 30,
      promptTokens: 100,
      completionTokens: 20,
    },
  };
}

function luna(
  targetDomain: 'user_context' | 'bookshelf' | 'timetable' | 'schedule' | 'actual',
): UserContextRoutingLunaEvaluator {
  return { evaluate: async () => lunaEvaluation(targetDomain) };
}

describe('user-context routing evaluation', () => {
  it('runs the production dispatch and keeps evidence typed and raw-free', async () => {
    const external = await evaluateUserContextRoutingCase({
      candidate: candidate('external', 'external_clear', 'external_owner', 'bookshelf'),
      provider: provider(evaluated('bookshelf')),
      luna: luna('bookshelf'),
    });
    expect(external).toMatchObject({
      route: 'jev_external_owner',
      luna: { called: false },
      final: {
        status: 'evaluated',
        targetDomain: 'bookshelf',
        labelAgreement: true,
        unexpectedOutputKeys: [],
      },
      authority: {
        approvalGranted: false,
        saveGrantedByJev: false,
        recordFieldsGeneratedByJev: false,
      },
    });
    expect(JSON.stringify(external)).not.toContain('synthetic-external');

    const deferred = await evaluateUserContextRoutingCase({
      candidate: candidate('user', 'user_context_negative', 'luna', 'user_context'),
      provider: provider(evaluated('user_context')),
      luna: luna('user_context'),
    });
    expect(deferred).toMatchObject({
      route: 'deferred_to_luna',
      luna: { called: true, targetDomain: 'user_context' },
      final: { labelAgreement: true },
    });
  });

  it('counts a mixed direct acceptance as the primary false-accept at case and group level', async () => {
    const falseAccept = await evaluateUserContextRoutingCase({
      candidate: candidate('mixed', 'mixed_negative', 'luna', null),
      provider: provider(evaluated('schedule')),
      luna: luna('schedule'),
    });
    const safe = await evaluateUserContextRoutingCase({
      candidate: candidate('security', 'security_negative', 'luna', 'user_context'),
      provider: provider({
        status: 'unavailable',
        reason: 'model_mismatch',
        metadata,
      }),
      luna: luna('user_context'),
    });
    const summary = summarizeUserContextRouting([falseAccept, safe]);

    expect(falseAccept).toMatchObject({
      route: 'jev_external_owner',
      luna: { called: false },
      final: { labelAgreement: false },
    });
    expect(summary.primaryFalseAccept).toMatchObject({
      caseLevel: { occurrences: 1, sampleCount: 2 },
      conversationGroupLevel: { occurrences: 1, sampleCount: 2 },
    });
    expect(summary.securityFalseAccept.caseLevel).toMatchObject({
      occurrences: 0,
      sampleCount: 1,
    });
    expect(summary.wrongExternalGuide).toMatchObject({
      caseLevel: { occurrences: 0, sampleCount: 0 },
      conversationGroupLevel: { occurrences: 0, sampleCount: 0 },
    });
    expect(summary.externalMissedReduction).toMatchObject({
      caseLevel: { occurrences: 0, sampleCount: 0 },
      conversationGroupLevel: { occurrences: 0, sampleCount: 0 },
    });
    expect(summary.generativeLlmCalls).toBe(1);
  });

  it('reports paired provisional disagreement and Luna cost ranges', async () => {
    const item = candidate('pair', 'external_clear', 'external_owner', 'bookshelf');
    const firstRoute = await evaluateUserContextRoutingCase({
      candidate: item,
      provider: provider(evaluated('bookshelf')),
      luna: luna('bookshelf'),
    });
    const baseline = await evaluateUserContextRoutingLunaBaseline({
      candidate: item,
      luna: luna('bookshelf'),
    });

    expect(compareUserContextRoutingPaired([firstRoute], [baseline])).toMatchObject({
      pairCount: 1,
      firstRouteDisagreementCount: 0,
      lunaOnlyDisagreementCount: 0,
      firstRouteGenerativeLlmCalls: 0,
      lunaOnlyGenerativeLlmCalls: 1,
    });
    expect(summarizeUserContextRoutingLunaBaseline([baseline])).toMatchObject({
      cost: {
        pricingVersion: expect.any(String),
        minimumCostMicros: expect.any(Number),
        maximumCostMicros: expect.any(Number),
      },
    });
  });

  it('reports external routing quality at case and conversation-group levels', async () => {
    const wrongGuide = await evaluateUserContextRoutingCase({
      candidate: {
        ...candidate('wrong-guide', 'external_clear', 'external_owner', 'bookshelf'),
        conversationGroupId: 'external-quality-group',
      },
      provider: provider(evaluated('schedule')),
      luna: luna('bookshelf'),
    });
    const missedReduction = await evaluateUserContextRoutingCase({
      candidate: {
        ...candidate('missed-reduction', 'external_clear', 'external_owner', 'bookshelf'),
        conversationGroupId: 'external-quality-group',
      },
      provider: provider(evaluated('user_context')),
      luna: luna('bookshelf'),
    });

    expect(summarizeUserContextRouting([wrongGuide, missedReduction])).toMatchObject({
      wrongExternalGuide: {
        caseLevel: { occurrences: 1, sampleCount: 2 },
        conversationGroupLevel: { occurrences: 1, sampleCount: 1 },
      },
      externalMissedReduction: {
        caseLevel: { occurrences: 1, sampleCount: 2 },
        conversationGroupLevel: { occurrences: 1, sampleCount: 1 },
      },
    });
  });

  it('computes exact one-sided Clopper-Pearson bounds', () => {
    expect(userContextRoutingClopperPearsonUpper95(0, 10)).toBeCloseTo(0.25886555, 7);
    expect(userContextRoutingClopperPearsonUpper95(10, 10)).toBe(1);
    expect(userContextRoutingClopperPearsonUpper95(0, 0)).toBeNull();
    expect(() => userContextRoutingClopperPearsonUpper95(2, 1)).toThrow();
  });
});
