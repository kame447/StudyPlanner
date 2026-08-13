import type { TaskRelationFact } from './weeklyPlanningFactGraph';

export interface WeeklyPlanningRelationCycleV5 {
  relationFactIds: string[];
  taskIds: string[];
}

function precedenceEdge(
  relation: Pick<TaskRelationFact, 'kind' | 'fromTaskId' | 'toTaskId'>,
): { before: string; after: string } {
  switch (relation.kind) {
    case 'after':
    case 'depends_on':
      return { before: relation.toTaskId, after: relation.fromTaskId };
    case 'before':
    case 'sequence':
    case 'priority_over':
    default:
      return { before: relation.fromTaskId, after: relation.toTaskId };
  }
}

export function detectWeeklyPlanningRelationCycleV5(
  relations: readonly Pick<TaskRelationFact, 'id' | 'kind' | 'fromTaskId' | 'toTaskId'>[],
): WeeklyPlanningRelationCycleV5 | null {
  if (relations.length === 0) return null;
  const taskIds = Array.from(new Set(relations.flatMap((relation) => [
    relation.fromTaskId,
    relation.toTaskId,
  ])));
  const outgoing = new Map<string, Set<string>>(
    taskIds.map((taskId) => [taskId, new Set<string>()]),
  );
  const indegree = new Map<string, number>(taskIds.map((taskId) => [taskId, 0]));

  for (const relation of relations) {
    const edge = precedenceEdge(relation);
    if (edge.before === edge.after) continue;
    const targets = outgoing.get(edge.before);
    if (!targets || targets.has(edge.after)) continue;
    targets.add(edge.after);
    indegree.set(edge.after, (indegree.get(edge.after) ?? 0) + 1);
  }

  const ready = taskIds.filter((taskId) => (indegree.get(taskId) ?? 0) === 0);
  const visited = new Set<string>();
  while (ready.length > 0) {
    const taskId = ready.shift()!;
    visited.add(taskId);
    for (const target of outgoing.get(taskId) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
  }
  if (visited.size === taskIds.length) return null;

  const cyclicTaskIds = taskIds.filter((taskId) => !visited.has(taskId)).sort();
  const cyclicTaskSet = new Set(cyclicTaskIds);
  const relationFactIds = relations
    .filter((relation) => {
      const edge = precedenceEdge(relation);
      return cyclicTaskSet.has(edge.before) && cyclicTaskSet.has(edge.after);
    })
    .map((relation) => relation.id)
    .sort();
  return {
    relationFactIds,
    taskIds: cyclicTaskIds,
  };
}
