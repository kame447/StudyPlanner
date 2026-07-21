export type PlanningFactOrigin =
  | 'user_explicit'
  | 'deterministic_derived'
  | 'accepted_assumption'
  | 'profile_memory';

export type PlanningFactScope =
  | 'current_turn'
  | 'current_plan'
  | 'current_week'
  | 'recurring_profile';

export type PlanningConfidence = 'high' | 'medium' | 'low';

export type LifeActivityKind =
  | 'school'
  | 'work'
  | 'commute'
  | 'meal'
  | 'bath'
  | 'sleep'
  | 'rest'
  | 'preparation'
  | 'fixed_event';

export interface LifeActivityAnchor {
  anchorId: string;
  kind: LifeActivityKind;
  date?: string;
  startTime?: string;
  endTime?: string;
  sourceFactRefs: string[];
  origin: PlanningFactOrigin;
  scope: PlanningFactScope;
  confidence: PlanningConfidence;
}

export type StudyActivityKind =
  | 'memorization'
  | 'drill'
  | 'reading'
  | 'writing'
  | 'problem_solving'
  | 'project'
  | 'review'
  | 'unknown';

export type TaskDistributionPolicy =
  | 'single_block'
  | 'contiguous'
  | 'splittable'
  | 'spaced'
  | 'sequential_units';

export type CognitiveLoad = 'light' | 'medium' | 'heavy' | 'unknown';

export interface TaskExecutionProfile {
  taskRef: string;
  activityKind: StudyActivityKind;
  distributionPolicy: TaskDistributionPolicy;
  cognitiveLoad: CognitiveLoad;
  minSessionMinutes?: number;
  targetSessionMinutes?: number;
  maxSessionMinutes?: number;
  repetitionsPerDay?: number;
  minimumSpacingMinutes?: number;
  hardDeadline?: string;
  preferredCompletionBy?: string;
  sourceFactRefs: string[];
  confidence: PlanningConfidence;
  origin:
    | 'user_explicit'
    | 'ai_interpreted'
    | 'deterministic_derived'
    | 'pending_proposal'
    | 'accepted_assumption';
}

export type PlanningOpportunityTag =
  | 'before_meal'
  | 'after_meal'
  | 'after_school'
  | 'after_work'
  | 'after_commute'
  | 'before_sleep'
  | 'after_rest'
  | 'long_contiguous_window'
  | 'short_transition_window'
  | 'low_activation'
  | 'high_continuity';

export type OpportunitySuitability = 0 | 1 | 2 | 3;

export interface PlanningOpportunityAnnotation {
  availabilityRangeRef: string;
  anchorRefs: string[];
  tags: PlanningOpportunityTag[];
  suitabilityByActivity: Partial<
    Record<StudyActivityKind, OpportunitySuitability>
  >;
  sourceFactRefs: string[];
}

export type PlanningDimension =
  | 'planning_intent'
  | 'planning_range'
  | 'task_identity'
  | 'goal_scope'
  | 'workload'
  | 'deadline'
  | 'task_execution_profile'
  | 'availability_basis'
  | 'routine_anchors';

export type PlanningReadinessStage =
  | 'exploration'
  | 'hypothesis_ready'
  | 'proposal_ready'
  | 'preview_ready';

export type DraftGenerationIntent =
  | 'not_requested'
  | 'assistant_suggested'
  | 'user_authorized';

export interface PlanningReadinessPolicy {
  policyId: 'non_exam_weekly_plan' | 'exam_weekly_plan';
  hardRequiredDimensions: PlanningDimension[];
  countedDimensions: PlanningDimension[];
  minimumResolvedCount: number;
  previewRequiredDimensions: PlanningDimension[];
}

export interface PlanningReadinessSnapshot {
  stage: PlanningReadinessStage;
  resolvedDimensions: PlanningDimension[];
  unresolvedDimensions: PlanningDimension[];
  blockingDimensions: PlanningDimension[];
  resolvedCount: number;
  policyId: PlanningReadinessPolicy['policyId'];
  draftGenerationIntent: DraftGenerationIntent;
  allowedAssumptionSlots: string[];
  stateRevision: number;
}

export type MissingResolutionMode =
  | 'derive_deterministically'
  | 'propose_default'
  | 'offer_options'
  | 'must_confirm';

export type ResolutionImpact = 'low' | 'medium' | 'high';

export interface MissingResolutionOpportunity {
  topicId: string;
  dimension: PlanningDimension;
  mode: MissingResolutionMode;
  impact: ResolutionImpact;
  uncertainty: PlanningConfidence;
  proposalSlot?: string;
  allowedOptionIds: string[];
  sourceFactRefs: string[];
}

export type PlanningSuggestedNextAction =
  | 'acknowledge'
  | 'propose_resolution'
  | 'offer_options'
  | 'ask_required_fact'
  | 'suggest_draft_generation'
  | 'generate_preview';

export interface PlanningHypothesisSnapshot {
  conversationId: string;
  stateRevision: number;
  taskProfiles: TaskExecutionProfile[];
  lifeActivityAnchors: LifeActivityAnchor[];
  opportunityAnnotations: PlanningOpportunityAnnotation[];
  resolutionOpportunities: MissingResolutionOpportunity[];
  readiness: PlanningReadinessSnapshot;
  suggestedNextAction: PlanningSuggestedNextAction;
}

export type AllowedDialogueActionKind =
  | 'acknowledge_fact'
  | 'ask_required_fact'
  | 'propose_default'
  | 'show_options'
  | 'suggest_draft_generation'
  | 'generate_preview'
  | 'explain_clarification'
  | 'report_infeasibility';

export interface AllowedDialogueAction {
  actionId: string;
  kind: AllowedDialogueActionKind;
  topicId: string;
  sourceFactRefs: string[];
  allowedProposalRefs: string[];
  allowedOptionIds: string[];
  maxItems: number;
  displayHint?: string;
}

export type PreviewGateReason =
  | 'allowed'
  | 'not_ready'
  | 'not_user_authorized'
  | 'blocking_dimension'
  | 'stale_revision'
  | 'missing_execution_shape'
  | 'missing_availability_basis';

export interface PreviewGateResult {
  allowed: boolean;
  reason: PreviewGateReason;
}

export interface BehaviorAwareDialogueResponse {
  acknowledgement?: string;
  selectedActionIds: string[];
  items: Array<{
    actionId: string;
    text: string;
    optionIds?: string[];
  }>;
  reasoningSummary?: string;
}
