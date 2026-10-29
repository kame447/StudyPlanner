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

const CORRECTABLE_REPLACEMENT_KINDS = new Set<WeeklyPlanningFactKindV5>([
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
 * is an explicitly corrected fact (e.g. the new workload of a remaining correction) and is never pruned.
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
    && (support.unitCode !== 'custom' || other.unitLabel === support.unitLabel)
    && other.perOccurrence === support.perOccurrence
    && other.periodExpression === support.periodExpression
    && other.rangeStart === support.rangeStart
    && other.rangeEnd === support.rangeEnd);
}

interface RebaseResult {
  graph: WeeklyPlanningFactGraphV5;
  orphanTaskIds: Set<string>;
  orphanComponentIds: Set<string>;
  supportFactIds: Set<string>;
  errors: string[];
}

function registerOrphanTask(params: {
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
  return null;
}

function rebaseReplacement(params: {
  applicableCorrectionIds: ReadonlySet<string>;
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
  if (!CORRECTABLE_REPLACEMENT_KINDS.has(targetKind)) {
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
    const rateTotalReplacement = (target.kind === 'duration_per_unit' && replacement.kind === 'total_duration')
      || (target.kind === 'total_duration' && replacement.kind === 'duration_per_unit');
    if (rateTotalReplacement) {
      // A measurement change cannot borrow the legacy replacement-support
      // rebinding below to silently widen a component or change the target.
      if (replacement.targetFactId !== target.targetFactId) errors.push(`effort-correction-target-mismatch:${correction.id}`);
      const active = activeWeeklyPlanningFactIdsV5(graph);
      const workloads = graph.workloads.filter(workload => (active === null || active.has(workload.id)) && workload.taskId === target.taskId
        && [workload.id, workload.taskId, workload.componentId].includes(target.targetFactId));
      if (replacement.kind === 'total_duration' ? replacement.unitCode !== null && replacement.unitCode !== 'minute'
        : workloads.length === 0 || workloads.some(workload => workload.unitCode !== replacement.unitCode)) {
        errors.push(`effort-correction-unit-mismatch:${correction.id}`);
      }
      if (errors.length) return { graph, orphanTaskIds, orphanComponentIds, supportFactIds, errors };
    }
    const orphanError = registerOrphanTask({
      replacementTaskId: replacement.taskId,
      targetTaskId: target.taskId,
      addedIds: params.addedIds,
      orphanTaskIds,
      correctionId: correction.id,
    });
    if (orphanError) errors.push(orphanError);
    // The replacement effort hangs from the workload that ANOTHER correction of this turn installs in place of the
    // replaced effort's own workload (「残り8枚で全部60分」: remaining 10→8 and its total 80→60). It already targets
    // the right fact; rebasing it onto the replaced workload would hang it from a superseded one.
    const hangsFromReplacementOfTargetWorkload = replacement.targetFactId !== target.targetFactId
      && graph.correctionIntents.some((other) => params.applicableCorrectionIds.has(other.id)
        && other.id !== correction.id && other.operation !== 'remove' && other.target.kind === 'workload'
        && other.replacementFactId === replacement.targetFactId
        && (other.target.factId ?? other.target.publicId) === target.targetFactId);
    if (replacement.targetFactId !== target.targetFactId && !hangsFromReplacementOfTargetWorkload) {
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
          ? {
              ...fact,
              taskId: target.taskId,
              ...(hangsFromReplacementOfTargetWorkload ? {} : { targetFactId: target.targetFactId }),
            }
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

  const applicableCorrectionIds = new Set(correctionIds);
  const addedIds = new Set(params.canonicalization.diff.added.map((entry) => entry.id));
  const orphanTaskIds = new Set<string>();
  const orphanComponentIds = new Set<string>();
  const supportFactIds = new Set<string>();
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
      applicableCorrectionIds,
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
  // Efforts that an earlier workload correction of THIS transaction migrated (-> the fact they migrated to) or
  // invalidated (-> the workload that replaced theirs). Earlier turns never appear here.
  const migrated = new Map<string, string>();
  const invalidatedWorkloadTargets = new Map<string, string>();
  for (const correctionId of correctionIds) {
    const intent = graph.correctionIntents.find((fact) => fact.id === correctionId);
    const intentTargetId = intent?.target.factId ?? null;
    const retargetTo = intentTargetId ? migrated.get(intentTargetId) : undefined;
    const invalidatedWorkloadId = intentTargetId ? invalidatedWorkloadTargets.get(intentTargetId) : undefined;
    const activeIds = activeWeeklyPlanningFactIdsV5(graph);
    const alreadyInstalled = Boolean(retargetTo && intent!.operation !== 'remove'
      && intent!.replacementFactId === retargetTo && activeIds?.has(retargetTo));
    const explicitReplacement = graph.effortEstimates.find((fact) => fact.id === intent?.replacementFactId);
    const alreadyInvalidated = Boolean(invalidatedWorkloadId && intent?.target.kind === 'effort_estimate'
      && (intent.operation === 'remove' || (explicitReplacement
        && activeIds?.has(explicitReplacement.id)
        && explicitReplacement.targetFactId === invalidatedWorkloadId)));
    if (alreadyInstalled || alreadyInvalidated) {
      // Only this transaction's exact migration can satisfy an explicit correction.
      // Consume it once without self-superseding or reviving retired evidence.
      migrated.delete(intentTargetId!);
      invalidatedWorkloadTargets.delete(intentTargetId!);
      const consumed = removeFact({
        graph,
        factId: correctionId,
        operationKey: `${params.operationKeyPrefix}:correction:${correctionId}`,
      });
      if (consumed.error) return reject(params.originalGraph, [consumed.error]);
      graph = consumed.graph;
      removed.push(...consumed.removed);
      continue;
    }
    if (retargetTo) {
      migrated.delete(intentTargetId!);
      graph = resolveCorrectionTargetInGraph({ graph, correctionIntentFactId: correctionId, targetFactId: retargetTo });
    }
    const result = applyWeeklyPlanningCorrectionTransactionV5({
      graph,
      expectedRevision: graph.revision,
      correctionIntentFactId: correctionId,
      operationKey: `${params.operationKeyPrefix}:correction:${correctionId}`,
    });
    if (result.status === 'rejected') return reject(params.originalGraph, result.errors);
    graph = result.graph;
    if (intent?.target.kind === 'workload' && intent.operation !== 'remove' && intent.replacementFactId) {
      // A workload correction itself only retires the workload, so every effort in its result came from the
      // dependent migration policy.
      for (const entry of result.superseded) {
        if (entry.kind !== 'effort_estimate') continue;
        const to = graph.factLifecycles.find((lifecycle) => lifecycle.factId === entry.id)?.supersededByFactId;
        if (to) migrated.set(entry.id, to);
      }
      for (const entry of result.removed) {
        if (entry.kind === 'effort_estimate') invalidatedWorkloadTargets.set(entry.id, intent.replacementFactId);
      }
    }
    added.push(...result.added);
    superseded.push(...result.superseded);
    removed.push(...result.removed);
  }

  const pruneableSupport = pruneableSupportFactIdsV5({
    supportFactIds,
    correctionReplacementFactIds: graph.correctionIntents
      .filter((fact) => applicableCorrectionIds.has(fact.id))
      .map((fact) => fact.replacementFactId),
  });
  const contentBearingSupport = pruneableSupport.filter((id) => !isRedundantSupportFactV5(graph, id));
  if (contentBearingSupport.length > 0) {
    // Never delete turn-created content that no correction installs: fail visibly and keep the original graph.
    return reject(
      params.originalGraph,
      contentBearingSupport.map((id) => `replacement-support-not-installed:${id}`),
    );
  }
  const pruneIds: string[] = [...pruneableSupport];
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
