export const WEEKLY_PLANNING_SEMANTIC_RULE_RETENTION_BASES_V5 = [
  'language_interpretation',
  'contextual_reference_resolution',
  'semantic_scope_boundary',
] as const;

export type WeeklyPlanningSemanticRuleRetentionBasisV5 =
  (typeof WEEKLY_PLANNING_SEMANTIC_RULE_RETENTION_BASES_V5)[number];

export const WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5 = [
  {
    id: 'current_turn_scope',
    retentionBasis: 'semantic_scope_boundary',
    retentionReason: 'Schema and validators can reject malformed output, but cannot decide which supported meanings belong to the current utterance rather than copied context.',
    instruction: 'Interpret every supported explicit current-turn contribution into facts, including side contributions; a pending question must not suppress other stated facts.',
  },
  {
    id: 'task_structure',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Choosing whether language denotes a task, subordinate component, attachment target, or a genuine new decomposition requirement requires semantic interpretation before structural validation can run.',
    instruction: 'Treat requested learning work as study tasks. Preserve supported task/component structure; components must be meaningful subordinate entities. Attach workload, effort, constraints, and context to targets. Performance-only mentions such as exam scores do not create tasks/components. Every relation endpoint must reference an entity emitted in this delta or an explicitly bound existing entity; never invent an unattached endpoint. When an existingPublicId task/component appears only as the minimal containing shell for a newly stated nested fact, do not create a new breakdown requirement from that wrapper. If the current utterance newly makes an existing task structure unclear, emit work_breakdown uncertainty.',
  },
  {
    id: 'study_activity_kind',
    retentionBasis: 'language_interpretation',
    retentionReason: 'The dominant study activity is a semantic classification of the described work; deterministic code only validates the closed representation.',
    instruction: 'Classify study.activityKind by dominant work: memorization_retrieval for memorizing/recalling items, problem_solving for exercises, reading, writing, mixed if none dominates, else other or unknown.',
  },
  {
    id: 'workload_unit_code',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Mapping the user’s counted unit to word/problem/page/etc. requires understanding language; deterministic code validates the selected canonical code instead of re-reading raw text.',
    instruction: 'For workload unitCode, select the supported standard unit matching the counted unit: minute, hour, page, problem, word, lesson, chapter, section, exam_year, mock_exam, or session. Use custom only if none matches. unitLabel may preserve the user’s wording without changing an otherwise matching standard unit into custom.',
  },
  {
    id: 'workload_quantity_effort',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Distinguishing fixed total scope, plan target, current progress, performance metrics, time-boxed work, duration cost, and per-unit effort requires semantic interpretation.',
    instruction: 'Use scope_total only for explicit bounded total. target requires explicit plan amount; never derive it from total/completed. If all remaining work is intended without a separate amount, omit target; deterministic progress projection derives remaining. completed/remaining describe progress through the referenced work. Exam/mock-test scores, grades, accuracy, rank, or other performance results are not workload progress unless the user explicitly says they are completion/progress of that material or task. Time the user wants scheduled is target minute/hour workload; set perOccurrence/recurrence when explicit. A duration costing separately stated work is total_duration/duration_per_unit effort; session_duration is a session cost unless that time itself is requested work. Preserve completed/remaining direction.',
  },
  {
    id: 'temporal_scope_and_deadline',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Whether timing is task-scoped, plan-wide availability, a deadline, or a preference is semantic meaning; deterministic calendar code operates only after that meaning is represented.',
    instruction: 'Named/current-task timing is task timing; availability is plan-wide and planningWindow is the whole-plan range. A task completion-by date/time is that task deadline with hard constraint level. Date-only earliest_start/latest_end is valid and must not invent a clock time. For recurring weekday availability, encode weekdays in days and keep dateExpression null unless a separate date scope was stated. Mandatory/unavailable/deadline are hard, preferences soft. Keep supported relative dates symbolic; deterministic calendar code resolves them.',
  },
  {
    id: 'availability_absence',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Distinguishing explicit absence of constraints from omitted information or positive availability depends on what the user actually asserted.',
    instruction: 'Use no_additional_constraint only when explicit; omission is not absence. available means positive available time/period. A daily total study capacity without a clock interval is not an all-day availability window; if no supported representation preserves it, emit uncertainty instead of widening it to full-day availability.',
  },
  {
    id: 'contextual_reference_binding',
    retentionBasis: 'contextual_reference_resolution',
    retentionReason: 'Resolving omitted or pronominal referents against conversation and typed public state requires contextual language understanding; deterministic code must not guess from labels or raw text.',
    instruction: 'Resolve omitted or pronominal targets from recentConversation/publicStateSummary only when one supported referent is clear; otherwise emit uncertainty. If the referent itself is unresolved, target that uncertainty to document, never to its own localId. Keep unrelated activities separate. Emit relations only when stated.',
  },
  {
    id: 'explicit_recurrence_sources',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Whether recurrence or an external source request was explicitly requested is an utterance-level semantic decision, not a schema default.',
    instruction: 'Emit recurrence and external source requests only when explicit.',
  },
  {
    id: 'durable_user_context',
    retentionBasis: 'semantic_scope_boundary',
    retentionReason: 'Separating owner-wide durable context from one-plan working facts requires interpreting persistence scope before deterministic storage can commit it.',
    instruction: 'userContextFacts are owner-wide durable context, not a copy of the current plan. Use study_goal for enduring academic/admission goals such as a target school or qualification; goal_event for dated milestones such as entrance exams; concern for durable weaknesses/worries; learning_preference only for preferences intended beyond this plan. Current-plan workload, availability, temporary priority, review rule, or one-off scheduling condition stays in plan facts and must not be persisted as userContextFacts. Approximate goal-event dates may remain custom symbolic expressions; never invent an exact day.',
  },
  {
    id: 'independent_clause_decision_correction',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Clause independence, corrections, and proposal decisions are discourse semantics; deterministic lifecycle code applies them only after the model identifies them.',
    instruction: 'Interpret clauses independently. Each explicit correction emits its replacement fact and replacementLocalId. Corrections/decisions do not suppress facts. Decisions only when explicit. Pending proposal decisions target kind=proposal and exact publicId.',
  },
] as const satisfies readonly {
  id: string;
  retentionBasis: WeeklyPlanningSemanticRuleRetentionBasisV5;
  retentionReason: string;
  instruction: string;
}[];

export type WeeklyPlanningSemanticMeaningRuleIdV5 =
  (typeof WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5)[number]['id'];

export function createWeeklyPlanningSemanticMeaningPolicyV5(): string {
  return WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5
    .map((rule) => rule.instruction)
    .join('\n');
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
