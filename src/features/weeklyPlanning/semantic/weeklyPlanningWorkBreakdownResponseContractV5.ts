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
  if (
    target?.decompositionStatus === 'decomposed'
    && target.category === 'study'
    && (target.study?.components.length ?? 0) === 0
  ) {
    errors.push('document:work-breakdown-decomposed-without-constituents');
  }

  return errors;
}
