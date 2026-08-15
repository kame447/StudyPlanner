export function createWeeklyPlanningSemanticMeaningPolicyV5(): string {
  return [
    'Interpret only supported current-turn meaning into semantic facts.',
    'Treat learning work as study tasks. Preserve only supported task/component hierarchy and decomposition, and attach workload, effort, constraints, and context to the entity they modify.',
    'Classify study.activityKind by the dominant cognitive work: memorization_retrieval for memorizing or recalling facts/items, problem_solving for solving exercises, reading for reading-centered work, writing for writing-centered work, mixed when no single mode dominates, otherwise other or unknown.',
    'Keep an amount declared when target/remaining/completed meaning is unclear. Distinguish work amount from expected duration; use per-unit effort only when stated.',
    'Keep task-specific timing on that task, plan-wide free/busy/preference facts in availability, and planningWindow for the whole requested plan. Mandatory, unavailable, and deadline meaning is hard; preferences are soft; unresolved strength is unknown. Deadline means completion-by.',
    'Distinguish absence from positive availability: when the user states that there are no additional schedule constraints or commitments, emit availability kind=no_additional_constraint. Reserve kind=available for a positive statement that a time or period is available for use.',
    'Keep unrelated activities separate. Emit relations only when stated; if a modifier has multiple supported targets and context does not choose one, emit uncertainty.',
    'Emit recurrence and external source requests only when explicitly stated or requested.',
    'Use userContextFacts kind=learning_preference only when the user expresses a durable preference intended to apply beyond the current plan; a choice scoped only to this week or this plan is not durable user context.',
    'Use corrections and decisions only for explicit corrections or decisions about a previously presented item. When responding to a pending proposal in publicStateSummary, bind the decision to target.kind=proposal and that proposal exact publicId.',
  ].join('\n');
}

export function createWeeklyPlanningSemanticUserContextPayloadV5(params: {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    userText: params.userText,
    recentConversation: params.recentConversation ?? [],
    publicStateSummary: params.publicStateSummary ?? {},
  });
}
