import type { WeeklyPlanningSemanticCompletenessAbstentionV5 } from './weeklyPlanningSemanticCompletenessPreservationV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import type { WeeklyPlanningTurnEvidenceV5 } from './weeklyPlanningTurnEvidenceV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 } from './weeklyPlanningSemanticTypesV5';

export const WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5 =
  'weekly-planning-semantic-normalizer-v5' as const;

export interface WeeklyPlanningSemanticNormalizerInputV5 extends WeeklyPlanningTurnEvidenceV5 {
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
  /** Internal committed evidence only; never serialized into the provider prompt. */
  committedGraph?: WeeklyPlanningFactGraphV5;
  traceRequestId?: string;
  /** Conversation architecture the provider contract follows; omitted = current default. */
  conversationArchitecture?: WeeklyPlanningConversationArchitecture;
}

export interface WeeklyPlanningSemanticNormalizerDiagnosticsV5 {
  schemaVersion: typeof WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5;
  jsonSchemaName: string;
  normalizerVersion: typeof WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5;
  attemptCount: number;
  repairAttempted: boolean;
  requestBytes: number[];
  responseLengths: number[];
  latencyMs: number;
  validationErrors: string[];
  algorithmicRepairs?: string[];
  providerError: string | null;
}

export type WeeklyPlanningContextualDirectiveV5 = {
  kind: 'provisional_timebox';
  scope: 'current_missing_effort';
};

/**
 * Interaction architecture: the planning delta of every semantic response was unusable, but
 * the model's typed conversation act (explain / topic shift / resume / consultation) was
 * valid. The turn proceeds as a non-mutating conversation turn with an empty delta.
 */
export interface WeeklyPlanningConversationOnlyTurnV5 {
  /** Why no planning delta was usable. */
  planningDelta: 'rejected' | 'provider_failure';
  /** The rejected response carried planning content, which was not applied. */
  planningContentPresent: boolean;
  actSource: 'initial' | 'repair';
}

export interface WeeklyPlanningSemanticNormalizerResultV5 {
  status: 'accepted' | 'rejected' | 'provider_failure';
  /** Interaction-only: a lossy completeness retry retained its valid initial meaning. */
  completenessAbstention?: WeeklyPlanningSemanticCompletenessAbstentionV5;
  document: WeeklyPlanningSemanticDocumentV5 | null;
  contextualDirective?: WeeklyPlanningContextualDirectiveV5 | null;
  /** Present only when the accepted document is conversation acts without a planning delta. */
  conversationOnly?: WeeklyPlanningConversationOnlyTurnV5;
  diagnostics: WeeklyPlanningSemanticNormalizerDiagnosticsV5;
}

export interface WeeklyPlanningSemanticNormalizerV5 {
  normalize(
    input: WeeklyPlanningSemanticNormalizerInputV5,
  ): Promise<WeeklyPlanningSemanticNormalizerResultV5>;
}
