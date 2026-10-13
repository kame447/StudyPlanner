import { WEEKLY_PLANNING_C5_CHOICE_CALIBRATION, validateWeeklyPlanningCandidateChoiceConfiguration } from './weeklyPlanningCandidateChoiceCalibration';
import type { WeeklyPlanningSemanticTurnObservation } from '../trace/weeklyPlanningSemanticCensus';
import { createCandidateChoiceClient, type CandidateSemanticGatePolicy } from '../../../services/ai/candidateChoiceClient';
import type { CalibratedChoicePolicy } from './candidateSelection/contracts';
import type { C5LocalSelectionOptions } from './c5LocalSelection/contracts';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { getAiConfig } from '../../../lib/aiConfig';
import { createSemanticTurnCensusScope, productionSemanticCensusOptions, type SemanticCensusSink } from '../../productObservability/semanticTurnCensus';
import type { SemanticCensusMetadata } from '../../../../shared/semanticTurnCensus';

export interface WeeklyPlanningCandidateChoiceConfiguration {
  readonly domain: 'c5_effort';
  readonly mode: 'off' | 'canary';
  readonly choicePolicy: CalibratedChoicePolicy;
  readonly semanticPolicy: CandidateSemanticGatePolicy;
  readonly maximumChildrenPerMenu: number;
  readonly maximumDecisions: number;
}
export interface WeeklyPlanningCandidateChoiceServices {
  readonly configuration: unknown;
  readonly proxyUrl?: string;
  readonly getToken?: () => Promise<string>;
  readonly transport?: typeof fetch;
  readonly census?: { enabled: boolean; sink?: SemanticCensusSink };
}

export function createWeeklyPlanningCandidateChoiceOptions(params: {
  sourceAccess: C5LocalSelectionOptions['sourceAccess'];
  continueSelectedTurn: C5LocalSelectionOptions['continueSelectedTurn'];
  services?: WeeklyPlanningCandidateChoiceServices;
  censusMetadata?: SemanticCensusMetadata;
}): (C5LocalSelectionOptions & {
  semanticObservation: WeeklyPlanningSemanticTurnObservation;
  finishCensus(resolution: 'success' | 'failure' | 'unknown'): void;
}) | undefined {
  const configuration = validateWeeklyPlanningCandidateChoiceConfiguration(
    params.services ? params.services.configuration : WEEKLY_PLANNING_C5_CHOICE_CALIBRATION,
  );
  if (!configuration || configuration.domain !== 'c5_effort' || configuration.mode !== 'canary') return undefined;
  let finish: ((resolution: 'success' | 'failure' | 'unknown') => void) | undefined;
  try {
    const scope = createSemanticTurnCensusScope({ client: createOpenAiCompatibleClient(getAiConfig()),
      domain: 'weekly-planning', metadata: params.censusMetadata,
      ...(params.services?.census ?? productionSemanticCensusOptions()) });
    let finished = false;
    const observation = { client: scope.client, finish(resolution: 'success' | 'failure' | 'unknown') {
      if (finished) return;
      finished = true; scope.finish(resolution);
    } };
    finish = observation.finish;
    const client = createCandidateChoiceClient({ ...params.services, semanticPolicy: configuration.semanticPolicy,
      semanticCensusObserver: scope.client.semanticCensusObserver });
    return { policy: structuredClone(configuration.choicePolicy), maximumChildrenPerMenu: configuration.maximumChildrenPerMenu,
      maximumDecisions: configuration.maximumDecisions, choose: client.choose,
      semanticObservation: observation, finishCensus: observation.finish,
      sourceAccess: params.sourceAccess, continueSelectedTurn: params.continueSelectedTurn };
  } catch { finish?.('unknown'); return undefined; }
}
