export const LEARNING_CONSULTATION_TURN_PURPOSE_VERSION = 'learning-consultation-turn-purpose.v1' as const;
export const LEARNING_CONSULTATION_ANSWER_VERSION = 'learning-consultation-answer.v1' as const;
export const LEARNING_CONSULTATION_FINGERPRINT_VERSION = 'learning-consultation-fingerprint.v1' as const;

export type TurnPurposeKind =
  | 'planning_operation'
  | 'learning_consultation'
  | 'consultation_review'
  | 'consultation_followup'
  | 'unresolved';

export interface TurnPurposeDocument {
  schemaVersion: typeof LEARNING_CONSULTATION_TURN_PURPOSE_VERSION;
  kind: TurnPurposeKind;
}

export type ActiveInteractionKind =
  | 'planning_clarification'
  | 'consultation_clarification'
  | 'consultation_review'
  | 'preview_approval';

export interface ActiveInteractionClaim {
  kind: ActiveInteractionKind;
  targetId: string;
  expectedRevision: number | null;
}

export type ActiveInteractionProjection =
  | { kind: 'none' }
  | ({ kind: ActiveInteractionKind } & Omit<ActiveInteractionClaim, 'kind'>)
  | { kind: 'conflict'; claims: readonly ActiveInteractionClaim[] };

export type ContextSourceRequirement = 'required' | 'optional';
export type ContextSourceStatus = 'available' | 'empty' | 'unavailable' | 'omitted' | 'stale';

export interface ContextSourceEnvelope<T = unknown> {
  sourceDomain: string;
  sourceIdentity: string;
  requirement: ContextSourceRequirement;
  status: ContextSourceStatus;
  sourceBasis: string | null;
  semanticDigest: string | null;
  observedAt: string;
  authority: string;
  items: readonly T[];
}

export interface DeterministicSignal {
  signalId: string;
  kind: string;
  value: string | number | boolean;
  unit: string | null;
  basisRefs: readonly string[];
  calculationVersion: string;
}

export interface ContextFingerprintInput {
  requestTemporalContext: RequestTemporalContext;
  sources: readonly ContextSourceEnvelope[];
  deterministicSignals: readonly DeterministicSignal[];
  evidenceDigests: readonly string[];
  materialBindingBasis: readonly string[];
}

export interface ContextFingerprint {
  version: typeof LEARNING_CONSULTATION_FINGERPRINT_VERSION;
  digest: string;
  canonicalBasis: string;
}

export interface RequestTemporalContext {
  currentDate: string;
  currentDateTime: string;
  timezone: string;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  authoritativeDates: Readonly<Record<string, string>>;
}

export type TemporalCandidate =
  | { kind: 'absolute_date'; date: string }
  | { kind: 'month_end'; year: number; month: number }
  | { kind: 'relative_to_exam'; examRef: string; offsetDays: number }
  | { kind: 'date_range'; startDate: string; endDate: string };

export interface TemporalResolution {
  candidate: TemporalCandidate;
  canonicalStartDate: string;
  canonicalEndDate: string;
  basis: string;
  resolvedAtDate: string;
}

export interface MaterialMention {
  name: string;
  editionHint?: string;
  isbnHint?: string;
  whyRelevant: string;
}

export type AdviceUncertainty = 'low' | 'medium' | 'high';

export interface AdviceRecommendation {
  recommendationKind: string;
  materialMention?: MaterialMention;
  method?: string;
  sequencePosition?: number;
  milestone?: string;
  temporalTarget?: TemporalCandidate;
  rationale: string;
  assumptionRefs: readonly string[];
  evidenceRefs: readonly string[];
  uncertainty: AdviceUncertainty;
}

export interface AdviceOption {
  title: string;
  strategySummary: string;
  recommendations: readonly AdviceRecommendation[];
  tradeoffs: readonly string[];
}

export interface ProposalAnswer {
  schemaVersion: typeof LEARNING_CONSULTATION_ANSWER_VERSION;
  kind: 'proposal';
  userFacingAnswer: string;
  options: readonly AdviceOption[];
  assumptions: readonly string[];
  overallUncertainty: AdviceUncertainty;
}

export interface ClarificationAnswer {
  schemaVersion: typeof LEARNING_CONSULTATION_ANSWER_VERSION;
  kind: 'clarification';
  userFacingAnswer: string;
  requestedMeaning: string;
  whyItMatters: string;
  allowedUnknown: true;
}

export interface ExplanationAnswer {
  schemaVersion: typeof LEARNING_CONSULTATION_ANSWER_VERSION;
  kind: 'explanation';
  userFacingAnswer: string;
  rationale: string;
  assumptionRefs: readonly string[];
  evidenceRefs: readonly string[];
  tradeoffs: readonly string[];
  historical: boolean;
}

export type AdviceAnswerDocument = ProposalAnswer | ClarificationAnswer | ExplanationAnswer;

export interface MaterialBinding {
  mentionKey: string;
  status: 'registered_material' | 'verified_catalog_material' | 'ambiguous' | 'unresolved_material';
  canonicalMaterialId: string | null;
  basis: string;
}

export interface AdviceProposal {
  adviceId: string;
  consultationId: string;
  revision: number;
  sourceQuestionTurnId: string;
  supersedes: string | null;
  supersededBy: string | null;
  answer: ProposalAnswer;
  contextFingerprint: ContextFingerprint;
  temporalResolutions: readonly TemporalResolution[];
  materialBindings: readonly MaterialBinding[];
  createdAt: string;
}

export type ReviewAction = 'approve' | 'request_revision' | 'request_alternative' | 'dismiss';
export type ReviewTargetScope =
  | { kind: 'proposal' }
  | { kind: 'option'; optionIndex: number };

export interface ReviewDecision {
  decisionId: string;
  consultationId: string;
  targetAdviceId: string;
  expectedAdviceRevision: number;
  expectedConsultationRevision: number;
  targetScope: ReviewTargetScope;
  action: ReviewAction;
  feedback: string | null;
  sourceTurnId: string;
  decidedAt: string;
}

export interface ValidityCheck {
  checkId: string;
  targetAdviceId: string;
  expectedAdviceRevision: number;
  fingerprint: ContextFingerprint;
  outcome: 'current' | 'stale' | 'non_revalidatable';
  checkedAt: string;
}

export interface PromotionOperation {
  operationId: string;
  sourceDecisionId: string;
  targetAdviceId: string;
  expectedAdviceRevision: number;
  expectedConsultationRevision: number;
  expectedFingerprint: ContextFingerprint;
}

export interface PromotionReceipt {
  operationId: string;
  committedAt: string;
}

export interface PendingConsultationClarification {
  clarificationId: string;
  sourceTurnId: string;
  requestedMeaning: string;
  createdAt: string;
}

export interface ConsultationSessionState {
  consultationId: string;
  ownerId: string;
  conversationId: string;
  revision: number;
  lifecycle: 'active' | 'closed';
  activeAdviceId: string | null;
  activeAdviceRevision: number | null;
  proposals: readonly AdviceProposal[];
  reviewDecisions: readonly ReviewDecision[];
  validityChecks: readonly ValidityCheck[];
  promotionOperations: readonly PromotionOperation[];
  promotionReceipts: readonly PromotionReceipt[];
  pendingClarification: PendingConsultationClarification | null;
}

export interface PromotionRecommendation {
  recommendationKey: string;
  planningRelevant: boolean;
}

export interface PromotionDisposition {
  recommendationKey: string;
  disposition: 'mapped' | 'advisory_only' | 'blocked';
  reason: string | null;
}
