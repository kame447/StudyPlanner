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
  VNextPlanningIntent,
  VNextFactRef,
  WeeklyPlanningVNextProjection,
  WeeklyPlanningVNextState,
} from './weeklyPlanningVNextTypes';

/** Current-turn meaning only: a request to preview registration, never permission to save. */
export interface VNextEventRegistrationAct {
  kind: 'request_event_registration';
  /** null follows V5's current-turn task selection; explicit refs never degrade to null. */
  targetRef: VNextFactRef | null;
}

export interface WeeklyPlanningVNextInterpretationClock {
  /** Accepted-at date the turn is read against (YYYY-MM-DD, local to timeZone). */
  currentDate: string;
  weekStartsOn: WeeklyPlanningWeekStartsOn;
  planningStartDate: string;
  planningEndDate: string;
  /** The selected week, retained even while a stated window moves the effective horizon. */
  defaultPlanningHorizon: { startDate: string; endDate: string };
  timeZone: string;
}

export interface WeeklyPlanningVNextInterpretationInput {
  /** Same turn-scoped pace used by projection and validation; not a persisted fact. */
  observedMemoryPace?: Readonly<Record<string, number>>;
  client: OpenAiCompatibleClient;
  state: WeeklyPlanningVNextState;
  projection: WeeklyPlanningVNextProjection;
  /** The question currently shown to the user, if any (already freshness-checked by the caller). */
  presentedQuestion: VNextQuestion | null;
  /** The actual assistant message that displayed this question; null iff no question is presented. */
  presentedText: string | null;
  userText: string;
  /** Actual bounded conversation context for contextual intent; never a source of new facts by itself. */
  recentConversation?: readonly { role: 'user' | 'assistant'; content: string }[];
  /** Attachment-derived supplemental evidence; userText remains the user's source/intent channel. */
  supplementalContext?: string;
  clock: WeeklyPlanningVNextInterpretationClock;
}

/** What the words say about the presented question, in the binder's vocabulary. */
export type WeeklyPlanningVNextInterpretedAnswer =
  | { kind: 'proposal_decision'; proposalId: string; decision: 'accept' | 'reject' }
  | { kind: 'session_minutes'; minutes: number }
  | { kind: 'option'; optionId: string }
  /**
   * Minutes the words state for the asked work itself: for the whole of it, or for one of
   * its units. Time about other work (for example, time already spent) is not an answer.
   */
  | { kind: 'estimate_minutes'; minutes: number; per: 'whole_work' | 'unit' };

/** Values from the validated Jev response; diagnostics never authorize a selection. */
export interface WeeklyPlanningVNextOptionChoiceDiagnostic {
  questionKey: string;
  graphRevision: number;
  policyId: string;
  gateReason: string;
  reason: 'selected' | 'none' | 'below_threshold' | 'margin' | 'extra_meaning' | 'schema_or_transport' | 'unavailable';
  /** Null means no validated evaluation was returned, rather than a zero score. */
  probabilities: readonly { readonly optionId: string; readonly probability: number }[] | null;
  margin: number | null;
  conditionChange: number | null;
  independentMeaning: number | null;
  extraMeaning: ('conditionChange' | 'independentMeaning')[];
}

export interface WeeklyPlanningVNextInterpretationMetrics {
  /** Provider requests made for this turn, including the one allowed repair. */
  calls: number;
  repairs: number;
  latencyMs: number;
  optionChoice?: WeeklyPlanningVNextOptionChoiceDiagnostic;
}

export type WeeklyPlanningVNextInterpretation =
  | {
      status: 'interpreted';
      /** The AI interprets intent; the shared V5 application gate alone grants preview permission. */
      planningIntent: VNextPlanningIntent;
      /** Additive turn-local acts; kept out of Fact Graph and approval state. */
      conversationActs?: VNextEventRegistrationAct[];
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
