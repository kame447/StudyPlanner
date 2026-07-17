import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type { ExamPrepScope, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';

export type InterpreterOrigin = 'ai_interpreter';

export type ConstraintSourceReferenceResolutionStatus = 'resolved' | 'unresolved' | 'multiple';

export interface ConstraintSourceReferenceResolution {
  status: ConstraintSourceReferenceResolutionStatus;
  resolvedKind?: 'timetable' | 'existing_plans' | 'calendar';
  candidateKinds?: Array<'timetable' | 'existing_plans' | 'calendar'>;
  reason: string;
  clarificationRequest?: ParsedWeeklyPlanningCommand;
}

export interface InterpretedCommandCandidate {
  command: ParsedWeeklyPlanningCommand;
  origin: InterpreterOrigin;
  needsConfirmation: boolean;
  constraintSourceResolution?: ConstraintSourceReferenceResolution;
}

export interface PlannerCapabilitySnapshot {
  hasActiveTimetable: boolean;
  existingPlanCount: number;
}

export interface ConstraintSourceAvailability {
  timetable: boolean;
  existingPlans: boolean;
  calendar: boolean;
}

export interface InterpreterPendingAssumptionSummary {
  proposalId: string;
  slot: string;
  targetRef: string;
  proposedValue: string | number | boolean;
  proposedUnit?: string;
}

export interface InterpreterCorrectionTargetSummary {
  kind: 'task' | 'planning_range' | 'constraint' | 'priority' | 'proposal';
  ref: string;
  label: string;
}

export interface InterpreterStateSummary {
  knownFields: string[];
  examScopeSummary?: Omit<Partial<ExamPrepScope>, 'fields' | 'yearRange'> & {
    fields: string[];
    rawText?: string[];
    yearRange?: { startYear: number; endYear: number; sourceText?: string };
  };
  confirmedSlots: string[];
  planningRangeSummary?: string;
  lastQuestions?: Array<{
    slotKey: string;
    intent: string;
  }>;
  pendingPlanningRange?: {
    kind: 'next_week' | 'named_future_period';
    label: string;
    windowStartDate?: string;
    windowEndDate?: string;
    planningStartDate?: string;
    planningStartDateTime?: string;
    durationDays?: number;
    planningEndDateTime?: string;
  };
  availableConstraintSources?: ConstraintSourceAvailability;
  pendingAssumptionProposals?: InterpreterPendingAssumptionSummary[];
  correctionTargets?: InterpreterCorrectionTargetSummary[];
}

export interface InterpreterParseRejection {
  rawCandidate: unknown;
  reason: string;
}

export interface WeeklyPlanningInterpreterResult {
  candidates: InterpretedCommandCandidate[];
  parseRejections: InterpreterParseRejection[];
  assumptionProposalDrafts?: unknown[];
  assumptionDecisions?: unknown[];
  correctionEnvelopes?: unknown[];
}

export interface InterpreterRecentTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface WeeklyPlanningIntakeInterpreter {
  interpretUserTurn(params: {
    userText: string;
    context: WeeklyPlanningIntakeContext;
    stateSummary: InterpreterStateSummary;
    recentTurns?: InterpreterRecentTurn[];
  }): Promise<WeeklyPlanningInterpreterResult>;
}

export interface CandidateRejection {
  candidate: InterpretedCommandCandidate;
  reason: string;
}

export interface CandidateValidationResult {
  accepted: ParsedWeeklyPlanningCommand[];
  acceptedWithConfirmation: ParsedWeeklyPlanningCommand[];
  clarifications: InterpretedCommandCandidate[];
  clarificationRequests: ParsedWeeklyPlanningCommand[];
  rejected: CandidateRejection[];
  parseRejections: InterpreterParseRejection[];
}
