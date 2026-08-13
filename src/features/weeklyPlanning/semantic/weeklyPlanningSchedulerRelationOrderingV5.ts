import type { TaskRelationFact } from './weeklyPlanningFactGraph';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';

function relationEdge(
  relation: TaskRelationFact,
): { before: string; after: string } | null {
  switch (relation.kind) {
    case 'before':
    case 'sequence':
    case 'priority_over':
      return { before: relation.fromTaskId, after: relation.toTaskId };
    case 'after':
    case 'depends_on':
      return { before: relation.toTaskId, after: relation.fromTaskId };
    default:
      return null;
  }
}

export function orderGenericSchedulerWorkItemsByRelationsV5(params: {
  items: readonly GenericPlanningWorkItem[];
  relations: readonly TaskRelationFact[];
}): GenericPlanningWorkItem[] {
  if (params.items.length <= 1 || params.relations.length === 0) return [...params.items];

  const firstTaskIndex = new Map<string, number>();
  params.items.forEach((item, index) => {
    if (!firstTaskIndex.has(item.taskId)) firstTaskIndex.set(item.taskId, index);
  });

  const taskIds = [...firstTaskIndex.keys()];
  const taskSet = new Set(taskIds);
  const outgoing = new Map<string, Set<string>>(taskIds.map((taskId) => [taskId, new Set()]));
  const indegree = new Map<string, number>(taskIds.map((taskId) => [taskId, 0]));

  params.relations.forEach((relation) => {
    const edge = relationEdge(relation);
    if (!edge || !taskSet.has(edge.before) || !taskSet.has(edge.after) || edge.before === edge.after) {
      return;
    }
    const targets = outgoing.get(edge.before)!;
    if (targets.has(edge.after)) return;
    targets.add(edge.after);
    indegree.set(edge.after, (indegree.get(edge.after) ?? 0) + 1);
  });

  const ready = taskIds
    .filter((taskId) => (indegree.get(taskId) ?? 0) === 0)
    .sort((left, right) => (firstTaskIndex.get(left) ?? 0) - (firstTaskIndex.get(right) ?? 0));
  const orderedTaskIds: string[] = [];

  while (ready.length > 0) {
    const taskId = ready.shift()!;
    orderedTaskIds.push(taskId);
    for (const target of outgoing.get(taskId) ?? []) {
      const nextIndegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(target);
        ready.sort((left, right) =>
          (firstTaskIndex.get(left) ?? 0) - (firstTaskIndex.get(right) ?? 0));
      }
    }
  }

  if (orderedTaskIds.length !== taskIds.length) return [...params.items];

  const taskRank = new Map(orderedTaskIds.map((taskId, index) => [taskId, index]));
  return params.items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rankDelta = (taskRank.get(left.item.taskId) ?? Number.MAX_SAFE_INTEGER)
        - (taskRank.get(right.item.taskId) ?? Number.MAX_SAFE_INTEGER);
      return rankDelta !== 0 ? rankDelta : left.index - right.index;
    })
    .map(({ item }) => item);
}
