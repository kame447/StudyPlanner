// Imported only by the per-Page E2E application seam, never by src/production.
import { createNumericPendingRegisteredDomainV5 } from '../../../src/features/weeklyPlanning/semantic/weeklyPlanningNumericRegisteredDomainV5';
import { D5_TOP1_ANSWER_POLICY_VERSION } from '../../../shared/d5AnswerPolicy';
import { D5_EXACT_MINUTE_CANDIDATES } from '../../../src/features/weeklyPlanning/application/weeklyPlanningRegisteredCandidateDomains';
import { createControlledCandidateChoiceOptions } from '../../../src/features/weeklyPlanning/application/weeklyPlanningControlledCandidateChoice';
import { registerControlledCandidateDomain } from '../../../src/features/weeklyPlanning/application/weeklyPlanningControlledCandidateRegistry';
export function devD5Domains(host) {
  const domain = createNumericPendingRegisteredDomainV5(D5_EXACT_MINUTE_CANDIDATES, D5_TOP1_ANSWER_POLICY_VERSION, { candidateSource: 'answer_proposal' });
  const options = createControlledCandidateChoiceOptions(domain, {
    domain: 'd5_numeric', domainPolicyVersion: D5_TOP1_ANSWER_POLICY_VERSION, mode: 'canary',
    choicePolicy: { id: 'd5-top1-dev-only', calibrationEvidenceId: 'synthetic-development-only',
      rules: Array.from({ length: 8 }, (_, i) => ({ menuKind: 'leaves', optionCount: i + 2, depth: 0, minimumTopProbability: 0, minimumMargin: 0 })) },
    semanticPolicy: { calibrationEvidenceId: 'synthetic-development-only', maximumConditionChange: .5, maximumIndependentMeaning: .5 },
    maximumChildrenPerMenu: 8, maximumDecisions: 1,
  }, host);
  globalThis.__d5DevRegistry = { enabled: !!options, domainId: domain.domainId, domainPolicyVersion: domain.domainPolicyVersion, sourceAccess: host.sourceAccess() };
  if (!options) throw new Error('D5 dev registration failed');
  return [registerControlledCandidateDomain(domain, options)];
}
