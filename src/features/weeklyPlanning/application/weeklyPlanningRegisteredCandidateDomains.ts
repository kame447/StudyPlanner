import type { ControlledCandidateRegistry } from './weeklyPlanningControlledCandidateRegistry';
import type { ControlledCandidateDomainHost } from './weeklyPlanningControlledCandidateChoice';

/** Producer-owned registrations are supplied by their source-reviewed release unit.
 * No D5/date policy or runtime is activated by the shared port's introduction. */
export function weeklyPlanningRegisteredCandidateDomains(_host: ControlledCandidateDomainHost): ControlledCandidateRegistry {
  return [];
}
