import type { Plan, ScheduleTemplate } from '../../types/domain';
import type { WeeklyPlanningTurnRequestContext } from './application/weeklyPlanningTemporalContext';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningWeekStartsOn } from './personalization/weeklyPlanningWeek';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningDialogueRendererTrace } from './trace/weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningTraceResponseSource } from './trace/weeklyPlanningTraceTypes';
import type { WeeklyPlanningMessage } from './types';
import type { WeeklyPlanningEntryRoutingTrace } from './entry/weeklyPlanningEntryRouter';

export interface WeeklyPlanningTurnSubmissionOptions {
  entryRoutingTrace?: WeeklyPlanningEntryRoutingTrace;
}

export interface WeeklyPlanningTurnExecutionInput {
  previousState?: PlanningIntakeState;
  messages: readonly WeeklyPlanningMessage[];
  userText: string;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  conversationId: string;
  traceRequestId: string;
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
  requestContext?: WeeklyPlanningTurnRequestContext;
  entryRoutingTrace?: WeeklyPlanningEntryRoutingTrace;
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

export interface WeeklyPlanningTurnExecutionResult {
  state: PlanningIntakeState;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
  preserveExistingPreview?: boolean;
  stableV5Graph?: WeeklyPlanningFactGraphV5;
  failure?: WeeklyPlanningTurnFailure;
  responseSource?: WeeklyPlanningTraceResponseSource;
  dialogueRendererTrace?: WeeklyPlanningDialogueRendererTrace;
}

export interface WeeklyPlanningTurnSubmissionResult {
  accepted: boolean;
  draftCandidates: WeeklyDraftCandidate[];
}
