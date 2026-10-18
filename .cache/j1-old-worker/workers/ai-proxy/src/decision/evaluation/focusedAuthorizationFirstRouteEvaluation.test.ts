import { describe, expect, it, vi } from 'vitest';
import { gateDecision } from '../decisionPolicy';
import type { DecisionEvaluation, DecisionProvider } from '../decisionProvider';
import {
  evaluateFocusedAuthorizationLunaBaselineCase,
  evaluateFocusedAuthorizationFirstRouteCase,
  summarizeFocusedAuthorizationLunaBaseline,
  summarizeFocusedAuthorizationFirstRoute,
  type FocusedAuthorizationFirstRouteCandidate,
} from './focusedAuthorizationFirstRouteEvaluation';
import type {
  LunaFocusedAuthorizationEvaluation,
  LunaFocusedAuthorizationEvaluator,
} from './focusedAuthorizationLunaEvaluation';
import {
  focusedAuthorizationAmbiguousLimitedJudgmentIds,
  focusedAuthorizationFirstRouteCorpus,
} from './focusedAuthorizationFirstRouteCorpus';
import { focusedAuthorizationPolicyFingerprints } from './focusedAuthorizationPolicyFingerprint';
import holdoutEvidence from './evidence/focused-authorization-holdout-20260927.json';
import tuningEvidence from './evidence/focused-authorization-tuning-v2-20260927.json';

const candidate: FocusedAuthorizationFirstRouteCandidate = {
  id: 'case', conversationGroupId: 'group', layer: 'plain', split: 'tuning',
  currentUserText: 'はい', lastAssistantMessage: '計画案を作りますか？',
  expected: 'create_plan', labelStatus: 'test',
};

function evaluation(overrides: Partial<Extract<DecisionEvaluation, { status: 'evaluated' }>> = {}): DecisionEvaluation {
  return {
    status: 'evaluated', decision: 'create_plan', confidence: 0.999,
    probabilities: { create_plan: 0.999, fallback: 0.001 },
    conditionChange: 0.001, independentMeaning: 0.001,
    metadata: {
      provider: 'typesafe', requestedModel: 'test', servedModel: 'test',
      latencyMs: 10, inputTokens: 20, outputTokens: 3, costUsd: 0.001,
      requestBytes: 100, responseBytes: 50,
    },
    ...overrides,
  };
}

function provider(result: DecisionEvaluation): DecisionProvider {
  return { evaluate: vi.fn(async () => result) };
}

function luna(result: LunaFocusedAuthorizationEvaluation = {
  status: 'evaluated', decision: 'fallback',
  metadata: {
    requestedModel: 'gpt-5.6-luna', servedModel: 'gpt-5.6-luna', latencyMs: 20,
    promptTokens: 30, completionTokens: 4, costUsd: null,
  },
}): LunaFocusedAuthorizationEvaluator {
  return { evaluate: vi.fn(async () => result) };
}

describe('Jev-first focused authorization evaluation', () => {
  it('pins the catalog and gate fingerprints recorded with the consumed holdout', async () => {
    const fingerprints = {
      catalogSha256: 'b8ae8dff071ac14fe9aeac13ab5a0a555906dcc0b9f81b5afffea548ec87c2b7',
      gateSha256: '8ee49c51d476f3baccdaf21387a9856ea72800469f8f4ac0fcebca9fcdc597e0',
    };
    await expect(focusedAuthorizationPolicyFingerprints()).resolves.toEqual(fingerprints);
    expect(holdoutEvidence.policy).toMatchObject(fingerprints);
    expect(tuningEvidence.policy).toMatchObject(fingerprints);
  });

  it.each([
    ['tuning', tuningEvidence],
    ['holdout', holdoutEvidence],
  ] as const)('keeps the %s artifact typed, text-free and reproducible by the fixed gate', (_, artifact) => {
    expect(artifact.results).toHaveLength(artifact.caseCount);
    expect(artifact.containsRawConversationText).toBe(false);
    for (const result of artifact.results) {
      expect(result).not.toHaveProperty('currentUserText');
      expect(result).not.toHaveProperty('lastAssistantMessage');
      const gate = gateDecision({
        status: 'evaluated',
        decision: result.jevDecision as 'create_plan' | 'fallback',
        confidence: result.confidence as number,
        probabilities: result.probabilities as { create_plan: number; fallback: number },
        conditionChange: result.conditionChange as number,
        independentMeaning: result.independentMeaning as number,
        metadata: evaluation().metadata,
      });
      const route = gate.status === 'accepted'
        ? gate.decision === 'create_plan' ? 'jev_accepted_create' : 'jev_accepted_fallback'
        : gate.status === 'unavailable' ? 'unavailable_to_luna' : 'abstain_to_luna';
      expect(result.route).toBe(route);
    }
  });

  it('locks the tuning-81 create, fallback and strong-veto boundaries', () => {
    expect(gateDecision(evaluation({
      confidence: 0.9,
      probabilities: { create_plan: 0.95, fallback: 0.05 },
      conditionChange: 0.499,
      independentMeaning: 0.499,
    }))).toEqual({ status: 'accepted', decision: 'create_plan' });
    expect(gateDecision(evaluation({ confidence: 0.899 }))).toEqual({
      status: 'abstained', reason: 'uncertain',
    });
    expect(gateDecision(evaluation({
      probabilities: { create_plan: 0.949, fallback: 0.051 },
    }))).toEqual({ status: 'abstained', reason: 'uncertain' });
    expect(gateDecision(evaluation({ independentMeaning: 0.5 }))).toEqual({
      status: 'abstained', reason: 'conflicting_heads',
    });

    const fallback = evaluation({
      decision: 'fallback', confidence: 0.8,
      probabilities: { create_plan: 0.1, fallback: 0.9 },
      conditionChange: 0.2,
      independentMeaning: 0.2,
    });
    expect(gateDecision(fallback)).toEqual({ status: 'accepted', decision: 'fallback' });
    expect(gateDecision({ ...fallback, confidence: 0.799 })).toEqual({
      status: 'abstained', reason: 'uncertain',
    });
    expect(gateDecision(evaluation({
      confidence: 0.1,
      conditionChange: 0.9,
    }))).toEqual({ status: 'accepted', decision: 'fallback' });
  });

  it('uses the production dispatch and avoids Luna after an accepted Jev decision', async () => {
    const baseline = luna();
    const result = await evaluateFocusedAuthorizationFirstRouteCase({
      candidate, provider: provider(evaluation()), luna: baseline,
    });
    expect(result.route).toBe('jev_accepted_create');
    expect(result.final).toMatchObject({ status: 'evaluated', decision: 'create_plan' });
    expect(result.luna.called).toBe(false);
    expect(baseline.evaluate).not.toHaveBeenCalled();
    expect(result.authority).toEqual({
      maximumEffect: 'unsaved_draft_request', approvalGranted: false, saveGranted: false,
    });
  });

  it.each([
    ['abstain_to_luna', evaluation({ confidence: 0.5 })],
    ['unavailable_to_luna', {
      status: 'unavailable', reason: 'http', httpStatus: 429,
      metadata: evaluation().metadata,
    } satisfies DecisionEvaluation],
  ] as const)('uses Luna through dispatch for %s', async (route, jev) => {
    const result = await evaluateFocusedAuthorizationFirstRouteCase({
      candidate, provider: provider(jev), luna: luna(),
    });
    expect(result.route).toBe(route);
    expect(result.luna.called).toBe(true);
    expect(result.final).toMatchObject({ status: 'evaluated', decision: 'fallback' });
  });

  it('fails stale evaluation closed through Luna', async () => {
    const result = await evaluateFocusedAuthorizationFirstRouteCase({
      candidate, provider: provider(evaluation()), luna: luna(), contextCurrent: false,
    });
    expect(result.route).toBe('stale_context_to_luna');
    expect(result.jev).toMatchObject({ gate: 'unavailable', reason: 'stale_context' });
    expect(result.luna.called).toBe(true);
  });

  it('keeps both-provider failure controlled without inventing a parser result', async () => {
    const result = await evaluateFocusedAuthorizationFirstRouteCase({
      candidate,
      provider: provider({
        status: 'unavailable', reason: 'network', metadata: evaluation().metadata,
      }),
      luna: luna({
        status: 'unavailable', reason: 'network',
        metadata: {
          requestedModel: 'gpt-5.6-luna', servedModel: null, latencyMs: 20,
          promptTokens: null, completionTokens: null, costUsd: null,
        },
      }),
    });
    expect(result.final).toMatchObject({ status: 'controlled_failure', decision: null, httpStatus: 502 });
  });

  it('summarizes coverage, Luna reduction, false-create uncertainty, latency and cost', async () => {
    const first = await evaluateFocusedAuthorizationFirstRouteCase({
      candidate, provider: provider(evaluation()), luna: luna(),
    });
    const second = await evaluateFocusedAuthorizationFirstRouteCase({
      candidate: { ...candidate, id: 'negative', expected: 'fallback' },
      provider: provider(evaluation({ confidence: 0.5 })), luna: luna(),
    });
    const summary = summarizeFocusedAuthorizationFirstRoute([first, second]);
    expect(summary).toMatchObject({
      caseCount: 2,
      routes: { jev_accepted_create: 1, abstain_to_luna: 1 },
      jevCoverage: { numerator: 1, denominator: 2, value: 0.5 },
      lunaCallReduction: { numerator: 1, denominator: 2, value: 0.5 },
      falseCreate: { occurrences: 0, negativeSampleCount: 1 },
      provisionalLabelAgreement: { numerator: 2, denominator: 2, value: 1 },
    });
    expect(summary.falseCreate.oneSidedClopperPearsonUpper95).toBeGreaterThan(0);
  });

  it('evaluates and summarizes the paired Luna-only baseline without granting authority', async () => {
    const first = await evaluateFocusedAuthorizationLunaBaselineCase({
      candidate: { ...candidate, expected: 'fallback' },
      luna: luna({
        status: 'evaluated', decision: 'create_plan',
        metadata: {
          requestedModel: 'gpt-5.6-luna', servedModel: 'gpt-5.6-luna', latencyMs: 40,
          promptTokens: 30, completionTokens: 4, costUsd: null,
        },
      }),
    });
    const second = await evaluateFocusedAuthorizationLunaBaselineCase({
      candidate: { ...candidate, id: 'failure' },
      luna: luna({
        status: 'unavailable', reason: 'http',
        metadata: {
          requestedModel: 'gpt-5.6-luna', servedModel: null, latencyMs: 80,
          promptTokens: null, completionTokens: null, costUsd: null,
        },
      }),
    });
    expect(first.authority).toEqual({
      maximumEffect: 'unsaved_draft_request', approvalGranted: false, saveGranted: false,
    });
    expect(second.final).toEqual({ status: 'controlled_failure', decision: null, httpStatus: 502 });
    const summary = summarizeFocusedAuthorizationLunaBaseline([first, second]);
    expect(summary).toMatchObject({
      caseCount: 2,
      falseCreate: { occurrences: 1, negativeSampleCount: 1 },
      controlledFailureCount: 1,
      provisionalLabelAgreement: { numerator: 0, denominator: 2, value: 0 },
      latencyMs: { p50: 40, p95: 80 },
      usage: { promptTokens: { reportedComponentCount: 1, unknownComponentCount: 1 } },
    });
  });
});

describe('Jev-first corpus labels', () => {
  it('combines all 51 existing and 80 expansion cases without split leakage', () => {
    const tuning = focusedAuthorizationFirstRouteCorpus('tuning');
    const holdout = focusedAuthorizationFirstRouteCorpus('holdout');
    expect(tuning).toHaveLength(81);
    expect(holdout).toHaveLength(50);
    expect(new Set([...tuning, ...holdout].map((value) => value.id))).toHaveProperty('size', 131);
    const tuningGroups = new Set(tuning.map((value) => value.conversationGroupId));
    expect(holdout.some((value) => tuningGroups.has(value.conversationGroupId))).toBe(false);
    expect(focusedAuthorizationAmbiguousLimitedJudgmentIds()).toEqual([
      'x333-betsuni-a', 'x333-daijoubu-a', 'x333-ii-kamo-a', 'x333-kekkou-a',
      'x333-otsukare-a', 'x333-sore-a', 'x333-typo-b',
    ]);
  });
});
