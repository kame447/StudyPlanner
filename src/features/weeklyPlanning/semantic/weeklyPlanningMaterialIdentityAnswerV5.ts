import type { WeeklyPlanningFactGraphV5, WeeklyPlanningFactDiffEntryV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticCanonicalizationResultV5 } from './weeklyPlanningSemanticCanonicalizerV5';
import { isWeeklyPlanningFactActiveV5 } from './weeklyPlanningFactLifecycleV5';
import { applyWeeklyPlanningFactLifecycleOperationV5 } from './weeklyPlanningFactLifecycleEngineV5';
import { weeklyPlanningEvidenceChannelForSourceTextV5 } from './weeklyPlanningCurrentTurnProvenanceV5';
import { isUserUtteranceSourcedV5 } from './weeklyPlanningFactGraphV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';

// Every graph collection is classified, including task-only edges and history.
// A new collection must explicitly declare whether it can reference a component.
export const WEEKLY_PLANNING_COMPONENT_REFERENCE_FIELDS_V5 = {
  version: [], revision: [], appliedTurnKeys: [], appliedLifecycleOperationKeys: [], factLifecycles: [],
  planningWindows: [], tasks: [], studyContexts: [],
  components: ['parentComponentId'], workloads: ['componentId'],
  effortEstimates: ['targetFactId'], temporalConstraints: ['targetFactId'], taskDateRules: [],
  recurrences: ['targetFactId'], relations: [], uncertainties: ['targetFactId'],
  correctionIntents: ['target.publicId', 'target.factId', 'replacementFactId'],
  decisionIntents: ['target.publicId', 'target.factId'], availabilityDeclarations: [], constraintSourceRequests: [],
} satisfies Record<keyof WeeklyPlanningFactGraphV5, readonly string[]>;

/** Formal modify is the only authority for an identity version. Bare relabels,
 * bookshelf names and open questions never supply correction permission. */
export function weeklyPlanningMaterialIdentityAnswersV5(graph: WeeklyPlanningFactGraphV5, document: WeeklyPlanningSemanticDocumentV5) {
  const answers: Array<{ targetId: string; localId: string; correctionLocalId: string; uncertaintyIds: string[] }> = [];
  const components = document.tasks.flatMap((task) => task.study?.components ?? []);
  for (const task of document.tasks) for (const component of task.study?.components ?? []) {
    const parentTask = graph.tasks.find((fact) => fact.id === task.existingPublicId
      && isWeeklyPlanningFactActiveV5(graph, fact.id));
    const target = graph.components.find((fact) => fact.id === component.existingPublicId
      && fact.role === 'material' && fact.taskId === parentTask?.id && isWeeklyPlanningFactActiveV5(graph, fact.id));
    if (!parentTask || !target || component.role !== 'material' || component.label.trim() === target.label.trim()) continue;
    if (document.tasks.filter((candidate) => candidate.existingPublicId === parentTask.id).length !== 1
      || components.filter((candidate) => candidate.existingPublicId === target.id).length !== 1) continue;
    // A nested identity must retain its exact accepted active parent. Neither a
    // new parent nor omission of the existing parent grants reparenting authority.
    const parent = component.parentLocalId === null ? null
      : task.study?.components.find((candidate) => candidate.localId === component.parentLocalId);
    if ((parent?.existingPublicId ?? null) !== target.parentComponentId
      || (target.parentComponentId !== null && !graph.components.some((fact) =>
        fact.id === target.parentComponentId && fact.taskId === parentTask.id && isWeeklyPlanningFactActiveV5(graph, fact.id)))) continue;
    const corrections = document.corrections.filter((correction) =>
      correction.target.publicId === target.id || correction.target.localId === component.localId
      || correction.replacementLocalId === component.localId);
    if (corrections.length !== 1) continue;
    const correction = corrections[0];
    if (correction.operation !== 'modify' || correction.target.kind !== 'component'
      || correction.target.publicId !== target.id || correction.target.localId !== null
      || correction.replacementLocalId !== component.localId) continue;
    const aboutThisMaterial = (need: WeeklyPlanningSemanticDocumentV5['uncertainties'][number]) =>
      [component.localId, task.localId, 'document', null].includes(need.targetLocalId);
    if (document.uncertainties.some((need) => need.field === 'material_identity' && aboutThisMaterial(need))) continue;
    const needs = graph.uncertainties.filter((need) => need.targetFactId === target.id
      && need.field === 'material_identity' && isWeeklyPlanningFactActiveV5(graph, need.id));
    answers.push({ targetId: target.id, localId: component.localId, correctionLocalId: correction.localId,
      uncertaintyIds: needs.map((need) => need.id) });
  }
  return answers;
}

/** Report unsupported component mutation in the existing validation/repair pass.
 * Current-turn evidence remains owned by the normal provenance validator; this
 * narrower identity transaction also forbids a supplemental-only replacement. */
export function validateWeeklyPlanningMaterialIdentityAnswerV5(params: {
  graph?: WeeklyPlanningFactGraphV5; document: WeeklyPlanningSemanticDocumentV5;
  currentUserText?: string; supplementalContext?: string;
}): string[] {
  if (!params.graph) return [];
  const answers = weeklyPlanningMaterialIdentityAnswersV5(params.graph, params.document);
  return params.document.corrections.flatMap((correction, index) => {
    if (correction.target.kind !== 'component' || correction.operation === 'remove') return [];
    const answer = answers.find((candidate) => candidate.correctionLocalId === correction.localId);
    if (!answer) return [`document.corrections[${index}]:unsupported-material-identity-correction`];
    const component = params.document.tasks.flatMap((task) => task.study?.components ?? [])
      .find((candidate) => candidate.localId === answer.localId)!;
    return weeklyPlanningEvidenceChannelForSourceTextV5(component.sourceText,
      params.currentUserText ?? '', params.supplementalContext) === 'user' ? []
      : [`document.corrections[${index}]:material-identity-requires-current-user-source`];
  });
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
  const answers = weeklyPlanningMaterialIdentityAnswersV5(params.originalGraph, params.document);
  for (const answer of answers) {
    const replacementId = base.localToFactId[answer.localId];
    if (!replacementId || replacementId === answer.targetId
      || !base.diff.added.some((entry) => entry.id === replacementId && entry.kind === 'component')) return reject(['material-identity-answer:replacement-not-created']);
    const replacement = graph.components.find((fact) => fact.id === replacementId);
    const correctionId = base.localToFactId[answer.correctionLocalId];
    const correction = graph.correctionIntents.find((fact) => fact.id === correctionId);
    if (!replacement || !correction || !isUserUtteranceSourcedV5(replacement.source)
      || !isUserUtteranceSourcedV5(correction.source)
      || replacement.source.conversationId !== correction.source.conversationId
      || replacement.source.turnId !== correction.source.turnId
      || replacement.createdRevision <= params.originalGraph.revision
      || correction.createdRevision !== replacement.createdRevision
      || !base.diff.added.some((entry) => entry.id === correctionId && entry.kind === 'correction_intent')
      || correction.operation !== 'modify' || correction.target.kind !== 'component'
      || correction.target.publicId !== answer.targetId || correction.target.factId !== null
      || correction.replacementFactId !== replacementId
      || !isWeeklyPlanningFactActiveV5(graph, correctionId)) return reject(['material-identity-answer:invalid-current-turn-correction']);
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
      recurrences: graph.recurrences.map((fact) => active(fact.id) ? { ...fact, targetFactId: ref(fact.targetFactId)! } : fact),
      uncertainties: graph.uncertainties.map((fact) => active(fact.id) && !answer.uncertaintyIds.includes(fact.id) ? { ...fact, targetFactId: ref(fact.targetFactId) } : fact),
      correctionIntents: graph.correctionIntents.map((fact) => active(fact.id) && !base.diff!.added.some((entry) => entry.id === fact.id)
        ? { ...fact, target: { ...fact.target, publicId: ref(fact.target.publicId), factId: ref(fact.target.factId) }, replacementFactId: ref(fact.replacementFactId) }
        : fact),
      decisionIntents: graph.decisionIntents.map((fact) => active(fact.id)
        ? { ...fact, target: { ...fact.target, publicId: ref(fact.target.publicId), factId: ref(fact.target.factId) } } : fact),
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
    for (const id of [correctionId]) {
      const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: graph.revision,
        operation: { kind: 'remove', targetFactId: id, operationKey: `${params.operationKeyPrefix}:material-identity-consume:${id}` } });
      if (result.status === 'rejected') return reject(result.errors);
      graph = result.graph; removed.push(...result.removed); consumed.add(id);
    }
  }
  if (answers.length > 0) {
    const validation = validateWeeklyPlanningFactGraphValueV5(graph);
    if (validation.errors.length > 0) return reject(validation.errors.map((error) => `material-identity-answer:${error}`));
  }
  return { ...base, graph, diff: { ...base.diff, toRevision: graph.revision,
    added: base.diff.added.filter((entry) => !consumed.has(entry.id)), superseded: [...base.diff.superseded, ...superseded], removed: [...base.diff.removed, ...removed] } };
}
