export function createWeeklyPlanningSemanticMeaningPolicyV5(): string {
  return [
    'Interpret only supported current-turn meaning into semantic facts.',
    'Treat learning work as study tasks. Preserve only supported task/component hierarchy and decomposition, and attach workload, effort, constraints, and context to the entity they modify.',
    'Keep an amount declared when target/remaining/completed meaning is unclear. Distinguish work amount from expected duration; use per-unit effort only when stated.',
    'Keep task-specific timing on that task, plan-wide free/busy/preference facts in availability, and planningWindow for the whole requested plan. Mandatory, unavailable, and deadline meaning is hard; preferences are soft; unresolved strength is unknown. Deadline means completion-by.',
    'Keep unrelated activities separate. Emit relations only when stated; if a modifier has multiple supported targets and context does not choose one, emit uncertainty.',
    'Emit recurrence and external source requests only when explicitly stated or requested.',
    'Use corrections and decisions only for explicit corrections or decisions about a previously presented item.',
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
