import { parseWeeklyPlanningConsultationAlternativeV5, type WeeklyPlanningConsultationAlternativeMeaningV5 } from './weeklyPlanningConsultationAlternativeV5';

/**
 * Typed conversational acts: non-mutating conversation meaning the semantic model
 * reports next to the planning delta. They are additive and never exclusive, so a
 * mixed turn ("数学は45分にして。英語はこの量で間に合う？") keeps its planning
 * contribution and its conversation meaning at the same time.
 *
 * An act carries no authoritative planning payload. A consultation may carry a read-only hypothesis. It names, at most, an existing
 * public task/component id the conversation is about; deterministic application code
 * decides what (if anything) to do with it. An ordinary planning turn has no act.
 *
 * Acts are validated independently of the planning delta in the same response
 * (Issue #488): they are discourse metadata of the current turn, so ordinary acts need no quoted
 * evidence (the application already knows their turn); hypothetical days require a current-turn quote, a malformed entry
 * is dropped on its own (fail closed) instead of rejecting the planning delta, and an
 * unknown topic reference degrades to "no topic". Nothing here can grant authorization,
 * readiness, preview, approval or save.
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
  placementAlternative?: WeeklyPlanningConsultationAlternativeMeaningV5;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface WeeklyPlanningConversationActExtractionV5 {
  acts: SemanticConversationActV5[];
  /** Why entries were dropped or degraded (trace evidence; never a planning validation error). */
  diagnostics: string[];
}

/**
 * Shape check of the provider's `conversationActs` value. A missing value is "no act".
 * A value that is not an array, or an oversized list, is ignored as a whole; an entry
 * with an unknown kind, an extra key or a malformed target is dropped on its own.
 */
export function sanitizeWeeklyPlanningConversationActsV5(
  value: unknown,
): WeeklyPlanningConversationActExtractionV5 {
  if (value === undefined) return { acts: [], diagnostics: [] };
  if (!Array.isArray(value)) {
    return { acts: [], diagnostics: ['conversationActs:ignored-not-array'] };
  }
  if (value.length > WEEKLY_PLANNING_CONVERSATION_ACTS_MAX_V5) {
    return { acts: [], diagnostics: ['conversationActs:ignored-too-many'] };
  }
  const acts: SemanticConversationActV5[] = [];
  const diagnostics: string[] = [];
  value.forEach((entry, index) => {
    const path = `conversationActs[${index}]`;
    if (!isRecord(entry)) {
      diagnostics.push(`${path}:dropped-not-object`);
      return;
    }
    if (Object.keys(entry).some((key) => key !== 'kind' && key !== 'targetPublicId' && key !== 'placementAlternative')) {
      diagnostics.push(`${path}:dropped-unknown-key`);
      return;
    }
    if (!(WEEKLY_PLANNING_CONVERSATION_ACT_KINDS_V5 as readonly unknown[]).includes(entry.kind)) {
      diagnostics.push(`${path}:dropped-unsupported-kind`);
      return;
    }
    const target = entry.targetPublicId;
    if (!(target === null || target === undefined || (typeof target === 'string' && target.trim()))) {
      diagnostics.push(`${path}:dropped-malformed-target`);
      return;
    }
    const alternative = entry.kind === 'consultation_request'
      ? parseWeeklyPlanningConsultationAlternativeV5(entry.placementAlternative) : null;
    if (entry.placementAlternative != null && !alternative) {
      diagnostics.push(`${path}.placementAlternative:dropped-invalid-hypothesis`);
    }
    acts.push({
      kind: entry.kind as WeeklyPlanningConversationActKindV5,
      targetPublicId: typeof target === 'string' ? target : null,
      ...(alternative ? { placementAlternative: alternative }
        : entry.kind === 'consultation_request' && entry.placementAlternative != null
          ? { placementAlternative: { unavailable: 'malformed' as const } } : {}),
    });
  });
  return { acts, diagnostics };
}

/**
 * A topic reference may name only an existing active task/component of the public state.
 * Anything else (a workload, an uncertainty, a removed fact, an invented id) is not a topic
 * the application can route to, so the act keeps its meaning without a topic. The
 * explanation of a pending question never needs a topic: the application knows which
 * question was presented.
 */
export function resolveWeeklyPlanningConversationActTargetsV5(params: {
  acts: readonly SemanticConversationActV5[];
  publicStateSummary?: Record<string, unknown>;
}): WeeklyPlanningConversationActExtractionV5 {
  const known = new Set(
    [params.publicStateSummary?.tasks, params.publicStateSummary?.components]
      .flatMap((entries) => (Array.isArray(entries) ? entries : []))
      .filter(isRecord)
      .map((entry) => entry.publicId)
      .filter((id): id is string => typeof id === 'string'),
  );
  const diagnostics: string[] = [];
  const acts = params.acts.map((act, index) => {
    if (act.targetPublicId === null || known.has(act.targetPublicId)) return act;
    diagnostics.push(`conversationActs[${index}].targetPublicId:degraded-unknown-topic`);
    // An unresolved topic must never turn a task hypothesis into a plan-wide test.
    return { ...act, targetPublicId: null,
      ...(act.placementAlternative ? { placementAlternative: { unavailable: 'unknown_target' as const } } : {}),
    };
  });
  return { acts, diagnostics };
}

/** Interaction-only semantic instruction; legacy policy never includes this rule. */
export const WEEKLY_PLANNING_CONVERSATION_ACT_INSTRUCTION_V5 = 'conversationActs add non-mutating meaning: ask_about_pending_question (why/what; no fact), topic_shift, resume_topic, consultation_request (advice), answer_pending_question (with delta). targetPublicId=existing task/component or null; plain planning=[]. Keep independent facts. Consultation-only placementAlternative={scope:task|plan,dateExpressions:canonical days,sourceText:current quote}, else null; weekdays use accepted horizon. Hypothetical days are not planning facts.';
