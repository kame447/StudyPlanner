import type {
  PlanningOpportunityTag,
} from '../planning/weeklyPlanningBehaviorTypes';

export interface AcceptedAssumptionDependencyMetadata {
  proposalId: string;
  targetRef: string;
  proposalCreatedFromStateRevision: number;
}

export interface BehaviorAwarePreviewMetadata {
  conversationId?: string;
  stateRevision: number;
  sourceFactRefs: string[];
  usedAssumptionProposalRefs: string[];
  acceptedAssumptionDependencies?: AcceptedAssumptionDependencyMetadata[];
  taskRef: string;
  opportunityTags: PlanningOpportunityTag[];
  reasoningKey:
    | 'explicit-duration'
    | 'explicit-unit-rate'
    | 'accepted-assumption-duration';
}
