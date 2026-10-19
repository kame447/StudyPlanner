import type { ControlledCandidateDomain } from './weeklyPlanningControlledCandidateDomains';
import type { ControlledCandidateDomainOptions } from './weeklyPlanningControlledCandidateRegistry';
import type { WeeklyPlanningCandidateChoiceServices } from './weeklyPlanningCandidateChoiceConnection';
import type { WeeklyPlanningSemanticTurnObservation } from '../trace/weeklyPlanningSemanticCensus';
import { validateControlledCandidateChoiceConfiguration } from './weeklyPlanningCandidateChoiceCalibration';
import { createCandidateChoiceClient } from '../../../services/ai/candidateChoiceClient';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { getAiConfig } from '../../../lib/aiConfig';
import { createSemanticTurnCensusScope, productionSemanticCensusOptions } from '../../productObservability/semanticTurnCensus';
import type { SemanticCensusMetadata } from '../../../../shared/semanticTurnCensus';

export interface ControlledCandidateDomainHost extends Pick<ControlledCandidateDomainOptions, 'inputForTurn' | 'requestContextForTurn' | 'continueSelectedTurn' | 'sourceAccess'> {
  readonly choiceServices?: WeeklyPlanningCandidateChoiceServices;
  readonly censusMetadata?: SemanticCensusMetadata;
  semanticObservation(): WeeklyPlanningSemanticTurnObservation | undefined;
  bindSemanticObservation(observation: WeeklyPlanningSemanticTurnObservation): void;
}
/** Explicit per-domain policy only. Purpose100 and a C5 artifact cannot activate sibling domains. */
export function createControlledCandidateChoiceOptions(domain: ControlledCandidateDomain, configuration: unknown, host: ControlledCandidateDomainHost): ControlledCandidateDomainOptions | undefined {
  const artifact = validateControlledCandidateChoiceConfiguration(configuration, domain.domainId, domain.domainPolicyVersion);
  if (!artifact || artifact.mode !== 'canary') return undefined;
  try {
    let observation = host.semanticObservation();
    if (!observation) {
      const scope = createSemanticTurnCensusScope({ client: createOpenAiCompatibleClient(getAiConfig()), domain: 'weekly-planning',
        metadata: host.censusMetadata, ...(host.choiceServices?.census ?? productionSemanticCensusOptions()) });
      let finished = false;
      observation = { client: scope.client, finish(resolution) { if (finished) return; finished = true; scope.finish(resolution); } };
      host.bindSemanticObservation(observation);
    }
    const client = createCandidateChoiceClient({ ...host.choiceServices, semanticPolicy: artifact.semanticPolicy,
      semanticCensusObserver: observation.client.semanticCensusObserver });
    return { policy: artifact.choicePolicy, maximumChildrenPerMenu: artifact.maximumChildrenPerMenu,
      maximumDecisions: artifact.maximumDecisions, choose: client.choose,
      sourceAccess: host.sourceAccess, inputForTurn: host.inputForTurn, requestContextForTurn: host.requestContextForTurn,
      continueSelectedTurn: host.continueSelectedTurn };
  } catch { return undefined; }
}
