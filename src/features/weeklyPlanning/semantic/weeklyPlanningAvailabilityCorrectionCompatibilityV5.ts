import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentV5,
  type WeeklyPlanningSemanticCanonicalizationContextV5,
  type WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';

const AVAILABILITY_REFERENCE_KIND = 'availability_declaration';
const BASE_COMPATIBILITY_REFERENCE_KIND = 'planning_window';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function transformCorrectionTargets(
  value: unknown,
  fromKind: string,
  toKind: string,
): { value: unknown; transformedIndexes: Set<number> } {
  const transformedIndexes = new Set<number>();
  if (!isRecord(value) || !Array.isArray(value.corrections)) {
    return { value, transformedIndexes };
  }
  const corrections = value.corrections.map((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.target) || entry.target.kind !== fromKind) {
      return entry;
    }
    transformedIndexes.add(index);
    return {
      ...entry,
      target: {
        ...entry.target,
        kind: toKind,
      },
    };
  });
  return {
    value: { ...value, corrections },
    transformedIndexes,
  };
}

function restoreDocumentCorrectionKinds(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  transformedIndexes: ReadonlySet<number>;
}): WeeklyPlanningSemanticDocumentV5 {
  if (params.transformedIndexes.size === 0) return params.document;
  const corrections = params.document.corrections.map((correction, index) => {
    if (!params.transformedIndexes.has(index)) return correction;
    return {
      ...correction,
      target: {
        ...correction.target,
        kind: AVAILABILITY_REFERENCE_KIND,
      },
    };
  });
  return {
    ...params.document,
    corrections,
  } as unknown as WeeklyPlanningSemanticDocumentV5;
}

export function parseWeeklyPlanningSemanticDocumentWithAvailabilityCorrectionsV5(
  rawResponse: string,
): ReturnType<typeof parseWeeklyPlanningSemanticDocumentV5> {
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(rawResponse) as unknown;
  } catch {
    return parseWeeklyPlanningSemanticDocumentV5(rawResponse);
  }
  const compatibility = transformCorrectionTargets(
    parsedRaw,
    AVAILABILITY_REFERENCE_KIND,
    BASE_COMPATIBILITY_REFERENCE_KIND,
  );
  const parsed = parseWeeklyPlanningSemanticDocumentV5(JSON.stringify(compatibility.value));
  if (!parsed.document) return parsed;
  return {
    ...parsed,
    document: restoreDocumentCorrectionKinds({
      document: parsed.document,
      transformedIndexes: compatibility.transformedIndexes,
    }),
  };
}

function availabilityCorrectionLocalIds(
  document: WeeklyPlanningSemanticDocumentV5,
): Set<string> {
  return new Set(
    document.corrections
      .filter((correction) => (correction.target.kind as string) === AVAILABILITY_REFERENCE_KIND)
      .map((correction) => correction.localId),
  );
}

function compatibilityDocument(
  document: WeeklyPlanningSemanticDocumentV5,
): WeeklyPlanningSemanticDocumentV5 {
  return {
    ...document,
    corrections: document.corrections.map((correction) =>
      (correction.target.kind as string) === AVAILABILITY_REFERENCE_KIND
        ? {
            ...correction,
            target: {
              ...correction.target,
              kind: BASE_COMPATIBILITY_REFERENCE_KIND,
            },
          }
        : correction),
  } as WeeklyPlanningSemanticDocumentV5;
}

export function canonicalizeWeeklyPlanningSemanticDocumentWithAvailabilityCorrectionsV5(params: {
  graph?: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  context: WeeklyPlanningSemanticCanonicalizationContextV5;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const localIds = availabilityCorrectionLocalIds(params.document);
  const result = canonicalizeWeeklyPlanningSemanticDocumentV5({
    ...params,
    document: compatibilityDocument(params.document),
  });
  if (result.status !== 'applied' || localIds.size === 0) return result;

  const correctionFactIds = new Set(
    [...localIds]
      .map((localId) => result.localToFactId[localId])
      .filter((factId): factId is string => Boolean(factId)),
  );
  const correctionIntents = result.graph.correctionIntents.map((fact) => {
    if (!correctionFactIds.has(fact.id)) return fact;
    return {
      ...fact,
      target: {
        ...fact.target,
        kind: AVAILABILITY_REFERENCE_KIND,
      },
    };
  });
  return {
    ...result,
    graph: {
      ...result.graph,
      correctionIntents,
    } as unknown as WeeklyPlanningFactGraphV5,
  };
}
