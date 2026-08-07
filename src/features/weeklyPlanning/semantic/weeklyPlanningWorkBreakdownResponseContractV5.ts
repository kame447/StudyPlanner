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

function pendingBreakdownTargetPublicId(
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
  const targetPublicId = pendingBreakdownTargetPublicId(params.publicStateSummary);
  if (!targetPublicId) return [];

  const errors: string[] = [];
  const targetEntries = params.document.tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.existingPublicId === targetPublicId);

  if (targetEntries.length !== 1) {
    errors.push(`document:work-breakdown-target-task-required:target=${targetPublicId}`);
  }

  for (const [taskIndex, task] of params.document.tasks.entries()) {
    if (task.existingPublicId && task.existingPublicId !== targetPublicId) {
      errors.push(
        `document.tasks[${taskIndex}]:work-breakdown-unrelated-existing-task:${task.existingPublicId}`,
      );
    }
  }

  const target = targetEntries[0]?.task;
  if (
    target?.decompositionStatus === 'decomposed'
    && target.category === 'study'
    && (target.study?.components.length ?? 0) === 0
  ) {
    errors.push('document:work-breakdown-decomposed-without-constituents');
  }

  if (params.document.planningWindow) {
    errors.push('document.planningWindow:work-breakdown-current-delta-only');
  }
  if ((params.document.userContextFacts ?? []).length > 0) {
    errors.push('document.userContextFacts:work-breakdown-current-delta-only');
  }

  return errors;
}
