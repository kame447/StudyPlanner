import type { Actual, Plan, ScheduleTemplate, StudyMaterial, TimetableTerm } from '../../types/domain';
import type { WeeklyPlanningTurnRequestContext } from './application/weeklyPlanningTemporalContext';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningWeekStartsOn } from './personalization/weeklyPlanningWeek';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningDialogueRendererTrace } from './trace/weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningTraceResponseSource } from './trace/weeklyPlanningTraceTypes';
import type { WeeklyPlanningMessage } from './types';

export interface WeeklyPlanningTurnExecutionInput {
  previousState?: PlanningIntakeState;
  messages: readonly WeeklyPlanningMessage[];
  userText: string;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  actuals?: Actual[];
  studyMaterials?: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  conversationId: string;
  traceRequestId: string;
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
  /**
   * Current production turns provide a request-clock capture from the runtime gateway.
   * Optionality exists only for pre-capture direct callers; the turn ingress upgrades those
   * callers once before entering Stable V5, whose runtime contract requires this context.
   */
  requestContext?: WeeklyPlanningTurnRequestContext;
}

export type WeeklyPlanningTurnFailureCode =
  | 'stable_v5_provider_failure'
  | 'stable_v5_normalization_rejected'
  | 'stable_v5_canonicalization_rejected';

export interface WeeklyPlanningTurnFailureDiagnostics {
  attemptCount: number;
  repairAttempted: boolean;
  validationErrorCategories: string[];
  providerErrorCategory: 'provider_error' | null;
}

export interface WeeklyPlanningTurnFailure {
  code: WeeklyPlanningTurnFailureCode;
  userMessage: string;
  traceCode: string;
  diagnostics: WeeklyPlanningTurnFailureDiagnostics;
}

export interface WeeklyPlanningTurnObservability {
  repairUsed: boolean | null;
  schedulerVersion: string | null;
  previewCount: number | null;
  unscheduledCount: number | null;
}

export interface WeeklyPlanningTurnExecutionResult {
  state: PlanningIntakeState;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
  preserveExistingPreview?: boolean;
  stableV5Graph?: WeeklyPlanningFactGraphV5;
  failure?: WeeklyPlanningTurnFailure;
  responseSource?: WeeklyPlanningTraceResponseSource;
  dialogueRendererTrace?: WeeklyPlanningDialogueRendererTrace;
  observability?: WeeklyPlanningTurnObservability;
}

export interface WeeklyPlanningTurnSubmissionResult {
  accepted: boolean;
  draftCandidates: WeeklyDraftCandidate[];
}
