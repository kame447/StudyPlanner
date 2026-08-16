import {
  validateWeeklyPlanningCorrectionTargetReferencesV5,
} from './weeklyPlanningCorrectionReferenceValidationV5';
import {
  validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5,
} from './weeklyPlanningExistingEntityBindingV5';
import {
  validateWeeklyPlanningRecurrenceConsistencyV5,
} from './weeklyPlanningRecurrenceConsistencyV5';
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
  normalizeWeeklyPlanningSemanticPreParseV5,
} from './weeklyPlanningSemanticPreParseNormalizationV5';
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
  const preParseNormalization = normalizeWeeklyPlanningSemanticPreParseV5({
    rawResponse,
    publicStateSummary: input.publicStateSummary,
  });
  const parsed = parseWeeklyPlanningSemanticDocumentV5(
    preParseNormalization.rawResponse,
  );
  if (!parsed.document) {
    return {
      document: null,
      parsedDocument: readWeeklyPlanningRepresentationRepairBaselineV5({
        rawResponse: preParseNormalization.rawResponse,
        validationErrors: parsed.errors,
      }),
      errors: parsed.errors,
      algorithmicRepairs: preParseNormalization.repairs,
    };
  }

  const normalized = canonicalizeWeeklyPlanningSemanticRepresentationV5(parsed.document);
  const algorithmicRepairs = [
    ...preParseNormalization.repairs,
    ...normalized.repairs,
  ];
  const document = normalized.document;
  const errors = [
    ...planningWindowCanonicalValueErrors(document.planningWindow),
    ...validateWeeklyPlanningTemporalClockEncodingV5(document),
    ...validateWeeklyPlanningWeekdayEncodingV5(document),
    ...validateWeeklyPlanningCorrectionTargetReferencesV5(
      document,
      input.publicStateSummary,
    ),
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
