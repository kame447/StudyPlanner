/**
 * Typed conversational acts: non-mutating conversation meaning the semantic model
 * reports next to the planning delta. They are additive and never exclusive, so a
 * mixed turn ("数学は45分にして。英語はこの量で間に合う？") keeps its planning
 * contribution and its conversation meaning at the same time.
 *
 * An act carries no planning payload and no authority. It names, at most, an existing
 * public task/component id the conversation is about; deterministic application code
 * decides what (if anything) to do with it. An ordinary planning turn has no act.
 */
export const WEEKLY_PLANNING_CONVERSATION_ACT_KINDS_V5 = [
  /** The user is answering the question the machine is waiting for (needs a typed delta). */
  'answer_pending_question',
  /** The user asks why / what the pending question means. */
  'ask_about_pending_question',
  /** The user moves to another topic or an aside. */
  'topic_shift',
  /** The user returns to a topic that was set aside. */
  'resume_topic',
  /** The user asks for advice/consultation (handoff marker for Issue #246; no runtime here). */
  'consultation_request',
] as const;

export type WeeklyPlanningConversationActKindV5 =
  typeof WEEKLY_PLANNING_CONVERSATION_ACT_KINDS_V5[number];

export const WEEKLY_PLANNING_CONVERSATION_ACTS_MAX_V5 = 6;

export interface SemanticConversationActV5 {
  kind: WeeklyPlanningConversationActKindV5;
  /** Existing public task/component id the act is about, or null. Never a new fact. */
  targetPublicId: string | null;
  /** Evidence quoted from the current user turn. */
  sourceText: string;
}

/** Acts that are valid conversation meaning on their own, without any planning delta. */
const SELF_SUFFICIENT_ACT_KINDS: readonly WeeklyPlanningConversationActKindV5[] = [
  'ask_about_pending_question',
  'topic_shift',
  'resume_topic',
  'consultation_request',
];

export function hasSelfSufficientConversationActV5(
  acts: readonly SemanticConversationActV5[] | undefined,
): boolean {
  return (acts ?? []).some((act) => SELF_SUFFICIENT_ACT_KINDS.includes(act.kind));
}
