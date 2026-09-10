import {
  applyWeeklyPlanningCanonicalCorrectionsV5,
  WEEKLY_PLANNING_CANONICAL_CORRECTION_APPLICATION_VERSION_V5,
  type WeeklyPlanningCanonicalCorrectionApplicationResultV5,
} from './weeklyPlanningCanonicalCorrectionApplicationV5';
import {
  applyWeeklyPlanningCorrectionTransactionV5,
} from './weeklyPlanningCorrectionTransactionV5';
import {
  activeWeeklyPlanningFactIdsV5,
  weeklyPlanningFactKindByIdV5,
} from './weeklyPlanningFactLifecycleV5';
import type {
  WeeklyPlanningFactDiffEntryV5,
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';

const AVAILABILITY_REFERENCE_KIND = 'availability_declaration';

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

function uniqueDiffEntries(
  entries: readonly WeeklyPlanningFactDiffEntryV5[],
): WeeklyPlanningFactDiffEntryV5[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function availabilityCorrectionIds(
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5,
): string[] {
  if (canonicalization.status !== 'applied' || !canonicalization.diff) return [];
  const addedCorrectionIds = new Set(
    canonicalization.diff.added
      .filter((entry) => entry.kind === 'correction_intent')
      .map((entry) => entry.id),
  );
  return canonicalization.graph.correctionIntents
    .filter((fact) =>
      addedCorrectionIds.has(fact.id)
      && (fact.target.kind as string) === AVAILABILITY_REFERENCE_KIND)
    .map((fact) => fact.id)
    .sort();
}

function resolveAvailabilityCorrectionTarget(params: {
  graph: WeeklyPlanningFactGraphV5;
  correctionId: string;
  addedIds: ReadonlySet<string>;
}): {
  graph: WeeklyPlanningFactGraphV5;
  error: string | null;
} {
  const correction = params.graph.correctionIntents.find((fact) => fact.id === params.correctionId);
  if (!correction) {
    return { graph: params.graph, error: `unknown-correction-intent:${params.correctionId}` };
  }
  if ((correction.target.kind as string) !== AVAILABILITY_REFERENCE_KIND) {
    return { graph: params.graph, error: `not-availability-correction:${params.correctionId}` };
  }

  const targetFactId = correction.target.factId ?? correction.target.publicId;
  if (!targetFactId) {
    return { graph: params.graph, error: `unresolved-correction-target:${params.correctionId}` };
  }
  const kindById = weeklyPlanningFactKindByIdV5(params.graph);
  if (kindById.get(targetFactId) !== 'availability_declaration') {
    return {
      graph: params.graph,
      error: `correction-target-kind-mismatch:${params.correctionId}:${targetFactId}`,
    };
  }
  const activeIds = activeWeeklyPlanningFactIdsV5(params.graph);
  if (activeIds && !activeIds.has(targetFactId)) {
    return {
      graph: params.graph,
      error: `correction-target-not-active:${params.correctionId}:${targetFactId}`,
    };
  }

  if (correction.operation !== 'remove') {
    const replacementFactId = correction.replacementFactId;
    if (!replacementFactId) {
      return {
        graph: params.graph,
        error: `correction-replacement-not-resolved:${params.correctionId}`,
      };
    }
    if (!params.addedIds.has(replacementFactId)) {
      return {
        graph: params.graph,
        error: `correction-replacement-not-created-in-turn:${params.correctionId}`,
      };
    }
    if (kindById.get(replacementFactId) !== 'availability_declaration') {
      return {
        graph: params.graph,
        error: `correction-replacement-kind-mismatch:${params.correctionId}:${replacementFactId}`,
      };
    }
  }

  const correctionIntents = params.graph.correctionIntents.map((fact) =>
    fact.id === correction.id
      ? {
          ...fact,
          target: {
            ...fact.target,
            factId: targetFactId,
          },
        }
      : fact);
  return {
    graph: {
      ...params.graph,
      correctionIntents,
    } as unknown as WeeklyPlanningFactGraphV5,
    error: null,
  };
}

function applyAvailabilityCorrections(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  operationKeyPrefix: string;
}) {
  const correctionIds = availabilityCorrectionIds(params.canonicalization);
  if (correctionIds.length === 0 || !params.canonicalization.diff) {
    return {
      status: 'not_applicable' as const,
      graph: params.canonicalization.graph,
      processedCorrectionIds: [] as string[],
      superseded: [] as WeeklyPlanningFactDiffEntryV5[],
      removed: [] as WeeklyPlanningFactDiffEntryV5[],
      errors: [] as string[],
    };
  }

  const addedIds = new Set(params.canonicalization.diff.added.map((entry) => entry.id));
  let graph = params.canonicalization.graph;
  const superseded: WeeklyPlanningFactDiffEntryV5[] = [];
  const removed: WeeklyPlanningFactDiffEntryV5[] = [];

  for (const correctionId of correctionIds) {
    const resolved = resolveAvailabilityCorrectionTarget({ graph, correctionId, addedIds });
    if (resolved.error) {
      return {
        status: 'rejected' as const,
        graph: params.originalGraph,
        processedCorrectionIds: [] as string[],
        superseded: [] as WeeklyPlanningFactDiffEntryV5[],
        removed: [] as WeeklyPlanningFactDiffEntryV5[],
        errors: [resolved.error],
      };
    }
    graph = resolved.graph;

    const applied = applyWeeklyPlanningCorrectionTransactionV5({
      graph,
      expectedRevision: graph.revision,
      correctionIntentFactId: correctionId,
      operationKey: `${params.operationKeyPrefix}:availability-correction:${correctionId}`,
    });
    if (applied.status === 'rejected') {
      return {
        status: 'rejected' as const,
        graph: params.originalGraph,
        processedCorrectionIds: [] as string[],
        superseded: [] as WeeklyPlanningFactDiffEntryV5[],
        removed: [] as WeeklyPlanningFactDiffEntryV5[],
        errors: applied.errors,
      };
    }
    graph = applied.graph;
    superseded.push(...applied.superseded);
    removed.push(...applied.removed);
  }

  return {
    status: 'applied' as const,
    graph,
    processedCorrectionIds: correctionIds,
    superseded: uniqueDiffEntries(superseded),
    removed: uniqueDiffEntries(removed),
    errors: [] as string[],
  };
}

export function applyWeeklyPlanningCanonicalCorrectionsExtendedV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  operationKeyPrefix: string;
}): WeeklyPlanningCanonicalCorrectionApplicationResultV5 {
  if (params.canonicalization.status !== 'applied' || !params.canonicalization.diff) {
    return applyWeeklyPlanningCanonicalCorrectionsV5(params);
  }

  const availability = applyAvailabilityCorrections(params);
  if (availability.status === 'rejected') {
    return reject(params.originalGraph, availability.errors);
  }

  const processedIds = new Set(availability.processedCorrectionIds);
  const genericCanonicalization: WeeklyPlanningSemanticCanonicalizationResultV5 = {
    ...params.canonicalization,
    graph: availability.graph,
    diff: {
      ...params.canonicalization.diff,
      toRevision: availability.graph.revision,
      added: params.canonicalization.diff.added.filter((entry) =>
        !(entry.kind === 'correction_intent' && processedIds.has(entry.id))),
    },
  };
  const generic = applyWeeklyPlanningCanonicalCorrectionsV5({
    ...params,
    canonicalization: genericCanonicalization,
  });
  if (generic.status === 'rejected') return generic;
  if (availability.status === 'not_applicable') return generic;

  return {
    version: WEEKLY_PLANNING_CANONICAL_CORRECTION_APPLICATION_VERSION_V5,
    status: 'applied',
    graph: generic.status === 'applied' ? generic.graph : availability.graph,
    added: uniqueDiffEntries(generic.added),
    superseded: uniqueDiffEntries([
      ...availability.superseded,
      ...generic.superseded,
    ]),
    removed: uniqueDiffEntries([
      ...availability.removed,
      ...generic.removed,
    ]),
    errors: [],
  };
}
