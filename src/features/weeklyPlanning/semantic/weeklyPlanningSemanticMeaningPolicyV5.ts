export function createWeeklyPlanningSemanticMeaningPolicyV5(): string {
  return [
    'Interpret only supported current-turn meaning into semantic facts.',
    'Treat learning work as study tasks. Preserve supported task/component structure; components must be meaningful subordinate entities. Attach workload, effort, constraints, and context to targets.',
    'Classify study.activityKind by dominant work: memorization_retrieval for memorizing/recalling items, problem_solving for exercises, reading, writing, mixed if none dominates, else other or unknown.',
    'For workload unitCode, select the supported standard unit matching the counted unit: minute, hour, page, problem, word, lesson, chapter, section, exam_year, mock_exam, or session. Use custom only if none matches. unitLabel may preserve the user’s wording without changing an otherwise matching standard unit into custom.',
    'Keep stated amounts when quantity role is unclear. For qualitative progress without an exact amount, emit one uncertainty on the relevant task/component and no new workload amount. Distinguish workload from duration; per-unit effort only when stated.',
    'Named/current-task timing is task timing; availability is plan-wide and planningWindow is the whole-plan range. night is later night; evening early evening. Mandatory/unavailable/deadline are hard, preferences soft; Deadline means completion-by. Resolve relative dates from calendarContext to canonical dateExpression.',
    'Use no_additional_constraint only when explicit; omission is not absence. available means positive available time/period.',
    'Resolve omitted or pronominal targets from recentConversation/publicStateSummary only when one supported referent is clear; otherwise emit uncertainty. If the referent itself is unresolved, target that uncertainty to document, never to its own localId. Keep unrelated activities separate. Emit relations only when stated.',
    'Emit recurrence and external source requests only when explicit.',
    'learning_preference is durable beyond the current plan, not a current-plan choice.',
    'Interpret independent clauses independently; corrections/decisions do not suppress other supported current-turn facts. Use corrections/decisions only when explicit. Pending proposal decisions target kind=proposal and exact publicId.',
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
