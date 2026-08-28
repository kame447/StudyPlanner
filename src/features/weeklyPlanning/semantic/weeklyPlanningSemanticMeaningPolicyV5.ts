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
    instruction: 'Interpret every supported explicit current-turn contribution, including side contributions; pending questions do not suppress stated facts.',
  },
  {
    id: 'task_structure',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Choosing whether language denotes a task, subordinate component, attachment target, or a genuine new decomposition requirement requires semantic interpretation before structural validation can run.',
    instruction: 'Treat requested learning work as study tasks and preserve meaningful task/component structure. Attach work, effort, constraints and context to their targets. Performance-only mentions (for example exam scores) do not create tasks/components. Relation endpoints must be emitted here or explicitly bound existing entities; never invent endpoints. Minimal existingPublicId shells do not create breakdown needs; emit work_breakdown uncertainty only for genuine current-turn structural ambiguity.',
  },
  {
    id: 'study_activity_kind',
    retentionBasis: 'language_interpretation',
    retentionReason: 'The dominant study activity is a semantic classification of the described work; deterministic code only validates the closed representation.',
    instruction: 'Classify study.activityKind by dominant work: memorization_retrieval, problem_solving, reading, writing, mixed if none dominates, else other or unknown.',
  },
  {
    id: 'workload_unit_code',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Mapping the user’s counted unit to word/problem/page/etc. requires understanding language; deterministic code validates the selected canonical code instead of re-reading raw text.',
    instruction: 'For workload unitCode use the matching standard unit: minute, hour, page, problem, word, lesson, chapter, section, exam_year, mock_exam, session; custom only when none matches. unitLabel may preserve wording.',
  },
  {
    id: 'workload_quantity_effort',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Distinguishing fixed total scope, plan target, current progress, performance metrics, time-boxed work, duration cost, and per-unit effort requires semantic interpretation.',
    instruction: 'scope_total needs an explicit bounded total; target needs an explicit plan amount and is never derived from total/completed. A qualitative scope boundary without a stated count belongs in task/component structure, not amount=1 custom workload; if measurable breakdown is required, emit work_breakdown uncertainty instead of inventing quantity or total duration. If all remaining work is intended, omit target and let deterministic progress derive remaining. completed/remaining are workload progress; scores/grades/accuracy/rank are not unless explicitly material/task completion. Requested study time is target minute/hour workload, not progress. Keep perOccurrence/recurrence aligned. Separate workload cost uses total_duration/duration_per_unit; session_duration only for one session.',
  },
  {
    id: 'temporal_scope_and_deadline',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Whether timing is task-scoped, plan-wide availability, a deadline, or a preference is semantic meaning; deterministic calendar code operates only after that meaning is represented.',
    instruction: 'Task timing is task-scoped; availability plan-wide; planningWindow whole-plan. Completion-by is hard deadline. Date-only earliest_start/latest_end is valid; never invent clocks. fixed_interval requires both clock startTime/endTime; never use it for a date-only period. Date-only from/after -> earliest_start; until/by -> latest_end or deadline; emit both when both stated. Recurring weekdays use days with null dateExpression unless separately date-scoped. Mandatory/unavailable/deadline are hard; preferences soft. Keep relative dates symbolic for deterministic calendar resolution.',
  },
  {
    id: 'availability_absence',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Distinguishing explicit absence of constraints from omitted information or positive availability depends on what the user actually asserted.',
    instruction: 'Use no_additional_constraint only when explicit; omission is not absence. available is positive availability. A daily total capacity without clock bounds is not all-day availability; if unsupported, emit uncertainty rather than widen it.',
  },
  {
    id: 'contextual_reference_binding',
    retentionBasis: 'contextual_reference_resolution',
    retentionReason: 'Resolving omitted or pronominal referents against conversation and typed public state requires contextual language understanding; deterministic code must not guess from labels or raw text.',
    instruction: 'Resolve omitted/pronominal targets from recentConversation/publicStateSummary only with one clear supported referent; otherwise emit uncertainty. Unresolved referent uncertainty targets document. Keep unrelated activities separate. Emit relations only when stated.',
  },
  {
    id: 'explicit_recurrence_sources',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Whether recurrence or an external source request was explicitly requested is an utterance-level semantic decision, not a schema default.',
    instruction: 'Emit recurrence and external source requests only when explicit. A perOccurrence workload with an explicit period must have matching recurrence on that same task/component target, not only on an ancestor task.',
  },
  {
    id: 'durable_user_context',
    retentionBasis: 'semantic_scope_boundary',
    retentionReason: 'Separating owner-wide durable context from one-plan working facts requires interpreting persistence scope before deterministic storage can commit it.',
    instruction: 'userContextFacts are durable owner-wide context only: study_goal for enduring academic/admission goals, goal_event for dated milestones, concern for durable weaknesses/worries, learning_preference only beyond this plan. Plan workload, availability, temporary priority/review rules and one-off conditions stay plan-local. Approximate goal-event dates may use custom symbolic form; never invent an exact day.',
  },
  {
    id: 'independent_clause_decision_correction',
    retentionBasis: 'language_interpretation',
    retentionReason: 'Clause independence, corrections, and proposal decisions are discourse semantics; deterministic lifecycle code applies them only after the model identifies them.',
    instruction: 'Interpret clauses independently. Explicit corrections emit replacement facts and replacementLocalId. Corrections/decisions do not suppress facts. Emit decisions only when explicit; pending proposal decisions target proposal and exact publicId.',
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
