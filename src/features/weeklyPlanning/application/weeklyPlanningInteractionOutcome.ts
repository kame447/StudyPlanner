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
