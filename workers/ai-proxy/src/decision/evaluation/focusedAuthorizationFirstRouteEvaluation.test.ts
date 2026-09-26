import { describe, expect, it, vi } from 'vitest';
import type { DecisionEvaluation, DecisionProvider } from '../decisionProvider';
import {
  evaluateFocusedAuthorizationFirstRouteCase,
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
    });
    expect(summary.falseCreate.oneSidedClopperPearsonUpper95).toBeGreaterThan(0);
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
