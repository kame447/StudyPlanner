import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { filterActiveWeeklyPlanningFactsV5 } from './weeklyPlanningFactLifecycleV5';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function declaredLocalIds(document: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const pending: unknown[] = [document];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (key === 'localId' && typeof item === 'string') ids.add(item);
        else pending.push(item);
      }
    }
  }
  return ids;
}

/**
 * A fact may use its containing task's exact active public ID where the wire
 * requires that same entry's local ID. Change only this representation; leave
 * all schema, evidence, binding, lifecycle and value decisions to validation.
 * Run before other stages can replace bindings or remove local declarations.
 */
export function normalizeWeeklyPlanningTaskSelfReferenceV5(params: {
  rawResponse: string;
  committedGraph?: WeeklyPlanningFactGraphV5;
}): { rawResponse: string; repairs: string[] } {
  const unchanged = { rawResponse: params.rawResponse, repairs: [] as string[] };
  if (!params.committedGraph) return unchanged;
  let document: unknown;
  try { document = JSON.parse(params.rawResponse); } catch { return unchanged; }
  if (!isRecord(document) || !Array.isArray(document.tasks)) return unchanged;

  const activeTaskIds = new Set(filterActiveWeeklyPlanningFactsV5(
    params.committedGraph,
    params.committedGraph.tasks,
  ).map(task => task.id));
  const declared = declaredLocalIds(document);
  const repairs: string[] = [];
  for (const task of document.tasks) {
    if (!isRecord(task) || typeof task.existingPublicId !== 'string'
      || typeof task.localId !== 'string' || task.localId.trim().length === 0
      || !activeTaskIds.has(task.existingPublicId)
      || declared.has(task.existingPublicId)) continue;
    for (const kind of ['temporalConstraints', 'effortEstimates', 'recurrence'] as const) {
      const facts = task[kind];
      if (!Array.isArray(facts)) continue;
      for (const fact of facts) {
        if (!isRecord(fact) || fact.targetLocalId !== task.existingPublicId) continue;
        fact.targetLocalId = task.localId;
        repairs.push(`task-self-reference-projected:${JSON.stringify([
          task.localId, task.existingPublicId, kind, fact.localId,
        ])}`);
      }
    }
  }
  return repairs.length === 0
    ? unchanged
    : { rawResponse: JSON.stringify(document), repairs };
}
