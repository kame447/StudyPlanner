/*
 * Allowed deterministic normalization boundary
 *
 * A study component is already owned by the task whose study.components array
 * contains it. parentLocalId represents only component-to-component hierarchy.
 * Therefore a component whose parentLocalId is exactly the containing task's
 * own localId has one structurally valid interpretation: it is a top-level
 * component and parentLocalId must be null.
 *
 * This module must not repair any other parent reference. In particular it must
 * not infer parents from labels, roles, sourceText, component order, or similar
 * IDs. Those cases remain unchanged and are rejected/repaired through the
 * normal semantic validation loop.
 */
export const WEEKLY_PLANNING_COMPONENT_PARENT_NORMALIZATION_V5 =
  'weekly-planning-component-parent-normalization-v5' as const;

export interface ComponentParentNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeContainingTaskComponentParentV5(
  rawResponse: string,
): ComponentParentNormalizationResultV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
    return { rawResponse, repairs: [] };
  }

  let changed = false;
  const repairs: string[] = [];
  const tasks = parsed.tasks.map((taskValue) => {
    if (!isRecord(taskValue) || typeof taskValue.localId !== 'string') {
      return taskValue;
    }
    if (!isRecord(taskValue.study) || !Array.isArray(taskValue.study.components)) {
      return taskValue;
    }

    let taskChanged = false;
    const components = taskValue.study.components.map((componentValue) => {
      if (!isRecord(componentValue)) return componentValue;
      if (componentValue.parentLocalId !== taskValue.localId) return componentValue;
      if (typeof componentValue.localId !== 'string' || !componentValue.localId) {
        return componentValue;
      }
      changed = true;
      taskChanged = true;
      repairs.push(
        `component-parent-task-reference-normalized:${taskValue.localId}:${componentValue.localId}`,
      );
      return { ...componentValue, parentLocalId: null };
    });

    if (!taskChanged) return taskValue;
    return {
      ...taskValue,
      study: {
        ...taskValue.study,
        components,
      },
    };
  });

  if (!changed) return { rawResponse, repairs: [] };
  return {
    rawResponse: JSON.stringify({ ...parsed, tasks }),
    repairs,
  };
}
