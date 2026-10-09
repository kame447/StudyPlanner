import {
  applyWeeklyPlanningCorrectionTransactionV5,
} from './weeklyPlanningCorrectionTransactionV5';
import {
  applyWeeklyPlanningFactLifecycleOperationV5,
} from './weeklyPlanningFactLifecycleEngineV5';
import {
  activeWeeklyPlanningFactIdsV5,
  weeklyPlanningFactKindByIdV5,
} from './weeklyPlanningFactLifecycleV5';
import type {
  WeeklyPlanningFactDiffEntryV5,
  WeeklyPlanningFactGraphV5,
  WeeklyPlanningFactKindV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';

export const WEEKLY_PLANNING_CANONICAL_CORRECTION_APPLICATION_VERSION_V5 =
  'weekly-planning-canonical-correction-application-v5' as const;

export interface WeeklyPlanningCanonicalCorrectionApplicationResultV5 {
  version: typeof WEEKLY_PLANNING_CANONICAL_CORRECTION_APPLICATION_VERSION_V5;
  status: 'not_applicable' | 'applied' | 'rejected';
  graph: WeeklyPlanningFactGraphV5;
  added: WeeklyPlanningFactDiffEntryV5[];
  superseded: WeeklyPlanningFactDiffEntryV5[];
  removed: WeeklyPlanningFactDiffEntryV5[];
  errors: string[];
}

/** Replacement kinds the generic correction application substitutes. */
export const WEEKLY_PLANNING_BASE_CORRECTABLE_REPLACEMENT_KINDS_V5: ReadonlySet<WeeklyPlanningFactKindV5> = new Set<WeeklyPlanningFactKindV5>([
  'planning_window',
  'workload',
  'effort_estimate',
  'temporal_constraint',
  'recurrence',
]);

function reject(
  originalGraph: WeeklyPlanningFactGraphV5,
  errors: string[],
): WeeklyPlanningCanonicalCorrectionApplicationResultV5 {
  return {
    version: WEEKLY_PLANNING_CANONICAL_CORRECTION_APPLICATION_VERSION_V5,
    status: 'rejected',
    graph: originalGraph,
    added: [],
    superseded: [],
    removed: [],
    errors,
  };
}

function semanticReferenceKindToFactKind(
  kind: string,
): WeeklyPlanningFactKindV5 | null {
  switch (kind) {
    case 'planning_window':
    case 'task':
    case 'component':
    case 'workload':
    case 'effort_estimate':
    case 'temporal_constraint':
    case 'recurrence':
    case 'relation':
      return kind;
    default:
      return null;
  }
}

function resolveTargetFactId(params: {
  graph: WeeklyPlanningFactGraphV5;
  correctionIntentFactId: string;
}): { factId: string | null; error: string | null } {
  const correction = params.graph.correctionIntents.find(
    (fact) => fact.id === params.correctionIntentFactId,
  );
  if (!correction) {
    return {
      factId: null,
      error: `unknown-correction-intent:${params.correctionIntentFactId}`,
    };
  }

  const expectedKind = semanticReferenceKindToFactKind(correction.target.kind);
  if (!expectedKind) {
    return {
      factId: null,
      error: `unsupported-correction-target-kind:${correction.target.kind}`,
    };
  }
  const candidateId = correction.target.factId ?? correction.target.publicId;
  if (!candidateId) {
    return {
      factId: null,
      error: `unresolved-correction-target:${correction.id}`,
    };
  }

  const kindById = weeklyPlanningFactKindByIdV5(params.graph);
  if (kindById.get(candidateId) !== expectedKind) {
    return {
      factId: null,
      error: `correction-target-kind-mismatch:${correction.id}:${candidateId}`,
    };
  }
  const activeIds = activeWeeklyPlanningFactIdsV5(params.graph);
  if (activeIds && !activeIds.has(candidateId)) {
    return {
      factId: null,
      error: `correction-target-not-active:${correction.id}:${candidateId}`,
    };
  }
  return { factId: candidateId, error: null };
}

/**
 * A replacement fact's own target is a "support" stub that is pruned once the replacement is rebased onto the
 * corrected fact's target. A support fact that is itself the replacement of another correction of the same turn
 * is an explicitly corrected fact (e.g. the new workload of a total correction) and is never pruned.
 */
export function pruneableSupportFactIdsV5(params: {
  supportFactIds: Iterable<string>;
  correctionReplacementFactIds: Iterable<string | null>;
}): string[] {
  const kept = new Set<string>();
  for (const id of params.correctionReplacementFactIds) if (id) kept.add(id);
  return [...params.supportFactIds].filter((id) => !kept.has(id));
}

/**
 * Typed redundancy of a support fact with the surviving graph: only a workload that restates another active
 * workload of the same task/component carries no content of its own. Any other support fact (or a workload with
 * content absent from the graph) is user content that must not be deleted silently.
 */
export function isRedundantSupportFactV5(graph: WeeklyPlanningFactGraphV5, factId: string): boolean {
  const support = graph.workloads.find((fact) => fact.id === factId);
  if (!support) return false;
  const activeIds = activeWeeklyPlanningFactIdsV5(graph);
  return graph.workloads.some((other) =>
    other.id !== support.id
    && (!activeIds || activeIds.has(other.id))
    && other.taskId === support.taskId
    && other.componentId === support.componentId
    && other.quantityRole === support.quantityRole
    && other.amount === support.amount
    && other.unitCode === support.unitCode
    && other.perOccurrence === support.perOccurrence
    && other.periodExpression === support.periodExpression
    && other.rangeStart === support.rangeStart
    && other.rangeEnd === support.rangeEnd);
}

function activeFactFilter(graph: WeeklyPlanningFactGraphV5): (id: string) => boolean {
  const activeIds = activeWeeklyPlanningFactIdsV5(graph);
  return (id) => !activeIds || activeIds.has(id);
}

/**
 * A turn-created component duplicates the accepted one only when it equals a target component in its typed fields
 * and no active fact still hangs from it (its own workloads would be lost with it).
 */
export function isRedundantOrphanComponentV5(
  graph: WeeklyPlanningFactGraphV5,
  componentId: string,
  targetComponentIds: ReadonlySet<string | null>,
): boolean {
  const orphan = graph.components.find((fact) => fact.id === componentId);
  if (!orphan) return false;
  const isActive = activeFactFilter(graph);
  if (graph.workloads.some((fact) => isActive(fact.id) && fact.componentId === componentId)) return false;
  return [...targetComponentIds].some((targetId) => {
    const target = targetId ? graph.components.find((fact) => fact.id === targetId) : undefined;
    return Boolean(target) && target!.id !== orphan.id && target!.role === orphan.role && target!.label === orphan.label;
  });
}

/**
 * A turn-created task container is a pure holder (redundant) only when it has the target's category and study
 * context and no active fact still hangs from it: its title alone is incidental once the replaced fact lives on the
 * target task. Any remaining active child (component, workload, effort, temporal, recurrence) is user content.
 */
export function isRedundantOrphanTaskV5(
  graph: WeeklyPlanningFactGraphV5,
  taskId: string,
  targetTaskIds: ReadonlySet<string>,
  alsoPruned: ReadonlySet<string> = new Set(),
): boolean {
  const orphan = graph.tasks.find((fact) => fact.id === taskId);
  if (!orphan) return false;
  const isActive = activeFactFilter(graph);
  const hangsFromOrphan = (fact: { id: string; taskId: string }) =>
    fact.taskId === taskId && isActive(fact.id) && !alsoPruned.has(fact.id);
  if (graph.components.some(hangsFromOrphan) || graph.workloads.some(hangsFromOrphan)
    || graph.effortEstimates.some(hangsFromOrphan) || graph.temporalConstraints.some(hangsFromOrphan)
    || graph.recurrences.some(hangsFromOrphan)) return false;
  const context = (id: string) => graph.studyContexts.find((fact) => fact.taskId === id);
  return [...targetTaskIds].some((targetId) => {
    const target = graph.tasks.find((fact) => fact.id === targetId);
    if (!target || target.id === orphan.id || target.category !== orphan.category) return false;
    const left = context(orphan.id);
    const right = context(target.id);
    return !left || !right || (left.purpose === right.purpose && left.contextLabel === right.contextLabel);
  });
}

interface RebaseResult {
  graph: WeeklyPlanningFactGraphV5;
  orphanTaskIds: Set<string>;
  orphanComponentIds: Set<string>;
  supportFactIds: Set<string>;
  errors: string[];
}

/** Which accepted container each turn-created container was meant to duplicate (for the typed redundancy check). */
interface OrphanTargets {
  tasks: Map<string, Set<string>>;
  components: Map<string, Set<string | null>>;
}

function registerOrphanTask(params: {
  orphanTargets: OrphanTargets;
  replacementTaskId: string;
  targetTaskId: string;
  addedIds: ReadonlySet<string>;
  orphanTaskIds: Set<string>;
  correctionId: string;
}): string | null {
  if (params.replacementTaskId === params.targetTaskId) return null;
  if (!params.addedIds.has(params.replacementTaskId)) {
    return `replacement-container-not-created-in-turn:${params.correctionId}:${params.replacementTaskId}`;
  }
  params.orphanTaskIds.add(params.replacementTaskId);
  const targets = params.orphanTargets.tasks.get(params.replacementTaskId) ?? new Set<string>();
  targets.add(params.targetTaskId);
  params.orphanTargets.tasks.set(params.replacementTaskId, targets);
  return null;
}

function rebaseReplacement(params: {
  orphanTargets: OrphanTargets;
  graph: WeeklyPlanningFactGraphV5;
  correctionIntentFactId: string;
  targetFactId: string;
  addedIds: ReadonlySet<string>;
}): RebaseResult {
  const correction = params.graph.correctionIntents.find(
    (fact) => fact.id === params.correctionIntentFactId,
  );
  if (!correction || correction.operation === 'remove') {
    return {
      graph: params.graph,
      orphanTaskIds: new Set(),
      orphanComponentIds: new Set(),
      supportFactIds: new Set(),
      errors: [],
    };
  }
  if (!correction.replacementFactId) {
    return {
      graph: params.graph,
      orphanTaskIds: new Set(),
      orphanComponentIds: new Set(),
      supportFactIds: new Set(),
      errors: [`correction-replacement-not-resolved:${correction.id}`],
    };
  }
  if (!params.addedIds.has(correction.replacementFactId)) {
    return {
      graph: params.graph,
      orphanTaskIds: new Set(),
      orphanComponentIds: new Set(),
      supportFactIds: new Set(),
      errors: [`correction-replacement-not-created-in-turn:${correction.id}`],
    };
  }

  const kindById = weeklyPlanningFactKindByIdV5(params.graph);
  const targetKind = kindById.get(params.targetFactId);
  const replacementKind = kindById.get(correction.replacementFactId);
  if (!targetKind || targetKind !== replacementKind) {
    return {
      graph: params.graph,
      orphanTaskIds: new Set(),
      orphanComponentIds: new Set(),
      supportFactIds: new Set(),
      errors: [
        `correction-replacement-kind-mismatch:${correction.id}:${targetKind ?? 'unknown'}:${replacementKind ?? 'unknown'}`,
      ],
    };
  }
  if (!WEEKLY_PLANNING_BASE_CORRECTABLE_REPLACEMENT_KINDS_V5.has(targetKind)) {
    return {
      graph: params.graph,
      orphanTaskIds: new Set(),
      orphanComponentIds: new Set(),
      supportFactIds: new Set(),
      errors: [`unsupported-correction-replacement-kind:${correction.id}:${targetKind}`],
    };
  }

  const orphanTaskIds = new Set<string>();
  const orphanComponentIds = new Set<string>();
  const supportFactIds = new Set<string>();
  const errors: string[] = [];
  let graph = params.graph;

  if (targetKind === 'workload') {
    const target = graph.workloads.find((fact) => fact.id === params.targetFactId);
    const replacement = graph.workloads.find(
      (fact) => fact.id === correction.replacementFactId,
    );
    if (!target || !replacement) {
      return {
        graph,
        orphanTaskIds,
        orphanComponentIds,
        supportFactIds,
        errors: [`missing-workload-correction-fact:${correction.id}`],
      };
    }
    const orphanError = registerOrphanTask({
      orphanTargets: params.orphanTargets,
      replacementTaskId: replacement.taskId,
      targetTaskId: target.taskId,
      addedIds: params.addedIds,
      orphanTaskIds,
      correctionId: correction.id,
    });
    if (orphanError) errors.push(orphanError);
    if (
      replacement.componentId
      && replacement.componentId !== target.componentId
    ) {
      if (!params.addedIds.has(replacement.componentId)) {
        errors.push(
          `replacement-component-not-created-in-turn:${correction.id}:${replacement.componentId}`,
        );
      } else {
        orphanComponentIds.add(replacement.componentId);
        const targets = params.orphanTargets.components.get(replacement.componentId) ?? new Set<string | null>();
        targets.add(target.componentId);
        params.orphanTargets.components.set(replacement.componentId, targets);
      }
    }
    graph = {
      ...graph,
      workloads: graph.workloads.map((fact) =>
        fact.id === replacement.id
          ? { ...fact, taskId: target.taskId, componentId: target.componentId }
          : fact),
    };
  } else if (targetKind === 'effort_estimate') {
    const target = graph.effortEstimates.find((fact) => fact.id === params.targetFactId);
    const replacement = graph.effortEstimates.find(
      (fact) => fact.id === correction.replacementFactId,
    );
    if (!target || !replacement) {
      return {
        graph,
        orphanTaskIds,
        orphanComponentIds,
        supportFactIds,
        errors: [`missing-effort-correction-fact:${correction.id}`],
      };
    }
    const orphanError = registerOrphanTask({
      orphanTargets: params.orphanTargets,
      replacementTaskId: replacement.taskId,
      targetTaskId: target.taskId,
      addedIds: params.addedIds,
      orphanTaskIds,
      correctionId: correction.id,
    });
    if (orphanError) errors.push(orphanError);
    if (replacement.targetFactId !== target.targetFactId) {
      if (!params.addedIds.has(replacement.targetFactId)) {
        errors.push(
          `replacement-support-not-created-in-turn:${correction.id}:${replacement.targetFactId}`,
        );
      } else {
        supportFactIds.add(replacement.targetFactId);
      }
    }
    graph = {
      ...graph,
      effortEstimates: graph.effortEstimates.map((fact) =>
        fact.id === replacement.id
          ? { ...fact, taskId: target.taskId, targetFactId: target.targetFactId }
          : fact),
    };
  } else if (targetKind === 'temporal_constraint') {
    const target = graph.temporalConstraints.find((fact) => fact.id === params.targetFactId);
    const replacement = graph.temporalConstraints.find(
      (fact) => fact.id === correction.replacementFactId,
    );
    if (!target || !replacement) {
      return {
        graph,
        orphanTaskIds,
        orphanComponentIds,
        supportFactIds,
        errors: [`missing-temporal-correction-fact:${correction.id}`],
      };
    }
    const orphanError = registerOrphanTask({
      orphanTargets: params.orphanTargets,
      replacementTaskId: replacement.taskId,
      targetTaskId: target.taskId,
      addedIds: params.addedIds,
      orphanTaskIds,
      correctionId: correction.id,
    });
    if (orphanError) errors.push(orphanError);
    if (replacement.targetFactId !== target.targetFactId) {
      if (!params.addedIds.has(replacement.targetFactId)) {
        errors.push(
          `replacement-support-not-created-in-turn:${correction.id}:${replacement.targetFactId}`,
        );
      } else {
        supportFactIds.add(replacement.targetFactId);
      }
    }
    graph = {
      ...graph,
      temporalConstraints: graph.temporalConstraints.map((fact) =>
        fact.id === replacement.id
          ? { ...fact, taskId: target.taskId, targetFactId: target.targetFactId }
          : fact),
    };
  } else if (targetKind === 'recurrence') {
    const target = graph.recurrences.find((fact) => fact.id === params.targetFactId);
    const replacement = graph.recurrences.find(
      (fact) => fact.id === correction.replacementFactId,
    );
    if (!target || !replacement) {
      return {
        graph,
        orphanTaskIds,
        orphanComponentIds,
        supportFactIds,
        errors: [`missing-recurrence-correction-fact:${correction.id}`],
      };
    }
    const orphanError = registerOrphanTask({
      orphanTargets: params.orphanTargets,
      replacementTaskId: replacement.taskId,
      targetTaskId: target.taskId,
      addedIds: params.addedIds,
      orphanTaskIds,
      correctionId: correction.id,
    });
    if (orphanError) errors.push(orphanError);
    if (replacement.targetFactId !== target.targetFactId) {
      if (!params.addedIds.has(replacement.targetFactId)) {
        errors.push(
          `replacement-support-not-created-in-turn:${correction.id}:${replacement.targetFactId}`,
        );
      } else {
        supportFactIds.add(replacement.targetFactId);
      }
    }
    graph = {
      ...graph,
      recurrences: graph.recurrences.map((fact) =>
        fact.id === replacement.id
          ? { ...fact, taskId: target.taskId, targetFactId: target.targetFactId }
          : fact),
    };
  }

  return { graph, orphanTaskIds, orphanComponentIds, supportFactIds, errors };
}

function resolveCorrectionTargetInGraph(params: {
  graph: WeeklyPlanningFactGraphV5;
  correctionIntentFactId: string;
  targetFactId: string;
}): WeeklyPlanningFactGraphV5 {
  return {
    ...params.graph,
    correctionIntents: params.graph.correctionIntents.map((fact) =>
      fact.id === params.correctionIntentFactId
        ? { ...fact, target: { ...fact.target, factId: params.targetFactId } }
        : fact),
  };
}

function removeFact(params: {
  graph: WeeklyPlanningFactGraphV5;
  factId: string;
  operationKey: string;
}): {
  graph: WeeklyPlanningFactGraphV5;
  removed: WeeklyPlanningFactDiffEntryV5[];
  error: string | null;
} {
  const result = applyWeeklyPlanningFactLifecycleOperationV5({
    graph: params.graph,
    expectedRevision: params.graph.revision,
    operation: {
      operationKey: params.operationKey,
      kind: 'remove',
      targetFactId: params.factId,
    },
  });
  if (result.status === 'rejected') {
    return { graph: params.graph, removed: [], error: result.errors.join('|') };
  }
  return { graph: result.graph, removed: result.removed, error: null };
}

export function applyWeeklyPlanningCanonicalCorrectionsV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  operationKeyPrefix: string;
}): WeeklyPlanningCanonicalCorrectionApplicationResultV5 {
  if (params.canonicalization.status !== 'applied' || !params.canonicalization.diff) {
    return {
      version: WEEKLY_PLANNING_CANONICAL_CORRECTION_APPLICATION_VERSION_V5,
      status: 'not_applicable',
      graph: params.canonicalization.graph,
      added: [],
      superseded: [],
      removed: [],
      errors: [],
    };
  }

  const correctionIds = params.canonicalization.diff.added
    .filter((entry) => entry.kind === 'correction_intent')
    .map((entry) => entry.id);
  if (correctionIds.length === 0) {
    return {
      version: WEEKLY_PLANNING_CANONICAL_CORRECTION_APPLICATION_VERSION_V5,
      status: 'not_applicable',
      graph: params.canonicalization.graph,
      added: [],
      superseded: [],
      removed: [],
      errors: [],
    };
  }

  const addedIds = new Set(params.canonicalization.diff.added.map((entry) => entry.id));
  const orphanTaskIds = new Set<string>();
  const orphanComponentIds = new Set<string>();
  const supportFactIds = new Set<string>();
  const orphanTargets: OrphanTargets = { tasks: new Map(), components: new Map() };
  let graph = params.canonicalization.graph;

  for (const correctionId of correctionIds) {
    const resolved = resolveTargetFactId({ graph, correctionIntentFactId: correctionId });
    if (!resolved.factId || resolved.error) {
      return reject(params.originalGraph, [resolved.error ?? `unresolved-correction:${correctionId}`]);
    }
    graph = resolveCorrectionTargetInGraph({
      graph,
      correctionIntentFactId: correctionId,
      targetFactId: resolved.factId,
    });
    const rebased = rebaseReplacement({
      orphanTargets,
      graph,
      correctionIntentFactId: correctionId,
      targetFactId: resolved.factId,
      addedIds,
    });
    if (rebased.errors.length > 0) return reject(params.originalGraph, rebased.errors);
    graph = rebased.graph;
    rebased.orphanTaskIds.forEach((id) => orphanTaskIds.add(id));
    rebased.orphanComponentIds.forEach((id) => orphanComponentIds.add(id));
    rebased.supportFactIds.forEach((id) => supportFactIds.add(id));
  }

  const added: WeeklyPlanningFactDiffEntryV5[] = [];
  const superseded: WeeklyPlanningFactDiffEntryV5[] = [];
  const removed: WeeklyPlanningFactDiffEntryV5[] = [];
  for (const correctionId of correctionIds) {
    const result = applyWeeklyPlanningCorrectionTransactionV5({
      graph,
      expectedRevision: graph.revision,
      correctionIntentFactId: correctionId,
      operationKey: `${params.operationKeyPrefix}:correction:${correctionId}`,
    });
    if (result.status === 'rejected') return reject(params.originalGraph, result.errors);
    graph = result.graph;
    added.push(...result.added);
    superseded.push(...result.superseded);
    removed.push(...result.removed);
  }

  const pruneIds: string[] = [];
  const pruneableSupport = pruneableSupportFactIdsV5({
    supportFactIds,
    correctionReplacementFactIds: graph.correctionIntents
      .filter((fact) => correctionIds.includes(fact.id))
      .map((fact) => fact.replacementFactId),
  });
  const contentBearing = [
    ...pruneableSupport.filter((id) => !isRedundantSupportFactV5(graph, id))
      .map((id) => `correction-application:replacement-support-not-installed:${id}`),
    ...[...orphanComponentIds]
      .filter((id) => !isRedundantOrphanComponentV5(graph, id, orphanTargets.components.get(id) ?? new Set()))
      .map((id) => `correction-application:replacement-container-not-installed:${id}`),
    ...[...orphanTaskIds]
      .filter((id) => !isRedundantOrphanTaskV5(graph, id, orphanTargets.tasks.get(id) ?? new Set(), new Set([...orphanComponentIds, ...pruneableSupport])))
      .map((id) => `correction-application:replacement-container-not-installed:${id}`),
  ];
  if (contentBearing.length > 0) {
    // Never delete turn-created content that no correction installs: fail visibly (disclosed recover).
    return reject(params.originalGraph, contentBearing);
  }
  pruneableSupport.forEach((id) => pruneIds.push(id));
  [...orphanComponentIds]
    .sort((left, right) => {
      const leftDepth = graph.components.find((item) => item.id === left)?.parentComponentId ? 1 : 0;
      const rightDepth = graph.components.find((item) => item.id === right)?.parentComponentId ? 1 : 0;
      return rightDepth - leftDepth;
    })
    .forEach((id) => pruneIds.push(id));
  for (const taskId of orphanTaskIds) {
    graph.studyContexts
      .filter((fact) => fact.taskId === taskId && addedIds.has(fact.id))
      .forEach((fact) => pruneIds.push(fact.id));
    pruneIds.push(taskId);
  }

  for (const factId of [...new Set(pruneIds)]) {
    const lifecycle = graph.factLifecycles.find((entry) => entry.factId === factId);
    if (!lifecycle || lifecycle.status !== 'active') continue;
    const result = removeFact({
      graph,
      factId,
      operationKey: `${params.operationKeyPrefix}:prune:${factId}`,
    });
    if (result.error) return reject(params.originalGraph, [result.error]);
    graph = result.graph;
    removed.push(...result.removed);
  }

  return {
    version: WEEKLY_PLANNING_CANONICAL_CORRECTION_APPLICATION_VERSION_V5,
    status: 'applied',
    graph,
    added,
    superseded,
    removed,
    errors: [],
  };
}
