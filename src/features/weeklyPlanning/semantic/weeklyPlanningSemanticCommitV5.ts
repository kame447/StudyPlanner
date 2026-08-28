import {
  applyWeeklyPlanningCanonicalCorrectionsV5,
} from './weeklyPlanningCanonicalCorrectionApplicationV5';
import {
  projectWeeklyPlanningBoundedProgressV5,
} from './weeklyPlanningBoundedProgressProjectionV5';
import type {
  WeeklyPlanningFactDiffEntryV5,
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  applyWeeklyPlanningExistingEntityBindingsV5,
} from './weeklyPlanningExistingEntityBindingApplicationV5';
import {
  projectWeeklyPlanningPercentageProgressV5,
} from './weeklyPlanningPercentageProgressProjectionV5';
import {
  reconcileWeeklyPlanningProgressCorrectionsV5,
} from './weeklyPlanningProgressCorrectionReconciliationV5';
import type {
  WeeklyPlanningSemanticCanonicalizationResultV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export function shouldApplyWeeklyPlanningExistingEntityBindingsV5(params: {
  contextualAnswer: boolean;
  questionCode: string | null;
  localReferenceCount: number;
}): boolean {
  if (!params.contextualAnswer) return true;
  if (params.questionCode !== 'semantic_uncertainty') return false;

  // A semantic-uncertainty answer can either canonicalize a real document
  // delta or intentionally keep the uncertainty unresolved. The latter is a
  // contextual no-op and has no temporary semantic entities to rebase.
  return params.localReferenceCount > 0;
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

function applyCanonicalCorrectionResult(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  operationKeyPrefix: string;
}): {
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  application: ReturnType<typeof applyWeeklyPlanningCanonicalCorrectionsV5>;
} {
  const application = applyWeeklyPlanningCanonicalCorrectionsV5(params);
  if (application.status === 'rejected') {
    return {
      application,
      canonicalization: {
        status: 'rejected',
        graph: params.originalGraph,
        diff: null,
        errors: application.errors.map((error) => `correction-application:${error}`),
        localToFactId: params.canonicalization.localToFactId,
      },
    };
  }
  if (application.status !== 'applied' || !params.canonicalization.diff) {
    return { application, canonicalization: params.canonicalization };
  }
  return {
    application,
    canonicalization: {
      ...params.canonicalization,
      graph: application.graph,
      diff: {
        ...params.canonicalization.diff,
        toRevision: application.graph.revision,
        added: uniqueDiffEntries([
          ...params.canonicalization.diff.added,
          ...application.added,
        ]),
        superseded: uniqueDiffEntries([
          ...params.canonicalization.diff.superseded,
          ...application.superseded,
        ]),
        removed: uniqueDiffEntries([
          ...params.canonicalization.diff.removed,
          ...application.removed,
        ]),
      },
    },
  };
}

function collapseWeeklyPlanningNoOpCanonicalizationV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const diff = params.canonicalization.diff;
  if (params.canonicalization.status !== 'applied' || !diff) {
    return params.canonicalization;
  }
  const hasFactChanges = diff.added.length > 0
    || diff.superseded.length > 0
    || diff.removed.length > 0;
  if (hasFactChanges) return params.canonicalization;
  return {
    ...params.canonicalization,
    graph: {
      ...params.originalGraph,
      appliedTurnKeys: params.canonicalization.graph.appliedTurnKeys,
    },
    diff: {
      ...diff,
      toRevision: params.originalGraph.revision,
    },
  };
}

export function finalizeWeeklyPlanningSemanticCanonicalizationV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  baseCanonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
  contextualAnswer: boolean;
  questionCode: string | null;
  operationKeyPrefix: string;
}) {
  const entityBindingApplication = shouldApplyWeeklyPlanningExistingEntityBindingsV5({
    contextualAnswer: params.contextualAnswer,
    questionCode: params.questionCode,
    localReferenceCount: Object.keys(params.baseCanonicalization.localToFactId).length,
  })
    ? applyWeeklyPlanningExistingEntityBindingsV5({
        originalGraph: params.originalGraph,
        document: params.document,
        canonicalization: params.baseCanonicalization,
      })
    : {
        version: 'weekly-planning-existing-entity-binding-application-v5' as const,
        status: 'not_applicable' as const,
        canonicalization: params.baseCanonicalization,
        errors: [],
      };
  const boundCanonicalization = entityBindingApplication.canonicalization;
  const correctionResult = applyCanonicalCorrectionResult({
    originalGraph: params.originalGraph,
    canonicalization: boundCanonicalization,
    operationKeyPrefix: params.operationKeyPrefix,
  });
  const progressReconciledCanonicalization = reconcileWeeklyPlanningProgressCorrectionsV5({
    originalGraph: params.originalGraph,
    canonicalization: correctionResult.canonicalization,
    operationKeyPrefix: params.operationKeyPrefix,
  });
  const percentageProjectedCanonicalization = projectWeeklyPlanningPercentageProgressV5({
    originalGraph: params.originalGraph,
    canonicalization: progressReconciledCanonicalization,
    operationKeyPrefix: params.operationKeyPrefix,
  });
  const boundedProjectedCanonicalization = projectWeeklyPlanningBoundedProgressV5({
    originalGraph: params.originalGraph,
    canonicalization: percentageProjectedCanonicalization,
    operationKeyPrefix: params.operationKeyPrefix,
  });
  const canonicalization = collapseWeeklyPlanningNoOpCanonicalizationV5({
    originalGraph: params.originalGraph,
    canonicalization: boundedProjectedCanonicalization,
  });
  return {
    entityBindingApplication,
    boundCanonicalization,
    correctionApplication: correctionResult.application,
    canonicalization,
  };
}
