export function createWeeklyPlanningSemanticMeaningPolicyV5(): string {
  return [
    'Interpret Japanese planning utterances into semantic planning facts. Focus on user meaning and evidence; the response schema and deterministic validators own wire shape and canonical representation.',
    'Entrance exams, qualification exams, school exams, courses, homework, self-study, review, practice, learning habits, and research-as-learning are study tasks; preserve the specific context in study purpose/context rather than inventing a special task type.',
    'Represent subjects, fields, materials, topics, chapters, sections, and skills as components. Use component hierarchy only when the user meaning supports it, and never invent constituents.',
    'Classify task decomposition by schedulable meaning: atomic for one schedulable work unit, decomposed when constituent work is identified, and needs_breakdown for a collection/project/category whose independently schedulable constituents are still unknown.',
    'Attach each workload to the task or component it semantically modifies. If the amount role is not established as target, remaining, or completed, keep it declared rather than guessing.',
    'A time amount describing how much work exists is a workload; a statement about how long work is expected to take is an effort estimate. Use per-unit effort only when the user states a unit basis.',
    'Temporal constraints describe when work may or must happen, not how much work exists. Treat immovable/mandatory/unavailable/deadline meaning as hard, preferences as soft, and unresolved strength as unknown.',
    'Use deadline only for completion-by meaning. A date on which an exam, presentation, competition, appointment, or other event occurs is a goal event unless the user separately states that work must be completed by it.',
    'A concern requires explicit evidence of difficulty, weakness, worry, low confidence, being behind, or a motivation problem. Do not infer concern or stronger priority from amount, frequency, duration, or workload size alone.',
    'Keep entity-local concern/context on its task or component. Use owner-level user context for facts that do not naturally annotate one planning entity, including dated future goal events.',
    'A time restriction tied to one task belongs to that task; a plan-wide free/busy/preference statement with no task target belongs to availability.',
    'Use allowed-date meaning when a task may run only on a stated date and excluded-date meaning when that task must not run on it. A whole-day plan-wide unavailability is availability, not a task rule.',
    'planningWindow is the period for the whole requested plan. A period modifying only one workload belongs to that workload.',
    'For past-exam quantities such as one or two years worth, use the exam-year workload meaning; specific calendar years are range endpoints rather than quantities.',
    'Keep unrelated activities as separate tasks. Emit before/after/dependency/priority/sequence relations only when the user actually states that scheduling relation.',
    'A modifier must have one supported semantic target before attachment. If it can apply to multiple independently schedulable candidates and context does not resolve the target, emit uncertainty instead of assigning by order or proximity.',
    'External timetable, existing-plan, and calendar contents are authoritative application data. Emit a source request only when the user explicitly asks to use or stop using one; do not reproduce or invent external events.',
    'Use corrections and decisions only for explicit user corrections or decisions about a previously presented item.',
    'Do not invent semantic facts. Preserve a short current-turn supporting excerpt in each sourceText.',
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
