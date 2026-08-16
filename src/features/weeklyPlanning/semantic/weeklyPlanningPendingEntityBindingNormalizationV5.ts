export const WEEKLY_PLANNING_PENDING_ENTITY_BINDING_NORMALIZATION_VERSION_V5 =
  'weekly-planning-pending-entity-binding-normalization-v5' as const;

export interface WeeklyPlanningPendingEntityBindingNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * Restores one corrupted cross-turn container ID only when the other side of
 * the exact pending component binding is already correct.
 *
 * This does not compare labels or user text. A valid different public ID is
 * never overwritten, and two unknown IDs are left for the normal AI repair
 * path because there is no exact anchor.
 */
export function normalizePendingQuestionEntityBindingsV5(params: {
  rawResponse: string;
  publicStateSummary?: Record<string, unknown>;
}): WeeklyPlanningPendingEntityBindingNormalizationResultV5 {
  const state = params.publicStateSummary;
  const pendingQuestion = isRecord(state?.pendingQuestion)
    ? state.pendingQuestion
    : null;
  if (
    pendingQuestion?.questionCode !== 'missing_schedulable_work'
    || typeof pendingQuestion.targetFactId !== 'string'
  ) {
    return { rawResponse: params.rawResponse, repairs: [] };
  }

  const publicTasks = recordArray(state?.tasks);
  const publicComponents = recordArray(state?.components);
  const targetComponent = publicComponents.find(
    (component) => component.publicId === pendingQuestion.targetFactId,
  );
  if (
    !targetComponent
    || typeof targetComponent.publicId !== 'string'
    || typeof targetComponent.taskPublicId !== 'string'
    || !publicTasks.some((task) => task.publicId === targetComponent.taskPublicId)
  ) {
    return { rawResponse: params.rawResponse, repairs: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(params.rawResponse);
  } catch {
    return { rawResponse: params.rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks) || parsed.tasks.length !== 1) {
    return { rawResponse: params.rawResponse, repairs: [] };
  }
  const task = parsed.tasks[0];
  if (!isRecord(task) || !isRecord(task.study) || !Array.isArray(task.study.components)) {
    return { rawResponse: params.rawResponse, repairs: [] };
  }
  if (task.study.components.length !== 1 || !isRecord(task.study.components[0])) {
    return { rawResponse: params.rawResponse, repairs: [] };
  }
  const component = task.study.components[0];
  if (
    typeof task.existingPublicId !== 'string'
    || typeof component.existingPublicId !== 'string'
  ) {
    return { rawResponse: params.rawResponse, repairs: [] };
  }

  const expectedTaskId = targetComponent.taskPublicId;
  const expectedComponentId = targetComponent.publicId;
  const taskExact = task.existingPublicId === expectedTaskId;
  const componentExact = component.existingPublicId === expectedComponentId;
  if (!taskExact && !componentExact) {
    return { rawResponse: params.rawResponse, repairs: [] };
  }

  const knownTaskIds = new Set(
    publicTasks.map((value) => value.publicId).filter((value): value is string => typeof value === 'string'),
  );
  const knownComponentIds = new Set(
    publicComponents
      .map((value) => value.publicId)
      .filter((value): value is string => typeof value === 'string'),
  );
  if (
    (!taskExact && knownTaskIds.has(task.existingPublicId))
    || (!componentExact && knownComponentIds.has(component.existingPublicId))
  ) {
    return { rawResponse: params.rawResponse, repairs: [] };
  }

  const repairs: string[] = [];
  if (!taskExact) {
    task.existingPublicId = expectedTaskId;
    repairs.push(`pending-component-parent-task-id-restored:${String(task.localId ?? 'unknown-task')}`);
  }
  if (!componentExact) {
    component.existingPublicId = expectedComponentId;
    repairs.push(`pending-component-id-restored:${String(component.localId ?? 'unknown-component')}`);
  }
  return {
    rawResponse: JSON.stringify(parsed),
    repairs,
  };
}
