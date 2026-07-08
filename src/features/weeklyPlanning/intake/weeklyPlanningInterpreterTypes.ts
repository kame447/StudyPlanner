import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';

export type InterpreterOrigin = 'ai_interpreter';

export interface InterpretedCommandCandidate {
  command: ParsedWeeklyPlanningCommand;
  origin: InterpreterOrigin;
  needsConfirmation: boolean;
}

/**
 * planner が現在保持している read-only capability の可用性スナップショット。
 * pipeline input(existingPlans / scheduleTemplates / timetableTermId)から deterministic に算出する。
 * 新しい scheduling capability ではなく、既存 capability の可用性を intake/interpreter/validator へ可視化するもの。
 */
export interface PlannerCapabilitySnapshot {
  hasActiveTimetable: boolean;
  existingPlanCount: number;
}

/**
 * interpreter / validator が参照する、constraint source の利用可否。
 * calendar は existingPlans と同一のカレンダー予定を指すため existingPlans と同じ可用性で扱う。
 */
export interface ConstraintSourceAvailability {
  timetable: boolean;
  existingPlans: boolean;
  calendar: boolean;
}

export interface InterpreterStateSummary {
  knownFields: string[];
  confirmedSlots: string[];
  planningRangeSummary?: string;
  /**
   * 利用可能な既存 schedule source。省略時はすべて利用不可として扱う(空ソースを鵜呑みにしない安全側)。
   */
  availableConstraintSources?: ConstraintSourceAvailability;
}

export interface InterpreterParseRejection {
  rawCandidate: unknown;
  reason: string;
}

export interface WeeklyPlanningInterpreterResult {
  candidates: InterpretedCommandCandidate[];
  parseRejections: InterpreterParseRejection[];
}

export interface WeeklyPlanningIntakeInterpreter {
  interpretUserTurn(params: {
    userText: string;
    context: WeeklyPlanningIntakeContext;
    stateSummary: InterpreterStateSummary;
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
  /**
   * ユーザーが用語の意味を聞き返した request_clarification intent。
   * state を進めず(missing を消さず)、用語説明を返して直前の質問を維持するために dialogue 側で使う。
   * low-confidence candidate を溜める `clarifications` とは別概念。
   */
  clarificationRequests: ParsedWeeklyPlanningCommand[];
  rejected: CandidateRejection[];
  parseRejections: InterpreterParseRejection[];
}
