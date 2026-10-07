import {
  validateWeeklyPlanningCorrectionReplacementKindsV5,
  validateWeeklyPlanningCorrectionTargetReferencesV5,
  validateWeeklyPlanningRawCorrectionTargetReferencesV5,
} from './weeklyPlanningCorrectionReferenceValidationV5';
import {
  validateWeeklyPlanningCurrentTurnProvenanceV5,
} from './weeklyPlanningCurrentTurnProvenanceV5';
import { projectWeeklyPlanningCorrectionContextV5 } from './weeklyPlanningCorrectionContextProjectionV5';
import { projectWeeklyPlanningRegisteredMaterialReferencesV5 } from './weeklyPlanningRegisteredMaterialReferenceProjectionV5';
import { validateWeeklyPlanningMaterialIdentityAnswerV5 } from './weeklyPlanningMaterialIdentityAnswerV5';
import { projectWeeklyPlanningExistingWorkloadRateReferenceV5 } from './weeklyPlanningExistingWorkloadRateReferenceV5';
import {
  validateWeeklyPlanningDecisionTargetReferencesV5,
} from './weeklyPlanningDecisionReferenceValidationV5';
import {
  validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5,
} from './weeklyPlanningExistingEntityBindingV5';
import {
  resolveWeeklyPlanningConversationActTargetsV5,
  type SemanticConversationActV5,
} from './weeklyPlanningConversationActsV5';
import {
  validateWeeklyPlanningSemanticNumericSafetyV5,
} from './weeklyPlanningNumericSafetyV5';
import {
  validateWeeklyPlanningRecurrenceConsistencyV5,
} from './weeklyPlanningRecurrenceConsistencyV5';
import {
  readWeeklyPlanningRepresentationRepairBaselineV5,
  readWeeklyPlanningSemanticProviderDocumentV5,
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
  parseWeeklyPlanningSemanticDocumentWithAvailabilityCorrectionsV5 as parseWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningAvailabilityCorrectionCompatibilityV5';
import {
  validateWeeklyPlanningTemporalClockEncodingV5,
} from './weeklyPlanningTemporalClockEncodingV5';
import {
  validateWeeklyPlanningWeekdayEncodingV5,
} from './weeklyPlanningWeekdayEncodingV5';
import type { WeeklyPlanningSelectedStarterTargetV5 } from './weeklyPlanningTurnEvidenceV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import {
  conversationArchitecturePolicy,
  type WeeklyPlanningConversationArchitecture,
} from '../weeklyPlanningConversationArchitecture';

export interface WeeklyPlanningSemanticResponseValidationInputV5 {
  currentUserText?: string;
  supplementalContext?: string;
  selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5;
  recentConversation?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
  committedGraph?: WeeklyPlanningFactGraphV5;
  /** Conversation architecture whose response contract applies; omitted = current default. */
  conversationArchitecture?: WeeklyPlanningConversationArchitecture;
}

export interface WeeklyPlanningSemanticValidationAttemptV5 {
  /** The validated planning delta (with its valid conversation acts), or null. */
  document: WeeklyPlanningSemanticDocumentV5 | null;
  parsedDocument: WeeklyPlanningSemanticDocumentV5 | null;
  /**
   * Interaction architecture only: the document as the provider wrote it (after pre-parse
   * normalization), before canonicalization and projections. Repair preservation compares
   * these so deterministic post-parse projections never count as a repair change.
   */
  providerDocument?: WeeklyPlanningSemanticDocumentV5 | null;
  /** Planning-delta validation errors only; conversation acts never add one. */
  errors: string[];
  algorithmicRepairs: string[];
  /**
   * Interaction architecture only: the response's valid conversation acts, reported even
   * when the planning delta is rejected (non-authoritative discourse metadata).
   */
  conversationActs?: SemanticConversationActV5[];
  conversationActDiagnostics?: string[];
  /** Interaction architecture only: the response carried planning content. */
  planningContentPresent?: boolean;
}

function uniqueErrors(errors: string[]): string[] {
  return [...new Set(errors)];
}

function calendarReferenceDate(
  publicStateSummary: Record<string, unknown> | undefined,
): string | null {
  const context = publicStateSummary?.calendarContext;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const currentDate = (context as Record<string, unknown>).currentDate;
  return typeof currentDate === 'string' ? currentDate : null;
}

export function validateWeeklyPlanningSemanticResponseV5(
  rawResponse: string,
  input: WeeklyPlanningSemanticResponseValidationInputV5,
): WeeklyPlanningSemanticValidationAttemptV5 {
  const semanticConversationActs = conversationArchitecturePolicy(
    input.conversationArchitecture,
  ).semanticConversationActs;
  const preParseNormalization = normalizeWeeklyPlanningSemanticPreParseV5({
    rawResponse,
    publicStateSummary: input.publicStateSummary,
    semanticConversationActs,
  });
  const rawCorrectionErrors = validateWeeklyPlanningRawCorrectionTargetReferencesV5(
    preParseNormalization.rawResponse,
    input.publicStateSummary,
  );
  const workloadRateReference = semanticConversationActs
    ? projectWeeklyPlanningExistingWorkloadRateReferenceV5({ rawResponse: preParseNormalization.rawResponse, graph: input.committedGraph })
    : { rawResponse: preParseNormalization.rawResponse, repairs: [] };
  const parsed = parseWeeklyPlanningSemanticDocumentV5(
    workloadRateReference.rawResponse,
    { conversationActs: semanticConversationActs },
  );
  const actTargets = parsed.conversationActs
    ? resolveWeeklyPlanningConversationActTargetsV5({
        acts: parsed.conversationActs,
        publicStateSummary: input.publicStateSummary,
      })
    : null;
  const conversationActEvidence = actTargets
    ? {
        conversationActs: actTargets.acts,
        conversationActDiagnostics: [
          ...(parsed.conversationActDiagnostics ?? []),
          ...actTargets.diagnostics,
        ],
        planningContentPresent: parsed.planningContentPresent ?? false,
      }
    : {};
  const providerDocument = semanticConversationActs
    ? { providerDocument: readWeeklyPlanningSemanticProviderDocumentV5(preParseNormalization.rawResponse) }
    : {};
  if (!parsed.document) {
    const errors = uniqueErrors([
      ...parsed.errors,
      ...rawCorrectionErrors,
    ]);
    return {
      document: null,
      parsedDocument: readWeeklyPlanningRepresentationRepairBaselineV5({
        rawResponse: preParseNormalization.rawResponse,
        validationErrors: errors,
        conversationArchitecture: input.conversationArchitecture,
      }),
      errors,
      algorithmicRepairs: preParseNormalization.repairs,
      ...providerDocument,
      ...conversationActEvidence,
    };
  }

  const normalized = canonicalizeWeeklyPlanningSemanticRepresentationV5(parsed.document);
  // Provider/context projection only. Legacy keeps its original response contract;
  // the shared correction transaction owns rate carry and graph mutation in both.
  const correctionContext = semanticConversationActs
    ? projectWeeklyPlanningCorrectionContextV5({ document: normalized.document, committedGraph: input.committedGraph })
    : { document: normalized.document, repairs: [] };
  const materialReferences = semanticConversationActs
    ? projectWeeklyPlanningRegisteredMaterialReferencesV5({
        document: correctionContext.document,
        publicStateSummary: input.publicStateSummary,
      })
    : { document: correctionContext.document, repairs: [] };
  const algorithmicRepairs = [
    ...preParseNormalization.repairs,
    ...workloadRateReference.repairs,
    ...normalized.repairs,
    ...correctionContext.repairs,
    ...materialReferences.repairs,
  ];
  const document = actTargets
    ? { ...materialReferences.document, conversationActs: actTargets.acts }
    : materialReferences.document;
  const errors = [
    ...(semanticConversationActs ? validateWeeklyPlanningMaterialIdentityAnswerV5({ document, graph: input.committedGraph }) : []),
    ...validateWeeklyPlanningSemanticNumericSafetyV5(document),
    ...planningWindowCanonicalValueErrors(
      document.planningWindow,
      calendarReferenceDate(input.publicStateSummary),
    ),
    ...validateWeeklyPlanningTemporalClockEncodingV5(document),
    ...validateWeeklyPlanningWeekdayEncodingV5(document),
    ...validateWeeklyPlanningCorrectionTargetReferencesV5(
      document,
      input.publicStateSummary,
    ),
    ...(semanticConversationActs ? validateWeeklyPlanningCorrectionReplacementKindsV5(document) : []),
    ...validateWeeklyPlanningDecisionTargetReferencesV5(
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
      // Interaction architecture: a response with no planning content (for example an
      // explanation request) leaves the pending breakdown untouched and need not restate it.
      exemptEmptyPlanningDelta: semanticConversationActs,
    }),
    ...validateWeeklyPlanningSemanticEvidenceV5({ document }),
    ...validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: input.currentUserText,
      supplementalContext: input.supplementalContext,
      selectedStarterTarget: input.selectedStarterTarget,
      recentConversation: input.recentConversation,
      publicStateSummary: input.publicStateSummary,
      committedGraph: input.committedGraph,
    }),
  ];
  return {
    document: errors.length === 0 ? document : null,
    parsedDocument: document,
    errors,
    algorithmicRepairs,
    ...providerDocument,
    ...conversationActEvidence,
  };
}
