import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemporalSideContributionDecisionContext } from '../../../../shared/temporalSideContributionDecision';
import type { DecisionEvaluation, DecisionMetadata, DecisionProvider } from './decisionProvider';
import { dispatchTemporalSideContribution } from './temporalSideContributionDispatch';
import type { TemporalSideContributionChoice } from './temporalSideContributionDecisionPolicy';

const metadata: DecisionMetadata = {
  provider: 'typesafe', requestedModel: 'fixture', servedModel: 'fixture', latencyMs: 1,
  inputTokens: null, outputTokens: null, costUsd: null, requestBytes: 1, responseBytes: 1,
};
const context: TemporalSideContributionDecisionContext = {
  purpose: 'temporal_side_contribution', requestId: 'request-1', inputRevision: 1,
  state: {
    currentUserText: 'はい、それでいいです。',
    knownTask: { title: '数学の問題集', category: 'study' },
    pendingQuestion: { questionCode: 'missing_schedulable_work' },
  },
};

function evaluated(
  decision: TemporalSideContributionChoice,
  overrides: Partial<{ confidence: number; probability: number; temporalPossibility: number; ambiguity: number }> = {},
): DecisionEvaluation<TemporalSideContributionChoice> {
  const probability = overrides.probability ?? 0.999;
  return {
    status: 'evaluated', decision, confidence: overrides.confidence ?? 0.999,
    probabilities: {
      temporal_constraint_present: decision === 'temporal_constraint_present' ? probability : 0,
      no_temporal_side_contribution: decision === 'no_temporal_side_contribution' ? probability : 0,
      uncertain: decision === 'uncertain' ? probability : 0,
      other: decision === 'other' ? probability : 0,
    },
    conditionChange: overrides.temporalPossibility ?? 0.001,
    independentMeaning: overrides.ambiguity ?? 0.001,
    metadata,
  };
}

function provider(result: DecisionEvaluation<TemporalSideContributionChoice>):
DecisionProvider<TemporalSideContributionDecisionContext['state'], TemporalSideContributionChoice> {
  return { evaluate: vi.fn(async () => result) };
}

async function execute(result: DecisionEvaluation<TemporalSideContributionChoice>, mode = 'canary') {
  const fallback = vi.fn(async () => Response.json({ content: JSON.stringify({
    decision: 'fallback', kind: null, constraintLevel: null, dateExpression: null,
    namedTimePeriod: null, startTime: null, endTime: null, precision: null,
  }) }));
  const response = await dispatchTemporalSideContribution({
    context, env: { JEV_MODE: mode, JEV_CANARY_PERCENT: '100' },
    firebaseUid: 'fixture', signal: new AbortController().signal, fallback,
    respond: (decision) => Response.json({ content: JSON.stringify(decision) }),
    provider: provider(result),
  });
  return { response, fallback };
}

beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('temporal-side dispatch', () => {
  it('keeps off mode on the exact Luna response', async () => {
    const { response, fallback } = await execute(evaluated('no_temporal_side_contribution'), 'off');
    expect(fallback).toHaveBeenCalledOnce();
    expect((await response.json() as { content: string }).content).toContain('"fallback"');
  });

  it('accepts only a strongly supported negative choice', async () => {
    const { response, fallback } = await execute(evaluated('no_temporal_side_contribution'));
    expect(fallback).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      content: JSON.stringify({ decision: 'no_temporal_side_contribution' }),
    });
  });

  it.each([
    ['temporal', evaluated('temporal_constraint_present')],
    ['uncertain', evaluated('uncertain')],
    ['other', evaluated('other')],
    ['low confidence', evaluated('no_temporal_side_contribution', { confidence: 0.5 })],
    ['low probability', evaluated('no_temporal_side_contribution', { probability: 0.5 })],
    ['possible temporal', evaluated('no_temporal_side_contribution', { temporalPossibility: 0.5 })],
    ['ambiguous', evaluated('no_temporal_side_contribution', { ambiguity: 0.8 })],
    ['timeout', { status: 'unavailable', reason: 'timeout', metadata }],
    ['HTTP failure', { status: 'unavailable', reason: 'http', httpStatus: 429, metadata }],
    ['invalid response', { status: 'unavailable', reason: 'invalid_response', metadata }],
  ] as const)('uses Luna for %s', async (_name, result) => {
    const { response, fallback } = await execute(result);
    expect(fallback).toHaveBeenCalledOnce();
    expect((await response.json() as { content: string }).content).toContain('"fallback"');
  });
});
