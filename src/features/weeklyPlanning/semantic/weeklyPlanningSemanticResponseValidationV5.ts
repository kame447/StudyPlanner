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
  validateWeeklyPlanningStandaloneModifierTargetsV5,
} from './weeklyPlanningStandaloneModifierTargetV5';
import {
  planningWindowCanonicalValueErrors,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';
import {
  canonicalizeWeeklyPlanningSemanticRepresentationV5,
} from './weeklyPlanningSemanticRepresentationCanonicalizationV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticValidatorV5';
import {
  validateWeeklyPlanningTemporalClockEncodingV5,
} from './weeklyPlanningTemporalClockEncodingV5';
import {
  validateWeeklyPlanningWeekdayEncodingV5,
} from './weeklyPlanningWeekdayEncodingV5';

export interface WeeklyPlanningSemanticResponseValidationInputV5 {
  userText: string;
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
    userText: input.userText,
    publicStateSummary: input.publicStateSummary,
  });
  const componentParentNormalization = normalizeContainingTaskComponentParentV5(
    copiedContextNormalization.rawResponse,
  );
  const workloadNormalization = normalizeExactDuplicateWorkloadPlacementV5(
    componentParentNormalization.rawResponse,
  );
  const preParseRepairs = [
    ...decompositionNormalization.repairs,
    ...copiedContextNormalization.repairs,
    ...componentParentNormalization.repairs,
    ...workloadNormalization.repairs,
  ];
  const parsed = parseWeeklyPlanningSemanticDocumentV5(workloadNormalization.rawResponse);
  if (!parsed.document) {
    return {
      document: null,
      parsedDocument: readWeeklyPlanningRepresentationRepairBaselineV5({
        rawResponse: workloadNormalization.rawResponse,
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
      userText: input.userText,
      publicStateSummary: input.publicStateSummary,
    }),
    ...validateWeeklyPlanningSemanticEvidenceV5({
      document,
      input,
    }),
    ...validateWeeklyPlanningStandaloneModifierTargetsV5({
      document,
      userText: input.userText,
    }),
  ];
  return {
    document: errors.length === 0 ? document : null,
    parsedDocument: document,
    errors,
    algorithmicRepairs,
  };
}
