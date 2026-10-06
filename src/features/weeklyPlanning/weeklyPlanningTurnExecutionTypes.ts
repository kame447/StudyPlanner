import type {
  Actual,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  StudyMaterial,
  TimetableTerm,
} from '../../types/domain';
import type { WeeklyPlanningInteractionOutcome } from './application/weeklyPlanningInteractionOutcome';
import type { WeeklyPlanningTurnRequestContext } from './application/weeklyPlanningTemporalContext';
import type {
  PlanningIntakeState,
  WeeklyPlanningQuestionPresentationContent,
} from './intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningWeekStartsOn } from './personalization/weeklyPlanningWeek';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSelectedStarterTargetV5 } from './semantic/weeklyPlanningTurnEvidenceV5';
import type { WeeklyPlanningDialogueRendererTrace } from './trace/weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningTraceResponseSource } from './trace/weeklyPlanningTraceTypes';
import type { WeeklyPlanningMessage } from './types';
import type { WeeklyPlanningConversationArchitecture } from './weeklyPlanningConversationArchitecture';

export interface WeeklyPlanningTurnExecutionInput {
  previousState?: PlanningIntakeState;
  messages: readonly WeeklyPlanningMessage[];
  userText: string;
  supplementalContext?: string;
  selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  monthEvents?: MonthEvent[];
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
  /** PlanningState.revision at turn start; binds the previous question presentation. */
  inputStateRevision?: number;
  /**
   * Architecture the conversation is pinned to (Issue #488). Resolved once by the turn
   * controller; omitted only by pure callers, which then get the current default.
   */
  conversationArchitecture?: WeeklyPlanningConversationArchitecture;
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
  /**
   * Set by the Stable V5 dialogue step for the message that presents the pending
   * question. The turn controller binds it to the committed assistant message.
   */
  questionPresentationContent?: WeeklyPlanningQuestionPresentationContent;
  /**
   * Graph revision the presented question belongs to when the result carries no new
   * graph (recovery turns). Ignored when `stableV5Graph` is present.
   */
  questionPresentationGraphRevision?: number;
  /** Deterministic decision of what kind of conversational turn this was. */
  interactionOutcome?: WeeklyPlanningInteractionOutcome;
}

export interface WeeklyPlanningTurnSubmissionResult {
  accepted: boolean;
  draftCandidates: WeeklyDraftCandidate[];
  /** The local selection may already have committed; recover before any retry or fallback. */
  recoveryRequired?: true;
}
