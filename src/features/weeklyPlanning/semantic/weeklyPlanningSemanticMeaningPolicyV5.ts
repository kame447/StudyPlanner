export function createWeeklyPlanningSemanticMeaningPolicyV5(): string {
  return [
    'Interpret user meaning and context into semantic facts using only supported evidence.',
    'Treat learning-related goals, including exams, courses, homework, self-study, review, practice, habits, and research-as-learning, as study tasks while preserving their specific context.',
    'Represent subjects, materials, topics, sections, and skills as components only when supported. Use atomic for one schedulable unit, decomposed when schedulable constituents are known, and needs_breakdown when they are not.',
    'Attach workload, effort, constraints, and concerns to the entity they modify. Keep an amount declared if target/remaining/completed is not established; distinguish work amount from expected duration and use per-unit effort only when stated.',
    'Temporal facts say when work may or must happen. Keep mandatory/unavailable/deadline constraints hard, preferences soft, and unresolved strength unknown. Use deadline only for completion-by meaning; otherwise an event date is a goal event.',
    'Task-specific time rules stay on that task; plan-wide free/busy/preference facts stay in availability. planningWindow is only the requested whole-plan period. Keep non-consecutive allowed dates separate.',
    'Keep unrelated activities as separate tasks. Emit dependency/order/priority relations only when stated. If a modifier has multiple plausible schedulable targets, emit uncertainty rather than choosing by proximity or order.',
    'For recurring work, emit matching recurrence semantics. Request external timetable/calendar/existing-plan sources only when the user explicitly asks to use or stop using them; never invent their contents.',
    'Use corrections and decisions only for explicit corrections or decisions about a previously presented item. Do not invent facts; keep each sourceText as a short excerpt from the current user turn.',
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
