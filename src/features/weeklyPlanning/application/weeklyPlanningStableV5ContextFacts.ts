import { weeklyPlanningEvidenceChannelForSourceTextV5 } from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';
import { isUserUtteranceSourcedV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { UserPlanningContextSemanticFactV1 } from '../../userPlanningContext/userPlanningContextTypes';

export function userUtteranceContextFactsV5(params: {
  facts: UserPlanningContextSemanticFactV1[];
  userText: string;
  supplementalContext?: string;
}): UserPlanningContextSemanticFactV1[] {
  return params.facts.filter((fact) => isUserUtteranceSourcedV5({
    channel: weeklyPlanningEvidenceChannelForSourceTextV5(
      fact.sourceText,
      params.userText,
      params.supplementalContext,
    ),
  }));
}
