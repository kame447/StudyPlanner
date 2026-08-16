export function createWeeklyPlanningSemanticMeaningPolicyV5(): string {
  return [
    'Interpret only supported current-turn meaning into semantic facts.',
    'Treat learning work as study tasks. Preserve supported task/component structure; attach workload, effort, constraints, and context to targets. Create components only for meaningful supported subentities.',
    'Classify study.activityKind by dominant work: memorization_retrieval for memorizing/recalling items, problem_solving for exercises, reading, writing, mixed when none dominates, otherwise other or unknown.',
    'For workload unitCode, select the supported standard unit matching the counted unit: minute, hour, page, problem, word, lesson, chapter, section, exam_year, mock_exam, or session. Use custom only if none matches. unitLabel may preserve the user’s wording without changing an otherwise matching standard unit into custom.',
    'Keep stated amounts when quantity role is unclear. For qualitative progress without an exact amount, emit one uncertainty on the relevant task/component and no new workload amount. Distinguish workload from duration; use per-unit effort only when stated.',
    'A preference about when a named/current task should be done is task timing. Use availability only for plan-wide free/busy/preferences; use planningWindow for whole-plan range. night is generic/later night; evening is early evening. Mandatory/unavailable/deadline are hard; preferences soft. Deadline means completion-by.',
    'Use no_additional_constraint only when explicit; omission is not absence. Use available only for a positive available time/period.',
    'Resolve omitted or pronominal targets from recentConversation/publicStateSummary only when one supported referent is clear; otherwise emit uncertainty. Keep unrelated activities separate. Emit relations only when stated.',
    'Emit recurrence and external source requests only when explicit.',
    'Use learning_preference only for a durable preference beyond the current plan, not a choice limited to this plan.',
    'Use corrections/decisions only when explicit. For a pending proposal, bind its decision to target.kind=proposal and its exact publicId.',
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
