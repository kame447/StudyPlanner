/*
 * Allowed deterministic normalization boundary
 *
 * This module may remove only an exact duplicate workload placement when one
 * task-level workload and exactly one nested component workload carry the same
 * typed/evidence payload. workload.localId is an identity token, not semantic
 * meaning, so equality deliberately ignores only that field. All other fields,
 * including sourceText, must remain byte-equivalent.
 *
 * The code does not interpret sourceText, infer that different labels/units/
 * quantities/roles mean the same thing, perform unit conversion, or choose an
 * owner when multiple components contain the same payload. Any non-exact or
 * multiply-owned case must remain unchanged and be rejected or repaired by the
 * semantic AI through the normal validation loop.
 *
 * Do not extend this code with fuzzy matching, unit conversion, label similarity,
 * source-text interpretation, or scenario-specific merging. Those are semantic
 * decisions and belong to the AI-owned layer.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/audits/20260803-weekly-planning-semantic-ownership-phase0-phase1.md
 */
export const WEEKLY_PLANNING_DUPLICATE_WORKLOAD_NORMALIZATION_V5 =
  'weekly-planning-duplicate-workload-normalization-v5' as const;

export interface DuplicateWorkloadNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function semanticWorkloadValue(workload: Record<string, unknown>): Record<string, unknown> {
  const { localId: _localId, ...semanticValue } = workload;
  return semanticValue;
}

function equalWorkloadMeaning(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return equalValue(semanticWorkloadValue(left), semanticWorkloadValue(right));
}

function workloadsFromComponents(task: Record<string, unknown>): Record<string, unknown>[] {
  const workloads: Record<string, unknown>[] = [];
  const study = isRecord(task.study) ? task.study : null;
  const components = Array.isArray(study?.components) ? study.components : [];

  for (const component of components) {
    if (!isRecord(component) || !Array.isArray(component.workloads)) continue;
    for (const workload of component.workloads) {
      if (!isRecord(workload) || typeof workload.localId !== 'string') continue;
      workloads.push(workload);
    }
  }
  return workloads;
}

export function normalizeExactDuplicateWorkloadPlacementV5(
  rawResponse: string,
): DuplicateWorkloadNormalizationResultV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
    return { rawResponse, repairs: [] };
  }

  const repairs: string[] = [];
  let changed = false;
  const tasks = parsed.tasks.map((taskValue) => {
    if (!isRecord(taskValue) || !Array.isArray(taskValue.workloads)) return taskValue;
    const nestedWorkloads = workloadsFromComponents(taskValue);
    const taskLocalId = typeof taskValue.localId === 'string'
      ? taskValue.localId
      : 'unknown-task';
    const workloads = taskValue.workloads.filter((workload) => {
      if (!isRecord(workload) || typeof workload.localId !== 'string') return true;
      const nestedMatches = nestedWorkloads.filter((nested) =>
        equalWorkloadMeaning(workload, nested));
      if (nestedMatches.length !== 1) return true;
      repairs.push(
        `duplicate-workload-removed-from-task:${taskLocalId}:${workload.localId}`,
      );
      changed = true;
      return false;
    });
    return workloads === taskValue.workloads
      ? taskValue
      : { ...taskValue, workloads };
  });

  if (!changed) return { rawResponse, repairs: [] };
  return {
    rawResponse: JSON.stringify({ ...parsed, tasks }),
    repairs,
  };
}
