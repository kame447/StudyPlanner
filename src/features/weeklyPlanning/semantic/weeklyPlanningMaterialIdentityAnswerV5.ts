import type { WeeklyPlanningFactGraphV5, WeeklyPlanningFactDiffEntryV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticCanonicalizationResultV5 } from './weeklyPlanningSemanticCanonicalizerV5';
import { isWeeklyPlanningFactActiveV5 } from './weeklyPlanningFactLifecycleV5';
import { applyWeeklyPlanningFactLifecycleOperationV5 } from './weeklyPlanningFactLifecycleEngineV5';

/** Validated identity answers bound to one unresolved, active material component. */
export function weeklyPlanningMaterialIdentityAnswersV5(graph: WeeklyPlanningFactGraphV5, document: WeeklyPlanningSemanticDocumentV5) {
  const answers: Array<{ targetId: string; localId: string; uncertaintyIds: string[] }> = [];
  for (const task of document.tasks) for (const component of task.study?.components ?? []) {
    const target = graph.components.find((fact) => fact.id === component.existingPublicId
      && fact.role === 'material' && fact.taskId === task.existingPublicId && isWeeklyPlanningFactActiveV5(graph, fact.id));
    if (!target || component.role !== 'material' || component.label.trim() === target.label.trim()) continue;
    const needs = graph.uncertainties.filter((need) => need.targetFactId === target.id
      && need.field === 'material_identity' && isWeeklyPlanningFactActiveV5(graph, need.id));
    if (!needs.length || document.uncertainties.some((need) => need.field === 'material_identity'
      && (need.targetLocalId === component.localId || need.targetLocalId === null))) continue;
    answers.push({ targetId: target.id, localId: component.localId, uncertaintyIds: needs.map((need) => need.id) });
  }
  return answers.filter((answer) => answers.filter((other) => other.targetId === answer.targetId).length === 1);
}

export function validateWeeklyPlanningMaterialIdentityAnswerV5(params: {
  graph?: WeeklyPlanningFactGraphV5; document: WeeklyPlanningSemanticDocumentV5;
}): string[] {
  if (!params.graph) return [];
  const answers = weeklyPlanningMaterialIdentityAnswersV5(params.graph, params.document);
  return params.document.corrections.flatMap((correction) => correction.operation === 'remove'
    && correction.target.kind === 'component' && answers.some((answer) => answer.targetId === correction.target.publicId)
    ? ['material-identity-answer:cannot-relabel-and-remove-same-component; emit the bound named material without remove, or use removal without relabeling if removal is intended'] : []);
}

/** Preserve dependent fact ids/content/source while replacing the identity version. */
export function applyWeeklyPlanningMaterialIdentityAnswersV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5; document: WeeklyPlanningSemanticDocumentV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5; operationKeyPrefix: string;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const base = params.canonicalization;
  if (base.status !== 'applied' || !base.diff) return base;
  let graph = base.graph;
  const superseded: WeeklyPlanningFactDiffEntryV5[] = [];
  const removed: WeeklyPlanningFactDiffEntryV5[] = [];
  const consumed = new Set<string>();
  const reject = (errors: string[]): WeeklyPlanningSemanticCanonicalizationResultV5 => ({ ...base,
    status: 'rejected', graph: params.originalGraph, diff: null, errors });
  for (const answer of weeklyPlanningMaterialIdentityAnswersV5(params.originalGraph, params.document)) {
    const replacementId = base.localToFactId[answer.localId];
    if (!replacementId || replacementId === answer.targetId
      || !base.diff.added.some((entry) => entry.id === replacementId && entry.kind === 'component')) return reject(['material-identity-answer:replacement-not-created']);
    const target = graph.components.find((fact) => fact.id === answer.targetId)!;
    const active = (id: string) => isWeeklyPlanningFactActiveV5(graph, id);
    const ref = (id: string | null) => id === answer.targetId ? replacementId : id;
    graph = { ...graph,
      components: graph.components.map((fact) => fact.id === replacementId
        ? { ...fact, taskId: target.taskId, parentComponentId: target.parentComponentId }
        : active(fact.id) ? { ...fact, parentComponentId: ref(fact.parentComponentId) } : fact),
      workloads: graph.workloads.map((fact) => active(fact.id) ? { ...fact, componentId: ref(fact.componentId) } : fact),
      effortEstimates: graph.effortEstimates.map((fact) => active(fact.id) ? { ...fact, targetFactId: ref(fact.targetFactId)! } : fact),
      temporalConstraints: graph.temporalConstraints.map((fact) => active(fact.id) ? { ...fact, targetFactId: ref(fact.targetFactId)! } : fact),
      taskDateRules: graph.taskDateRules.map((fact) => active(fact.id) ? { ...fact, targetFactId: ref(fact.targetFactId)! } : fact),
      recurrences: graph.recurrences.map((fact) => active(fact.id) ? { ...fact, targetFactId: ref(fact.targetFactId)! } : fact),
      relations: graph.relations.map((fact) => active(fact.id) ? { ...fact, fromTaskId: ref(fact.fromTaskId)!, toTaskId: ref(fact.toTaskId)! } : fact),
      uncertainties: graph.uncertainties.map((fact) => active(fact.id) && !answer.uncertaintyIds.includes(fact.id) ? { ...fact, targetFactId: ref(fact.targetFactId) } : fact),
    };
    for (const id of answer.uncertaintyIds) {
      if (!active(id)) continue;
      const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: graph.revision,
        operation: { kind: 'remove', targetFactId: id, operationKey: `${params.operationKeyPrefix}:material-identity:${id}` } });
      if (result.status === 'rejected') return reject(result.errors);
      graph = result.graph; removed.push(...result.removed);
    }
    const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: graph.revision,
      operation: { kind: 'supersede', targetFactId: answer.targetId, replacementFactId: replacementId, operationKey: `${params.operationKeyPrefix}:material-identity:${answer.targetId}` } });
    if (result.status === 'rejected') return reject(result.errors);
    graph = result.graph; superseded.push(...result.superseded);
    const correctionIds = graph.correctionIntents.filter((fact) => base.diff!.added.some((entry) => entry.id === fact.id)
      && fact.target.kind === 'component' && (fact.target.factId ?? fact.target.publicId) === answer.targetId
      && fact.operation !== 'remove' && fact.replacementFactId === replacementId).map((fact) => fact.id);
    for (const id of correctionIds) {
      const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: graph.revision,
        operation: { kind: 'remove', targetFactId: id, operationKey: `${params.operationKeyPrefix}:material-identity-consume:${id}` } });
      if (result.status === 'rejected') return reject(result.errors);
      graph = result.graph; removed.push(...result.removed); consumed.add(id);
    }
  }
  return { ...base, graph, diff: { ...base.diff, toRevision: graph.revision,
    added: base.diff.added.filter((entry) => !consumed.has(entry.id)), superseded: [...base.diff.superseded, ...superseded], removed: [...base.diff.removed, ...removed] } };
}
