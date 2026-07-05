import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';

export type InterpreterOrigin = 'ai_interpreter';

export interface InterpretedCommandCandidate {
  command: ParsedWeeklyPlanningCommand;
  origin: InterpreterOrigin;
  needsConfirmation: boolean;
}

export interface InterpreterStateSummary {
  knownFields: string[];
  confirmedSlots: string[];
  planningRangeSummary?: string;
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
  rejected: CandidateRejection[];
  parseRejections: InterpreterParseRejection[];
}
