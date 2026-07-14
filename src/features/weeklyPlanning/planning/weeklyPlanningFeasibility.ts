import type { WeeklyDraftCandidateDiagnostics } from '../scheduling/weeklyDraftCandidateGenerator';
import type { AllowedDialogueAction } from './weeklyPlanningBehaviorTypes';

export type FeasibilityClassification =
  | 'feasible'
  | 'partially_feasible'
  | 'infeasible'
  | 'unknown';

export type FeasibilityPreviewEligibility =
  | 'eligible'
  | 'eligible_with_pending_assumption'
  | 'blocked'
  | 'unsupported';

export interface FeasibilitySummary {
  classification: FeasibilityClassification;
  requiredMinutes: number;
  availableMinutes: number;
  scheduledMinutes: number;
  unscheduledMinutes: number;
  unscheduledTaskRefs: string[];
  bottleneckFactRefs: string[];
  conflictFactRefs: string[];
  deterministicOptionIds: string[];
  previewEligibility: FeasibilityPreviewEligibility;
  stateRevision: number;
  previewId?: string;
}

export type FeasibilityValidationResult =
  | { accepted: true; summary: FeasibilitySummary }
  | { accepted: false; reason: string };

function nonnegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort();
}

function taskRef(field: string, year: number): string {
  return `work-item:${encodeURIComponent(field)}:${year}`;
}

function optionIds(unscheduledTaskRefs: readonly string[]): string[] {
  return uniqueSorted(unscheduledTaskRefs.flatMap((ref) => [
    `feasibility:prioritize:${ref}`,
    `feasibility:split:${ref}`,
    `feasibility:defer:${ref}`,
  ]));
}

export function createFeasibilitySummary(params: {
  diagnostics: WeeklyDraftCandidateDiagnostics | null;
  availableMinutes?: number;
  stateRevision: number;
  previewId?: string;
  pendingAssumption?: boolean;
  supported?: boolean;
  bottleneckFactRefs?: readonly string[];
}): FeasibilitySummary {
  const supported = params.supported !== false;
  const diagnostics = params.diagnostics;
  if (!diagnostics) {
    return {
      classification: 'unknown',
      requiredMinutes: 0,
      availableMinutes: Math.max(0, params.availableMinutes ?? 0),
      scheduledMinutes: 0,
      unscheduledMinutes: 0,
      unscheduledTaskRefs: [],
      bottleneckFactRefs: uniqueSorted(params.bottleneckFactRefs ?? []),
      conflictFactRefs: [],
      deterministicOptionIds: [],
      previewEligibility: supported ? 'blocked' : 'unsupported',
      stateRevision: params.stateRevision,
      ...(params.previewId ? { previewId: params.previewId } : {}),
    };
  }

  const requiredMinutes = Math.max(0, diagnostics.totalRequestedMinutes);
  const scheduledMinutes = Math.max(0, diagnostics.totalScheduledMinutes);
  const unscheduledMinutes = Math.max(0, requiredMinutes - scheduledMinutes);
  const unscheduledTaskRefs = uniqueSorted(diagnostics.unscheduledItems.map((item) =>
    taskRef(item.field, item.year),
  ));
  const conflictFactRefs = uniqueSorted([
    ...diagnostics.constraintConflicts.map((item) => item.rawText ?? item.reason),
    ...diagnostics.fixedEventConflicts.map((item) => item.rawText ?? item.reason),
    ...diagnostics.lifeConstraintConflicts.map((item) => item.rawText ?? item.reason),
  ]);
  const classification: FeasibilityClassification = requiredMinutes === 0
    ? 'unknown'
    : scheduledMinutes >= requiredMinutes
      ? 'feasible'
      : scheduledMinutes > 0
        ? 'partially_feasible'
        : 'infeasible';
  const previewEligibility: FeasibilityPreviewEligibility = !supported
    ? 'unsupported'
    : classification === 'feasible'
      ? params.pendingAssumption
        ? 'eligible_with_pending_assumption'
        : 'eligible'
      : 'blocked';

  return {
    classification,
    requiredMinutes,
    availableMinutes: Math.max(0, params.availableMinutes ?? scheduledMinutes),
    scheduledMinutes,
    unscheduledMinutes,
    unscheduledTaskRefs,
    bottleneckFactRefs: uniqueSorted(params.bottleneckFactRefs ?? []),
    conflictFactRefs,
    deterministicOptionIds: optionIds(unscheduledTaskRefs),
    previewEligibility,
    stateRevision: params.stateRevision,
    ...(params.previewId ? { previewId: params.previewId } : {}),
  };
}

export function validateFeasibilitySummary(
  value: FeasibilitySummary,
  currentStateRevision: number,
): FeasibilityValidationResult {
  if (!['feasible', 'partially_feasible', 'infeasible', 'unknown'].includes(value.classification)
    || !['eligible', 'eligible_with_pending_assumption', 'blocked', 'unsupported'].includes(value.previewEligibility)
    || !nonnegativeFinite(value.requiredMinutes)
    || !nonnegativeFinite(value.availableMinutes)
    || !nonnegativeFinite(value.scheduledMinutes)
    || !nonnegativeFinite(value.unscheduledMinutes)
    || !Number.isInteger(value.stateRevision)
    || value.stateRevision !== currentStateRevision
    || value.scheduledMinutes + value.unscheduledMinutes !== value.requiredMinutes
    || value.scheduledMinutes > value.availableMinutes && value.availableMinutes > 0
    || value.unscheduledTaskRefs.some((ref) => !ref.startsWith('work-item:'))
    || value.deterministicOptionIds.some((id) => !id.startsWith('feasibility:'))
    || new Set(value.deterministicOptionIds).size !== value.deterministicOptionIds.length) {
    return { accepted: false, reason: 'invalid-feasibility-summary' };
  }
  if (value.classification === 'feasible' && value.unscheduledMinutes !== 0) {
    return { accepted: false, reason: 'feasible-with-unscheduled-work' };
  }
  if (value.previewEligibility === 'eligible' && value.classification !== 'feasible') {
    return { accepted: false, reason: 'ineligible-classification' };
  }
  return {
    accepted: true,
    summary: {
      ...value,
      unscheduledTaskRefs: [...value.unscheduledTaskRefs],
      bottleneckFactRefs: [...value.bottleneckFactRefs],
      conflictFactRefs: [...value.conflictFactRefs],
      deterministicOptionIds: [...value.deterministicOptionIds],
    },
  };
}

export function createFeasibilityDialogueActions(
  summary: FeasibilitySummary,
): AllowedDialogueAction[] {
  if (summary.classification === 'feasible') return [];
  if (summary.classification === 'unknown') {
    return [{
      actionId: `feasibility:${summary.stateRevision}:clarify`,
      kind: 'ask_required_fact',
      topicId: 'feasibility_basis',
      sourceFactRefs: [...summary.bottleneckFactRefs],
      allowedProposalRefs: [],
      allowedOptionIds: [],
      maxItems: 1,
      displayHint: '配置可能性を判断するため、利用可能時間または作業量を確認してください。',
    }];
  }
  return [{
    actionId: `feasibility:${summary.stateRevision}:report`,
    kind: 'report_infeasibility',
    topicId: 'feasibility_adjustment',
    sourceFactRefs: uniqueSorted([
      ...summary.bottleneckFactRefs,
      ...summary.conflictFactRefs,
      ...summary.unscheduledTaskRefs,
    ]),
    allowedProposalRefs: [],
    allowedOptionIds: [...summary.deterministicOptionIds],
    maxItems: Math.min(3, Math.max(1, summary.deterministicOptionIds.length)),
    displayHint: summary.classification === 'partially_feasible'
      ? '一部は配置できます。優先・分割・延期の候補から調整してください。'
      : '現在の条件では配置できません。優先・分割・延期の候補を選んでください。',
  }];
}
