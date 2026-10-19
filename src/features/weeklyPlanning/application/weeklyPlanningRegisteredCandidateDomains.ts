import type { ControlledCandidateRegistry } from './weeklyPlanningControlledCandidateRegistry';
import { registerControlledCandidateDomain } from './weeklyPlanningControlledCandidateRegistry';
import type { ControlledCandidateDomainHost } from './weeklyPlanningControlledCandidateChoice';
import { createControlledCandidateChoiceOptions } from './weeklyPlanningControlledCandidateChoice';
import { createNumericPendingRegisteredDomainV5 } from '../semantic/weeklyPlanningNumericRegisteredDomainV5';
import { createTemporalDateRegisteredDomainV5 } from '../semantic/weeklyPlanningTemporalDateRegisteredDomainV5';

/** A question-time finite menu. Unsupported exact values and approximations return to Luna. */
export const D5_EXACT_MINUTE_CANDIDATES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 45, 60] as const;
export const D5_DOMAIN_POLICY_VERSION = 'd5-exact-minutes-2026-10-14-v1';

/** A release artifact is required before this domain may consume a live turn. */
export const D5_CHOICE_CALIBRATION: unknown = null;

export const TEMPORAL_DATE_CHOICE_CALIBRATION: unknown = null;

export function weeklyPlanningRegisteredCandidateDomains(host: ControlledCandidateDomainHost): ControlledCandidateRegistry {
  const domain = createNumericPendingRegisteredDomainV5(D5_EXACT_MINUTE_CANDIDATES, D5_DOMAIN_POLICY_VERSION);
  const options = createControlledCandidateChoiceOptions(domain, D5_CHOICE_CALIBRATION, host);
  // Keep the uncalibrated date producer out of startup and the production bundle.
  const dateDomain = TEMPORAL_DATE_CHOICE_CALIBRATION === null
    ? null : createTemporalDateRegisteredDomainV5();
  const dateOptions = dateDomain
    ? createControlledCandidateChoiceOptions(dateDomain, TEMPORAL_DATE_CHOICE_CALIBRATION, host)
    : undefined;
  return [
    ...(options ? [registerControlledCandidateDomain(domain, options)] : []),
    ...(dateDomain && dateOptions ? [registerControlledCandidateDomain(dateDomain, dateOptions)] : []),
  ];
}
