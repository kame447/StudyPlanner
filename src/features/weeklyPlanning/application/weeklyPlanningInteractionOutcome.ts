/**
 * Deterministic interaction outcome of one Stable V5 turn.
 *
 * Responsibility boundary: the semantic model (one AI owner) reports what the user's
 * words mean as typed contributions; this application layer combines those typed
 * contributions with machine state and decides what kind of turn it was; the renderer
 * only verbalizes the decided outcome. Nothing here reads raw user text, and no
 * outcome carries authority to approve, save, schedule or mutate the Fact Graph.
 */

export type WeeklyPlanningInteractionOutcome =
  | {
      /** Ordinary planning turn: apply the delta, then ask / report status / show preview. */
      kind: 'apply';
      consultationDeferred: boolean;
    }
  | {
      /** The user asked what the pending question means; the same question is kept and re-presented. */
      kind: 'explain_pending_question';
      consultationDeferred: boolean;
    }
  | {
      /** The user moved to another topic; the old question is kept but not re-presented. */
      kind: 'aside';
      consultationDeferred: boolean;
    }
  | {
      /** The user returned to / focused a topic; its open question is explicitly re-presented. */
      kind: 'resume_pending_question';
      consultationDeferred: boolean;
    }
  | {
      /** The turn failed before any state change; the conversation continues from the retained state. */
      kind: 'recover';
      failure: 'provider' | 'semantic';
      /** True when the retained machine question was re-presented in the recovery message. */
      representedQuestion: boolean;
      consultationDeferred?: false;
    };

export type WeeklyPlanningInteractionOutcomeKind = WeeklyPlanningInteractionOutcome['kind'];

/**
 * Why a status turn (no question, no new preview) is being reported. Decided by the
 * response routing; the renderer turns it into words.
 */
export type WeeklyPlanningTurnStatusReason =
  /** Everything needed is known; a draft schedule is made when the user asks for it. */
  | 'ready_to_create_preview'
  /** An existing draft schedule stays as it is (nothing in this turn changed it). */
  | 'preview_unchanged';

/**
 * Machine-owned facts the interaction architecture hands to the renderer next to the
 * outcome (Issue #488). They say WHAT must be communicated; they contain no prose and are
 * never read back as planning truth. Absent in the legacy architecture.
 */
export interface WeeklyPlanningTurnCommunicationFacts {
  statusReason: WeeklyPlanningTurnStatusReason | null;
  /** Other open blocking question codes (deferred ones excluded), for "what comes later". */
  upcomingQuestionCodes: string[];
  /**
   * The semantic layer reported planning details in this turn that could not be taken in
   * (the turn continued only through its conversation act). Nothing from them was applied.
   */
  planningDetailsNotApplied: boolean;
  /** Application-owned preview disclosure: work that did not fit and is not in the preview. */
  previewDisclosure: { omittedWorkLabels: string[] } | null;
}

export function emptyWeeklyPlanningTurnCommunicationFacts(): WeeklyPlanningTurnCommunicationFacts {
  return {
    statusReason: null,
    upcomingQuestionCodes: [],
    planningDetailsNotApplied: false,
    previewDisclosure: null,
  };
}
