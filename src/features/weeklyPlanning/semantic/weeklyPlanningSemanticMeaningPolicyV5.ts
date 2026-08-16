export function createWeeklyPlanningSemanticMeaningPolicyV5(): string {
  return [
    'Interpret only supported current-turn meaning into semantic facts.',
    'Treat learning work as study tasks. Preserve supported task/component structure; attach workload, effort, constraints, and context to what they modify. Create a component only for a separately meaningful user-supported subentity, not to duplicate a task or hold its sole workload.',
    'Classify study.activityKind by dominant work: memorization_retrieval for memorizing/recalling items, problem_solving for exercises, reading, writing, mixed when none dominates, otherwise other or unknown.',
    'For workload unitCode, select the supported standard unit whose semantic meaning matches the counted unit: minute, hour, page, problem, word, lesson, chapter, section, exam_year, mock_exam, or session. Use custom only when none of those standard units matches. unitLabel may preserve the user’s wording without changing an otherwise matching standard unit into custom.',
    'Keep amount declared when target/remaining/completed is unclear. For one vague progress value, emit one root uncertainty, not both completed and remaining. Distinguish workload from duration; use per-unit effort only when stated.',
    'A preference about when a named/current task should be done is task timing. Use availability only for plan-wide free/busy/preferences; use planningWindow for the whole-plan range. Mandatory/unavailable/deadline are hard; preferences soft; unresolved strength unknown. Deadline means completion-by.',
    'Use no_additional_constraint only for an explicit statement that no additional schedule constraints or commitments exist; omission is not absence. Use available only for a positive available time/period.',
    'Keep unrelated activities separate. Emit relations only when stated; if a modifier has multiple supported targets and context cannot choose one, emit uncertainty.',
    'Emit recurrence and external source requests only when explicit.',
    'Use userContextFacts kind=learning_preference only for a durable preference beyond the current plan, not a choice limited to this week/plan.',
    'Use corrections/decisions only for explicit corrections or decisions about a presented item. For a pending proposal in publicStateSummary, bind the decision to target.kind=proposal and its exact publicId.',
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
