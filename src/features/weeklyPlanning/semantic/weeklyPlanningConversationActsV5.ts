/** Additive current-turn conversation meaning; no planning or approval authority. */
export const WEEKLY_PLANNING_CONVERSATION_ACT_KINDS_V5 = [
  'answer_pending_question', 'ask_about_pending_question', 'topic_shift', 'resume_topic',
  'decline_additional_work', 'request_event_registration',
] as const;
export type WeeklyPlanningConversationActKindV5 = typeof WEEKLY_PLANNING_CONVERSATION_ACT_KINDS_V5[number];
export interface SemanticConversationActV5 {
  kind: WeeklyPlanningConversationActKindV5;
  targetPublicId: string | null;
  /** Resolver-only evidence. The provider cannot supply this field. */
  targetResolution?: 'unresolved';
}
export interface WeeklyPlanningConversationActExtractionV5 {
  acts: SemanticConversationActV5[];
  diagnostics: string[];
}
export function hasSelfSufficientConversationActV5(acts: readonly SemanticConversationActV5[] | undefined): boolean {
  return (acts ?? []).some(act => act.kind === 'ask_about_pending_question'
    || act.kind === 'topic_shift' || act.kind === 'resume_topic'
    || act.kind === 'decline_additional_work' || act.kind === 'request_event_registration');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function sanitizeWeeklyPlanningConversationActsV5(value: unknown): WeeklyPlanningConversationActExtractionV5 {
  if (value === undefined) return { acts: [], diagnostics: [] };
  if (!Array.isArray(value)) return { acts: [], diagnostics: ['conversationActs:ignored-not-array'] };
  if (value.length > 6) return { acts: [], diagnostics: ['conversationActs:ignored-too-many'] };
  const acts: SemanticConversationActV5[] = [];
  const diagnostics: string[] = [];
  value.forEach((entry, index) => {
    const path = `conversationActs[${index}]`;
    if (!isRecord(entry)) { diagnostics.push(`${path}:dropped-not-object`); return; }
    if (Object.keys(entry).some(key => key !== 'kind' && key !== 'targetPublicId')) {
      diagnostics.push(`${path}:dropped-unknown-key`); return;
    }
    if (!(WEEKLY_PLANNING_CONVERSATION_ACT_KINDS_V5 as readonly unknown[]).includes(entry.kind)) {
      diagnostics.push(`${path}:dropped-unsupported-kind`); return;
    }
    const target = entry.targetPublicId;
    if (!(target === null || target === undefined || (typeof target === 'string' && target.trim()))) {
      diagnostics.push(`${path}:dropped-malformed-target`); return;
    }
    acts.push({ kind: entry.kind as WeeklyPlanningConversationActKindV5,
      targetPublicId: typeof target === 'string' ? target : null });
  });
  return { acts, diagnostics };
}
/** Recheck current public task/component IDs; unknown named resume must not become explicit null. */
export function resolveWeeklyPlanningConversationActTargetsV5(params: {
  acts: readonly SemanticConversationActV5[];
  publicStateSummary?: Record<string, unknown>;
}): WeeklyPlanningConversationActExtractionV5 {
  const known = new Set([params.publicStateSummary?.tasks, params.publicStateSummary?.components]
    .flatMap(entries => Array.isArray(entries) ? entries : []).filter(isRecord)
    .map(entry => entry.publicId).filter((id): id is string => typeof id === 'string'));
  const diagnostics: string[] = [];
  const acts = params.acts.map((act, index) => {
    if (act.targetPublicId === null || known.has(act.targetPublicId)) return act;
    diagnostics.push(`conversationActs[${index}].targetPublicId:degraded-unknown-topic`);
    return { ...act, targetPublicId: null,
      ...(act.kind === 'resume_topic' ? { targetResolution: 'unresolved' as const } : {}) };
  });
  return { acts, diagnostics };
}
