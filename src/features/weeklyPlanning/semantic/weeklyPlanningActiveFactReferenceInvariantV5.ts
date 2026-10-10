import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

/** Operational references only. Correction/decision targets are operation evidence:
 * they intentionally keep the original target when that operation retires it. */
export function weeklyPlanningActiveFactReferencesV5(graph: WeeklyPlanningFactGraphV5) {
  const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  const references: Array<{ factId: string; targetFactId: string; path: string }> = [];
  const collect = (collection: string, facts: readonly { id: string }[], keys: readonly string[]) => {
    facts.forEach((fact, index) => {
      if (!active.has(fact.id)) return;
      for (const key of keys) {
        const target = (fact as unknown as Record<string, unknown>)[key];
        if (typeof target === 'string') references.push({ factId: fact.id, targetFactId: target, path: `graph.${collection}[${index}].${key}` });
      }
    });
  };
  collect('studyContexts', graph.studyContexts, ['taskId']);
  collect('components', graph.components, ['taskId', 'parentComponentId']);
  collect('workloads', graph.workloads, ['taskId', 'componentId']);
  collect('effortEstimates', graph.effortEstimates, ['taskId', 'targetFactId']);
  collect('temporalConstraints', graph.temporalConstraints, ['taskId', 'targetFactId']);
  collect('taskDateRules', graph.taskDateRules, ['taskId', 'targetFactId']);
  collect('recurrences', graph.recurrences, ['taskId', 'targetFactId']);
  collect('relations', graph.relations, ['fromTaskId', 'toTaskId']);
  collect('uncertainties', graph.uncertainties, ['targetFactId']);
  return references;
}

/** Stable source-property identity: collection indexes are presentation paths,
 * not reference identity, and may shift during otherwise unrelated binding. */
function referenceIdentity(ref: ReturnType<typeof weeklyPlanningActiveFactReferencesV5>[number]): string {
  return JSON.stringify([ref.factId, ref.targetFactId, ref.path.slice(ref.path.lastIndexOf('.') + 1)]);
}

export function weeklyPlanningIntroducedActiveFactReferenceErrorsV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  graph: WeeklyPlanningFactGraphV5;
}): string[] {
  const inactiveReferences = (graph: WeeklyPlanningFactGraphV5) => {
    const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    return weeklyPlanningActiveFactReferencesV5(graph).filter(ref => !active.has(ref.targetFactId));
  };
  const previous = new Set(inactiveReferences(params.originalGraph).map(referenceIdentity));
  return inactiveReferences(params.graph).filter(ref => !previous.has(referenceIdentity(ref)))
    .map(ref => `${ref.path}:target-not-active:${ref.targetFactId}`);
}
