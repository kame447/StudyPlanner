import {
  normalizeContainingTaskComponentParentV5,
} from './weeklyPlanningComponentParentNormalizationV5';
import {
  normalizeCopiedUserContextDeltaV5,
} from './weeklyPlanningCopiedUserContextNormalizationV5';
import {
  normalizeExactDuplicateWorkloadPlacementV5,
} from './weeklyPlanningDuplicateWorkloadNormalizationV5';
import {
  validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5,
} from './weeklyPlanningExistingEntityBindingV5';
import {
  validateWeeklyPlanningRecurrenceConsistencyV5,
} from './weeklyPlanningRecurrenceConsistencyV5';
import {
  normalizeWeeklyPlanningRecurrenceWorkloadTargetsV5,
} from './weeklyPlanningRecurrenceTargetNormalizationV5';
import {
  normalizeResolvedProgressWorkloadsV5,
} from './weeklyPlanningResolvedProgressNormalizationV5';
import {
  normalizeTaskDecompositionUncertaintiesV5,
} from './weeklyPlanningTaskDecompositionNormalizationV5';
import {
  readWeeklyPlanningRepresentationRepairBaselineV5,
} from './weeklyPlanningSemanticRepairPreservationV5';
import {
  validateWeeklyPlanningWorkBreakdownResponseContractV5,
} from './weeklyPlanningWorkBreakdownResponseContractV5';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningSemanticEvidenceV5,
} from './weeklyPlanningSemanticEvidenceV5';
import {
  planningWindowCanonicalValueErrors,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';
import {
  normalizePendingQuestionEntityBindingsV5,
} from './weeklyPlanningPendingEntityBindingNormalizationV5';
import {
  canonicalizeWeeklyPlanningSemanticRepresentationV5,
} from './weeklyPlanningSemanticRepresentationCanonicalizationV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';
import {
  normalizeWeeklyPlanningTemporalClockRawV5,
  validateWeeklyPlanningTemporalClockEncodingV5,
} from './weeklyPlanningTemporalClockEncodingV5';
import {
  validateWeeklyPlanningWeekdayEncodingV5,
} from './weeklyPlanningWeekdayEncodingV5';

export interface WeeklyPlanningSemanticResponseValidationInputV5 {
  publicStateSummary?: Record<string, unknown>;
}

export interface WeeklyPlanningSemanticValidationAttemptV5 {
  document: WeeklyPlanningSemanticDocumentV5 | null;
  parsedDocument: WeeklyPlanningSemanticDocumentV5 | null;
  errors: string[];
  algorithmicRepairs: string[];
}

export function validateWeeklyPlanningSemanticResponseV5(
  rawResponse: string,
  input: WeeklyPlanningSemanticResponseValidationInputV5,
): WeeklyPlanningSemanticValidationAttemptV5 {
  const decompositionNormalization = normalizeTaskDecompositionUncertaintiesV5(rawResponse);
  const copiedContextNormalization = normalizeCopiedUserContextDeltaV5({
    rawResponse: decompositionNormalization.rawResponse,
    publicStateSummary: input.publicStateSummary,
  });
  const pendingBindingNormalization = normalizePendingQuestionEntityBindingsV5({
    rawResponse: copiedContextNormalization.rawResponse,
    publicStateSummary: input.publicStateSummary,
  });
  const componentParentNormalization = normalizeContainingTaskComponentParentV5(
    pendingBindingNormalization.rawResponse,
  );
  const workloadNormalization = normalizeExactDuplicateWorkloadPlacementV5(
    componentParentNormalization.rawResponse,
  );
  const resolvedProgressNormalization = normalizeResolvedProgressWorkloadsV5(
    workloadNormalization.rawResponse,
  );
  const recurrenceTargetNormalization = normalizeWeeklyPlanningRecurrenceWorkloadTargetsV5(
    resolvedProgressNormalization.rawResponse,
  );
  const clockNormalization = normalizeWeeklyPlanningTemporalClockRawV5(
    recurrenceTargetNormalization.rawResponse,
  );
  const preParseRepairs = [
    ...decompositionNormalization.repairs,
    ...copiedContextNormalization.repairs,
    ...pendingBindingNormalization.repairs,
    ...componentParentNormalization.repairs,
    ...workloadNormalization.repairs,
    ...resolvedProgressNormalization.repairs,
    ...recurrenceTargetNormalization.repairs,
    ...clockNormalization.repairs,
  ];
  const parsed = parseWeeklyPlanningSemanticDocumentV5(clockNormalization.rawResponse);
  if (!parsed.document) {
    return {
      document: null,
      parsedDocument: readWeeklyPlanningRepresentationRepairBaselineV5({
        rawResponse: clockNormalization.rawResponse,
        validationErrors: parsed.errors,
      }),
      errors: parsed.errors,
      algorithmicRepairs: preParseRepairs,
    };
  }

  const normalized = canonicalizeWeeklyPlanningSemanticRepresentationV5(parsed.document);
  const algorithmicRepairs = [...preParseRepairs, ...normalized.repairs];
  const document = normalized.document;
  const errors = [
    ...planningWindowCanonicalValueErrors(document.planningWindow),
    ...validateWeeklyPlanningTemporalClockEncodingV5(document),
    ...validateWeeklyPlanningWeekdayEncodingV5(document),
    ...validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5({
      document,
      publicStateSummary: input.publicStateSummary,
    }),
    ...validateWeeklyPlanningRecurrenceConsistencyV5(document),
    ...validateWeeklyPlanningWorkBreakdownResponseContractV5({
      document,
      publicStateSummary: input.publicStateSummary,
    }),
    ...validateWeeklyPlanningSemanticEvidenceV5({ document }),
  ];
  return {
    document: errors.length === 0 ? document : null,
    parsedDocument: document,
    errors,
    algorithmicRepairs,
  };
}
