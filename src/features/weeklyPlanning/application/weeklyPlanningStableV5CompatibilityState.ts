import type {
  PlanningIntakeState,
  WeeklyPlanningGroundingRecord,
  WeeklyPlanningRepairObligation,
} from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';

function emptyCompatibilityState(): PlanningIntakeState {
  return {
    status: 'idle',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    groundingRecords: [],
    repairAgenda: [],
    sourceTurns: [],
  };
}

export function projectStableV5CompatibilityState(params: {
  previousState?: PlanningIntakeState;
  userText: string;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
  questionCode?: string;
  questionFactId?: string;
  authorized: boolean;
  preserveExistingPreview?: boolean;
  groundingRecords?: WeeklyPlanningGroundingRecord[];
  repairAgenda?: WeeklyPlanningRepairObligation[];
}): PlanningIntakeState {
  const previous = params.previousState ?? emptyCompatibilityState();
  const hasDraft = params.draftCandidates.length > 0;
  const hasPreview = hasDraft || Boolean(params.preserveExistingPreview);
  const durableDraftGenerationIntent = params.authorized
    || previous.draftGenerationIntent === 'user_authorized'
    ? 'user_authorized'
    : 'not_requested';

  return {
    ...previous,
    status: hasPreview
      ? 'draft_ready'
      : params.questionCode
        ? 'revision_pending'
        : 'needs_scope',
    intent: 'weekly_study_planning',
    missing: [],
    questions: params.questionCode ? [params.message] : [],
    lastQuestionContext: params.questionCode
      ? {
          kind: 'missing',
          targetSlot: `stable_v5:${params.questionCode}`,
          intent: params.questionCode,
          topicId: params.questionFactId,
        }
      : undefined,
    shouldCreateDraft: params.preserveExistingPreview ? previous.shouldCreateDraft : hasDraft,
    shouldSavePlan: false,
    draftGenerationIntent: params.preserveExistingPreview
      ? previous.draftGenerationIntent
      : durableDraftGenerationIntent,
    groundingRecords: params.groundingRecords ?? previous.groundingRecords ?? [],
    repairAgenda: params.repairAgenda ?? previous.repairAgenda ?? [],
    sourceTurns: [...previous.sourceTurns, params.userText].slice(-32),
  };
}
