import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_WORK_BREAKDOWN_RESPONSE_CONTRACT_VERSION_V5 =
  'weekly-planning-work-breakdown-response-contract-v5' as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(
  publicStateSummary?: Record<string, unknown>,
): string | null {
  if (!publicStateSummary) return null;
  const pending = publicStateSummary.pendingQuestion;
  if (!isRecord(pending) || pending.questionCode !== 'semantic_uncertainty') return null;
  if (typeof pending.targetFactId !== 'string') return null;

  const uncertainty = recordArray(publicStateSummary.uncertainties).find(
    (entry) => entry.publicId === pending.targetFactId && entry.field === 'work_breakdown',
  );
  return uncertainty && typeof uncertainty.targetPublicId === 'string'
    ? uncertainty.targetPublicId
    : null;
}

export function validateWeeklyPlanningWorkBreakdownResponseContractV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  publicStateSummary?: Record<string, unknown>;
}): string[] {
  const targetPublicId = readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(
    params.publicStateSummary,
  );
  if (!targetPublicId) return [];

  const errors: string[] = [];
  const targetEntries = params.document.tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.existingPublicId === targetPublicId);

  // The pending target must stay represented, but a pending question must not
  // suppress other explicit contributions from the same user turn. Deciding
  // which additional facts belong to the utterance is semantic-layer work;
  // this deterministic contract only protects the pending target's structure.
  if (targetEntries.length !== 1) {
    errors.push(`document:work-breakdown-target-task-required:target=${targetPublicId}`);
  }

  const target = targetEntries[0]?.task;
  const targetComponents = target?.category === 'study'
    ? (target.study?.components ?? [])
    : [];
  if (
    target?.decompositionStatus === 'decomposed'
    && target.category === 'study'
    && targetComponents.length === 0
  ) {
    errors.push('document:work-breakdown-decomposed-without-constituents');
  }

  // `decomposed` means this turn has supplied a usable constituent structure
  // for the pending parent task. Keeping another work_breakdown uncertainty on
  // that same parent is contradictory and causes the dialogue to ask the exact
  // question again. Unknown quantity/effort may remain unknown, but it must be
  // represented by its own typed dimension rather than reopening breakdown.
  if (
    target?.decompositionStatus === 'decomposed'
    && targetComponents.length > 0
    && params.document.uncertainties.some((uncertainty) =>
      uncertainty.field === 'work_breakdown'
      && uncertainty.targetLocalId === target.localId)
  ) {
    errors.push('document:work-breakdown-decomposed-target-cannot-remain-uncertain');
  }

  return errors;
}
