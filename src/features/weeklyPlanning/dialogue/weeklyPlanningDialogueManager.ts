import type { WeeklyPlanningDraftRequest } from '../intake/weeklyPlanningDraftRequestAdapter';
import type {
  LifeConstraint,
  PlanningIntakeMissing,
  PlanningIntakeState,
  StudyProgressAmbiguity,
} from '../intake/weeklyPlanningIntakeTypes';
import type {
  WeeklyPlanningRemainingWorkItemsResult,
} from '../intake/weeklyPlanningRemainingWorkItems';
import type {
  WeeklyDraftCandidate,
  WeeklyDraftCandidateDiagnostics,
} from '../scheduling/weeklyDraftCandidateGenerator';

export type WeeklyPlanningDialogueDecisionKind =
  | 'ask_missing_info'
  | 'confirm_ambiguity'
  | 'confirm_draft_conditions'
  | 'offer_dry_run_preview'
  | 'ask_relax_constraints'
  | 'cannot_create_draft';

export interface WeeklyPlanningDialogueDecisionSummary {
  yearRange?: {
    startYear: number;
    endYear: number;
    sourceText: string;
  };
  fields?: string[];
  completedYears?: Array<{
    field?: string;
    years: number[];
  }>;
  fixedEventCount?: number;
  lifeConstraintKinds?: LifeConstraint['kind'][];
  remainingWorkItemCount?: number;
  totalRequestedMinutes?: number;
  totalScheduledMinutes?: number;
  unscheduledItemCount?: number;
  constraintConflictCount?: number;
  fixedEventConflictCount?: number;
  lifeConstraintConflictCount?: number;
}

export interface WeeklyPlanningDialogueDecision {
  kind: WeeklyPlanningDialogueDecisionKind;
  messageKey: string;
  requiredFields?: string[];
  ambiguities?: string[];
  summary?: WeeklyPlanningDialogueDecisionSummary;
  shouldCreateDraft: boolean;
  shouldSavePlan: false;
}

export interface WeeklyPlanningDialogueDecisionInput {
  state: PlanningIntakeState;
  draftRequest?: WeeklyPlanningDraftRequest | null;
  remainingWorkItems?: WeeklyPlanningRemainingWorkItemsResult | null;
  dryRunCandidates?: WeeklyDraftCandidate[] | null;
  dryRunDiagnostics?: WeeklyDraftCandidateDiagnostics | null;
}

const MISSING_FIELD_KEYS: Record<PlanningIntakeMissing, string> = {
  tasks_or_goals: 'tasks_or_goals',
  fixed_events: 'fixed_events',
  sleep_cycle: 'sleep_cycle',
  meal_bath_constraints: 'life_constraints',
  year_range: 'year_range',
  progress: 'progress',
  completion_direction: 'completion_direction',
  unit_duration_estimate: 'unit_rate',
  priority_policy: 'priority_policy',
  next_field_after_math: 'priority_policy',
  life_constraints: 'life_constraints',
};

function uniqueList<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function missingMessageKey(missing: PlanningIntakeMissing[]): string {
  if (missing.includes('year_range')) return 'ask_year_range';
  if (missing.includes('unit_duration_estimate')) return 'ask_unit_rate';
  if (missing.includes('priority_policy') || missing.includes('next_field_after_math')) {
    return 'ask_priority_policy';
  }
  if (
    missing.includes('life_constraints') ||
    missing.includes('sleep_cycle') ||
    missing.includes('meal_bath_constraints')
  ) {
    return 'ask_life_constraints';
  }
  if (missing.includes('fixed_events')) return 'ask_fixed_events';
  if (missing.includes('tasks_or_goals')) return 'ask_tasks_or_goals';
  if (missing.includes('completion_direction') || missing.includes('progress')) {
    return 'ask_progress_clarification';
  }

  return 'ask_missing_info';
}

function normalizeProgressAmbiguity(
  ambiguity: StudyProgressAmbiguity,
): string | null {
  return ambiguity === 'none' ? null : ambiguity;
}

function collectAmbiguities(input: WeeklyPlanningDialogueDecisionInput): string[] {
  const progressAmbiguities = input.state.progress
    .map((progress) => normalizeProgressAmbiguity(progress.ambiguity))
    .filter((ambiguity): ambiguity is string => Boolean(ambiguity));
  const remainingAmbiguities = (input.remainingWorkItems?.ambiguities ?? []).filter((ambiguity) =>
    ambiguity === 'completed_years_without_field_scope',
  );
  const softFixedEvents = input.state.constraints
    .filter((constraint) => constraint.kind === 'fixed_event' && constraint.hardness === 'soft')
    .map(() => 'fixed_event_uncertain');

  return uniqueList([...progressAmbiguities, ...remainingAmbiguities, ...softFixedEvents]);
}

function hasUnscheduledItems(
  diagnostics: WeeklyDraftCandidateDiagnostics | null | undefined,
): boolean {
  return Boolean(diagnostics?.unscheduledItems.length);
}

function hasDryRunPreview(input: WeeklyPlanningDialogueDecisionInput): boolean {
  return Boolean(input.dryRunCandidates?.length && input.dryRunDiagnostics);
}

function summarizeCompletedYears(
  request: WeeklyPlanningDraftRequest | null | undefined,
): WeeklyPlanningDialogueDecisionSummary['completedYears'] | undefined {
  const completedYears = request?.progress
    .filter((progress) => progress.completedYears.length > 0)
    .map((progress) => ({
      field: progress.field,
      years: [...progress.completedYears],
    }));

  return completedYears && completedYears.length > 0 ? completedYears : undefined;
}

function summarizeLifeConstraintKinds(
  request: WeeklyPlanningDraftRequest | null | undefined,
): LifeConstraint['kind'][] | undefined {
  const kinds = uniqueList((request?.constraints ?? []).map((constraint) => constraint.kind));
  return kinds.length > 0 ? kinds : undefined;
}

function createSummary(
  input: WeeklyPlanningDialogueDecisionInput,
): WeeklyPlanningDialogueDecisionSummary {
  const request = input.draftRequest;
  const diagnostics = input.dryRunDiagnostics;

  return {
    yearRange: request?.examPrepScope.yearRange,
    fields: request?.examPrepScope.fields,
    completedYears: summarizeCompletedYears(request),
    fixedEventCount: request?.fixedEvents.length,
    lifeConstraintKinds: summarizeLifeConstraintKinds(request),
    remainingWorkItemCount: input.remainingWorkItems?.items.length,
    totalRequestedMinutes: diagnostics?.totalRequestedMinutes,
    totalScheduledMinutes: diagnostics?.totalScheduledMinutes,
    unscheduledItemCount: diagnostics?.unscheduledItems.length,
    constraintConflictCount: diagnostics?.constraintConflicts.length,
    fixedEventConflictCount: diagnostics?.fixedEventConflicts.length,
    lifeConstraintConflictCount: diagnostics?.lifeConstraintConflicts.length,
  };
}

function createDecision(params: {
  kind: WeeklyPlanningDialogueDecisionKind;
  messageKey: string;
  requiredFields?: string[];
  ambiguities?: string[];
  summary?: WeeklyPlanningDialogueDecisionSummary;
  shouldCreateDraft?: boolean;
}): WeeklyPlanningDialogueDecision {
  return {
    kind: params.kind,
    messageKey: params.messageKey,
    requiredFields: params.requiredFields,
    ambiguities: params.ambiguities,
    summary: params.summary,
    shouldCreateDraft: params.shouldCreateDraft ?? false,
    shouldSavePlan: false,
  };
}

export function createWeeklyPlanningDialogueDecision(
  input: WeeklyPlanningDialogueDecisionInput,
): WeeklyPlanningDialogueDecision {
  const missing = uniqueList(input.state.missing);

  if (missing.length > 0) {
    return createDecision({
      kind: 'ask_missing_info',
      messageKey: missingMessageKey(missing),
      requiredFields: uniqueList(missing.map((item) => MISSING_FIELD_KEYS[item])),
    });
  }

  const ambiguities = collectAmbiguities(input);

  if (ambiguities.length > 0) {
    return createDecision({
      kind: 'confirm_ambiguity',
      messageKey: 'confirm_intake_ambiguity',
      ambiguities,
    });
  }

  if (input.state.shouldCreateDraft && !input.draftRequest) {
    return createDecision({
      kind: 'cannot_create_draft',
      messageKey: 'cannot_create_draft_from_intake',
      summary: createSummary(input),
    });
  }

  if (hasUnscheduledItems(input.dryRunDiagnostics)) {
    return createDecision({
      kind: 'ask_relax_constraints',
      messageKey: 'ask_relax_constraints_for_unscheduled_items',
      summary: createSummary(input),
    });
  }

  if (hasDryRunPreview(input)) {
    return createDecision({
      kind: 'offer_dry_run_preview',
      messageKey: 'offer_weekly_plan_dry_run_preview',
      summary: createSummary(input),
      shouldCreateDraft: true,
    });
  }

  if (input.state.status === 'draft_ready' && input.draftRequest) {
    return createDecision({
      kind: 'confirm_draft_conditions',
      messageKey: 'confirm_weekly_draft_conditions',
      summary: createSummary(input),
      shouldCreateDraft: true,
    });
  }

  return createDecision({
    kind: 'cannot_create_draft',
    messageKey: 'cannot_create_draft_from_intake',
    summary: createSummary(input),
  });
}