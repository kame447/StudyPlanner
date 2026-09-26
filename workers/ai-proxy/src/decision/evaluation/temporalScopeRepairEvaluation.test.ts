import { describe, expect, it } from 'vitest';
import {
  clopperPearsonUpper95,
  summarizeTemporalScopeRepairEvaluation,
  type TemporalScopeRepairEvaluationRecord,
} from './temporalScopeRepairEvaluation';

function record(overrides: Partial<TemporalScopeRepairEvaluationRecord> = {}):
TemporalScopeRepairEvaluationRecord {
  return {
    caseId: 'case-1',
    group: 'group-1',
    split: 'holdout',
    caseClass: 'uncertain',
    labelSource: 'synthetic_unreviewed',
    expected: 'uncertain',
    route: 'jev_first',
    providerStatus: 'evaluated',
    providerReason: null,
    providerHttpStatus: null,
    rawChoice: 'uncertain',
    confidence: 0.99,
    selectedProbability: 0.99,
    conditionChange: 0.01,
    independentMeaning: 0.01,
    gate: { status: 'accepted', decision: 'uncertain' },
    lunaCalled: false,
    lunaStatus: null,
    finalDecision: 'uncertain',
    unexpectedResponseKeys: [],
    unexpectedDecisionKeys: [],
    totalLatencyMs: 10,
    jevLatencyMs: 10,
    jevInputTokens: 10,
    jevOutputTokens: 2,
    jevCostUsd: 0.00001,
    lunaLatencyMs: null,
    lunaPromptTokens: null,
    lunaCompletionTokens: null,
    ...overrides,
  };
}

describe('temporal-scope evaluation summary', () => {
  it('reports case and conversation-group false-accept bounds separately', () => {
    const summary = summarizeTemporalScopeRepairEvaluation([
      record(),
      record({ caseId: 'case-2', group: 'group-1', finalDecision: 'plan_unavailable' }),
      record({ caseId: 'case-3', group: 'group-2' }),
    ]);
    expect(summary.planUnavailableFalseAccept).toMatchObject({
      cases: 1,
      denominatorCases: 3,
      groups: 1,
      denominatorGroups: 2,
      caseIds: ['case-2'],
    });
    expect(summary.planUnavailableFalseAccept.upper95Cases).not.toBe(
      summary.planUnavailableFalseAccept.upper95Groups,
    );
  });

  it('bounds Luna cost when cache allocation is absent', () => {
    const summary = summarizeTemporalScopeRepairEvaluation([
      record({
        lunaCalled: true,
        lunaStatus: 200,
        lunaPromptTokens: 1_000,
        lunaCompletionTokens: 100,
      }),
    ]);
    expect(summary.usageAndCost.luna).toMatchObject({
      knownCalls: 1,
      missingUsageCalls: 0,
      lowerUsd: 0.00014,
      upperUsd: 0.00037,
    });
  });

  it('matches the one-sided 0/22 reference bound from the prior audit', () => {
    expect(clopperPearsonUpper95(0, 22)).toBeCloseTo(0.1271, 3);
  });
});
