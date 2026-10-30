// The one boundary between a language model and the VNext core. The model reads
// the stated facts, the open questions and the user's words, and returns a typed
// delta (and, when a question is shown, which option or how many minutes the
// words answer). It never returns computed amounts, ids it invented for stored
// facts, lifecycle operations, question priority, placement, approval or saving.
// Code owns ids, revisions, validity, math and freshness.
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import type {
  VNextQuestion,
  VNextTurnDelta,
  VNextTurnError,
  WeeklyPlanningVNextProjection,
  WeeklyPlanningVNextState,
} from './weeklyPlanningVNextTypes';

export interface WeeklyPlanningVNextInterpretationClock {
  /** Accepted-at date the turn is read against (YYYY-MM-DD, local to timeZone). */
  currentDate: string;
  weekStartsOn: WeeklyPlanningWeekStartsOn;
  planningStartDate: string;
  planningEndDate: string;
  timeZone: string;
}

export interface WeeklyPlanningVNextInterpretationInput {
  client: OpenAiCompatibleClient;
  state: WeeklyPlanningVNextState;
  projection: WeeklyPlanningVNextProjection;
  /** The question currently shown to the user, if any (already freshness-checked by the caller). */
  presentedQuestion: VNextQuestion | null;
  /** The actual assistant message that displayed this question; null iff no question is presented. */
  presentedText: string | null;
  userText: string;
  clock: WeeklyPlanningVNextInterpretationClock;
}

/** What the words say about the presented question, in the binder's vocabulary. */
export type WeeklyPlanningVNextInterpretedAnswer =
  | { kind: 'option'; optionId: string }
  /**
   * Minutes the words state for the asked work itself: for the whole of it, or for one of
   * its units. Time about other work (for example, time already spent) is not an answer.
   */
  | { kind: 'estimate_minutes'; minutes: number; per: 'whole_work' | 'unit' };

export interface WeeklyPlanningVNextInterpretationMetrics {
  /** Provider requests made for this turn, including the one allowed repair. */
  calls: number;
  repairs: number;
  latencyMs: number;
}

export type WeeklyPlanningVNextInterpretation =
  | {
      status: 'interpreted';
      /** Applies cleanly to `state` (validated with the same pure transaction), or is empty. */
      delta: VNextTurnDelta;
      answer: WeeklyPlanningVNextInterpretedAnswer | null;
      metrics: WeeklyPlanningVNextInterpretationMetrics;
    }
  | {
      status: 'failed';
      reason: 'provider_error' | 'unparseable' | 'rejected_after_repair';
      /** Transaction errors of the last reading, when the failure is a rejection. */
      errors: VNextTurnError[];
      metrics: WeeklyPlanningVNextInterpretationMetrics;
    };

export type WeeklyPlanningVNextInterpreter = (
  input: WeeklyPlanningVNextInterpretationInput,
) => Promise<WeeklyPlanningVNextInterpretation>;
