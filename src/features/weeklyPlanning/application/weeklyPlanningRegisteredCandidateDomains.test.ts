import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlledCandidateDomainHost } from './weeklyPlanningControlledCandidateChoice';
import * as choice from './weeklyPlanningControlledCandidateChoice';
import { validateControlledCandidateChoiceConfiguration } from './weeklyPlanningCandidateChoiceCalibration';
import { D5_ANSWER_PROPOSAL_CALIBRATION, D5_ANSWER_PROPOSAL_POLICY_VERSION, D5_CHOICE_CALIBRATION,
  D5_DOMAIN_POLICY_VERSION, weeklyPlanningRegisteredCandidateDomains } from './weeklyPlanningRegisteredCandidateDomains';

afterEach(() => vi.restoreAllMocks());

describe('D5 registration release boundary', () => {
  it('keeps both calibrations null and all domains absent by default', () => {
    expect(D5_CHOICE_CALIBRATION).toBeNull();
    expect(D5_ANSWER_PROPOSAL_CALIBRATION).toBeNull();
    expect(weeklyPlanningRegisteredCandidateDomains({} as ControlledCandidateDomainHost)).toEqual([]);
  });

  it.each(['canary', 'off', 'malformed'] as const)('registers at most one D5 when the proposal calibration is %s', mode => {
    const actual = choice.createControlledCandidateChoiceOptions;
    const calls: string[] = [];
    // Inject release artifacts at their validator port without changing production constants.
    vi.spyOn(choice, 'createControlledCandidateChoiceOptions').mockImplementation((domain, configuration, host) => {
      calls.push(domain.domainPolicyVersion);
      const proposal = domain.domainPolicyVersion === D5_ANSWER_PROPOSAL_POLICY_VERSION;
      const artifact = { domain: domain.domainId, domainPolicyVersion: domain.domainPolicyVersion,
        mode: proposal && mode === 'off' ? 'off' : 'canary',
        choicePolicy: { id: 'synthetic-only', calibrationEvidenceId: 'synthetic-only', rules: Array.from({ length: 8 }, (_, i) => ({
          menuKind: 'leaves', optionCount: i + 2, depth: 0, minimumTopProbability: 0.90, minimumMargin: 0.80 })) },
        semanticPolicy: { calibrationEvidenceId: 'synthetic-only', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 },
        maximumChildrenPerMenu: 8, maximumDecisions: 1 };
      expect(configuration).toBeNull();
      expect(validateControlledCandidateChoiceConfiguration(artifact, domain.domainId, domain.domainPolicyVersion)).toBeDefined();
      return actual(domain, proposal && mode === 'malformed' ? { ...artifact, domainPolicyVersion: 'wrong' } : artifact, host);
    });
    const host = { semanticObservation: () => ({ client: {}, finish: vi.fn() }) } as unknown as ControlledCandidateDomainHost;
    const registered = weeklyPlanningRegisteredCandidateDomains(host);
    expect(registered.map(d => [d.domainId, d.questionCode])).toEqual([['d5_numeric', 'missing_effort_estimate']]);
    expect(calls).toEqual(mode === 'canary' ? [D5_ANSWER_PROPOSAL_POLICY_VERSION]
      : [D5_ANSWER_PROPOSAL_POLICY_VERSION, D5_DOMAIN_POLICY_VERSION]);
  });
});
