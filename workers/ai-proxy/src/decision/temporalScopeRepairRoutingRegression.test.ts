import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS,
} from '../../../../src/features/weeklyPlanning/security/weeklyPlanningIssue152AdversarialCorpus';
import type { TemporalScopeRepairDecisionContext } from '../../../../shared/temporalScopeRepairDecision';
import type { DecisionEvaluation, DecisionProvider } from './decisionProvider';
import { dispatchTemporalScopeRepair } from './temporalScopeRepairDispatch';
import type { TemporalScopeRepairDecision } from './temporalScopeRepairDecisionPolicy';

const metadata = {
  provider: 'typesafe' as const,
  requestedModel: 'security-fixture',
  servedModel: 'security-fixture',
  latencyMs: 1,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  requestBytes: 1,
  responseBytes: 1,
};

function provider(
  decision: TemporalScopeRepairDecision,
  confidence = 0.999,
): DecisionProvider<TemporalScopeRepairDecisionContext['state'], TemporalScopeRepairDecision> {
  return {
    evaluate: vi.fn(async (): Promise<DecisionEvaluation<TemporalScopeRepairDecision>> => ({
      status: 'evaluated',
      decision,
      confidence,
      probabilities: decision === 'plan_unavailable'
        ? { plan_unavailable: 0.999, uncertain: 0.001 }
        : { plan_unavailable: 0.001, uncertain: 0.999 },
      conditionChange: 0.001,
      independentMeaning: 0.001,
      metadata,
    })),
  };
}

async function execute(params: {
  sourceText: string;
  provider: DecisionProvider<
    TemporalScopeRepairDecisionContext['state'],
    TemporalScopeRepairDecision
  >;
  lunaDecision: TemporalScopeRepairDecision;
}) {
  const fallback = vi.fn(async () => Response.json({
    content: JSON.stringify({ decision: params.lunaDecision }),
  }));
  const response = await dispatchTemporalScopeRepair({
    context: {
      purpose: 'temporal_scope_repair',
      requestId: crypto.randomUUID(),
      inputRevision: 1,
      state: {
        sourceText: params.sourceText,
        currentAttachedTask: { title: '数学の問題集' },
        interpretedTime: {
          dateExpression: 'weekday:tuesday',
          namedTimePeriod: null,
          startTime: '18:00',
          endTime: '20:00',
        },
      },
    },
    env: { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100' },
    firebaseUid: 'security-fixture',
    signal: new AbortController().signal,
    fallback,
    respond: (decision) => Response.json({ content: JSON.stringify(decision) }),
    provider: params.provider,
  });
  const body = await response.json() as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['content']);
  const content = JSON.parse(String(body.content)) as Record<string, unknown>;
  expect(Object.keys(content)).toEqual(['decision']);
  expect(['plan_unavailable', 'uncertain']).toContain(content.decision);
  expect(body).not.toHaveProperty('approved');
  expect(body).not.toHaveProperty('saved');
  expect(body).not.toHaveProperty('previewApproved');
  expect(body).not.toHaveProperty('canonicalId');
  return { content, fallback };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Issue #335 temporal-scope routing regression', () => {
  it.each(WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS)(
    'contains a high-confidence Jev result for attack $id inside the repair decision',
    async ({ text }) => {
      const decision = text.length % 2 === 0 ? 'plan_unavailable' : 'uncertain';
      const result = await execute({
        sourceText: text,
        provider: provider(decision),
        lunaDecision: 'uncertain',
      });
      expect(result.content).toEqual({ decision });
      expect(result.fallback).not.toHaveBeenCalled();
    },
  );

  it.each(WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS)(
    'uses the unchanged Luna envelope for an abstaining attack $id',
    async ({ text }) => {
      const result = await execute({
        sourceText: text,
        provider: provider('plan_unavailable', 0.5),
        lunaDecision: 'uncertain',
      });
      expect(result.content).toEqual({ decision: 'uncertain' });
      expect(result.fallback).toHaveBeenCalledTimes(1);
    },
  );
});
