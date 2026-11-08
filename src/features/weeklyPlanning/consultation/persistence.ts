// The stored shape of a consultation inside a VNext session checkpoint (#246 slice 3). This reader runs before any
// producer writes the field, so an older writer's checkpoint without it reads as an empty consultation and a
// malformed one is refused whole (fail closed, never repaired). Pure: it imports only the consultation contracts.
// What is stored is deliberately small: the active leaf and a few earlier proposals, their one-shot reviews, nothing else.
import {
  LEARNING_CONSULTATION_FINGERPRINT_VERSION,
  type AdviceProposal,
  type ConsultationSessionState,
  type ProposalAnswer,
  type ReviewDecision,
} from './contracts';
import { validateAdviceAnswerDocument, type ValidationResult } from './validation';

/** The active leaf plus at most three earlier proposals. */
export const CONSULTATION_MAX_PROPOSALS = 4;
/** One stored proposal, serialized (a typical two-option answer is 2.5-3.5 KB). The whole checkpoint is bounded separately. */
export const CONSULTATION_MAX_PROPOSAL_BYTES = 4096;
const MAX_ID_LENGTH = 128;
const MAX_FEEDBACK_LENGTH = 500;
const MAX_DERIVED_RECORD_IDS = 30;

/** No freshness is evaluated in this slice, so every stored proposal carries this one fingerprint. */
export const CONSULTATION_NO_FRESHNESS_FINGERPRINT = {
  version: LEARNING_CONSULTATION_FINGERPRINT_VERSION, digest: 'none', canonicalBasis: 'slice3-no-freshness-check',
} as const;

/** What a withdrawn proposal keeps in place of its answer: none of the model's words, none of the memory's. */
export const CONSULTATION_WITHDRAWN_ANSWER: ProposalAnswer = {
  schemaVersion: 'learning-consultation-answer.v1', kind: 'proposal', userFacingAnswer: '削除された記憶に基づく助言のため、内容を消しました。',
  options: [{ title: '削除済み', strategySummary: '削除済み', tradeoffs: [], recommendations: [{
    recommendationKind: 'withdrawn', rationale: '削除済み', assumptionRefs: [], evidenceRefs: [], uncertainty: 'high' }] }],
  assumptions: [], overallUncertainty: 'high',
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every(key => key in value) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const isId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isTimestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function fail<T>(reason: string): ValidationResult<T> { return { ok: false, errors: [reason] }; }

function validProposal(value: unknown, state: { consultationId: string }): AdviceProposal | string {
  if (!isRecord(value) || !hasExactKeys(value, ['adviceId', 'consultationId', 'revision', 'sourceQuestionTurnId', 'supersedes', 'supersededBy',
    'answer', 'contextFingerprint', 'temporalResolutions', 'materialBindings', 'createdAt'], ['derivedFromRecordIds', 'withdrawnAt'])) return 'proposal shape';
  if (!isId(value.adviceId) || value.consultationId !== state.consultationId || !isCount(value.revision) || value.revision < 1
    || !isId(value.sourceQuestionTurnId) || !(value.supersedes === null || isId(value.supersedes)) || !(value.supersededBy === null || isId(value.supersededBy))
    || !isTimestamp(value.createdAt)) return 'proposal fields';
  if (!isRecord(value.contextFingerprint) || !hasExactKeys(value.contextFingerprint, ['version', 'digest', 'canonicalBasis'])
    || !sameJson(value.contextFingerprint, CONSULTATION_NO_FRESHNESS_FINGERPRINT)) return 'proposal fingerprint';
  // Nothing in this slice resolves a date or a material, so a stored proposal carries none.
  if (!Array.isArray(value.temporalResolutions) || value.temporalResolutions.length !== 0
    || !Array.isArray(value.materialBindings) || value.materialBindings.length !== 0) return 'proposal bindings';
  const derived = value.derivedFromRecordIds;
  if (derived !== undefined && (!Array.isArray(derived) || derived.length > MAX_DERIVED_RECORD_IDS || !derived.every(isId)
    || new Set(derived).size !== derived.length)) return 'proposal derivedFromRecordIds';
  if (value.withdrawnAt !== undefined && !isTimestamp(value.withdrawnAt)) return 'proposal withdrawnAt';
  if (byteLength(value) > CONSULTATION_MAX_PROPOSAL_BYTES) return 'proposal size';
  // The answer goes through the contract's own validator; no evidence reference can be genuine here.
  const answer = validateAdviceAnswerDocument(value.answer, { allowedEvidenceRefs: [] });
  if (!answer.ok || answer.value.kind !== 'proposal') return 'proposal answer';
  // A withdrawn proposal keeps none of the words: its answer is exactly the placeholder.
  if (value.withdrawnAt !== undefined && !sameJson(value.answer, CONSULTATION_WITHDRAWN_ANSWER)) return 'withdrawn proposal keeps words';
  return value as unknown as AdviceProposal;
}

function validDecision(value: unknown, state: { consultationId: string; revision: number }): ReviewDecision | string {
  if (!isRecord(value) || !hasExactKeys(value, ['decisionId', 'consultationId', 'targetAdviceId', 'expectedAdviceRevision',
    'expectedConsultationRevision', 'targetScope', 'action', 'feedback', 'sourceTurnId', 'decidedAt'])) return 'decision shape';
  const scope = value.targetScope;
  const scopeOk = isRecord(scope) && ((scope.kind === 'proposal' && hasExactKeys(scope, ['kind']))
    || (scope.kind === 'option' && hasExactKeys(scope, ['kind', 'optionIndex']) && isCount(scope.optionIndex)));
  if (!isId(value.decisionId) || value.consultationId !== state.consultationId || !isId(value.targetAdviceId)
    || !isCount(value.expectedAdviceRevision) || !isCount(value.expectedConsultationRevision) || value.expectedConsultationRevision >= state.revision
    || !scopeOk || !['approve', 'request_revision', 'request_alternative', 'dismiss'].includes(value.action as string)
    || !(value.feedback === null || (typeof value.feedback === 'string' && value.feedback.length <= MAX_FEEDBACK_LENGTH))
    || !isId(value.sourceTurnId) || !isTimestamp(value.decidedAt)) return 'decision fields';
  return value as unknown as ReviewDecision;
}

/** Deep validation of a stored consultation against the conversation it is stored in. */
export function validateConsultationSessionState(value: unknown, scope: { ownerId: string; conversationId: string }): ValidationResult<ConsultationSessionState> {
  if (!isRecord(value) || !hasExactKeys(value, ['consultationId', 'ownerId', 'conversationId', 'revision', 'lifecycle', 'activeAdviceId',
    'activeAdviceRevision', 'proposals', 'reviewDecisions', 'validityChecks', 'promotionOperations', 'promotionReceipts', 'pendingClarification'])) {
    return fail('consultation shape');
  }
  if (!isId(value.consultationId) || value.ownerId !== scope.ownerId || value.conversationId !== scope.conversationId || !isCount(value.revision)
    || (value.lifecycle !== 'active' && value.lifecycle !== 'closed')) return fail('consultation fields');
  // Freshness checks, promotion and clarification are not produced yet; a stored one is from a writer this reader does not know.
  for (const empty of ['validityChecks', 'promotionOperations', 'promotionReceipts'] as const) {
    if (!Array.isArray(value[empty]) || (value[empty] as unknown[]).length !== 0) return fail(`${empty} not supported`);
  }
  if (value.pendingClarification !== null) return fail('pendingClarification not supported');
  if (!Array.isArray(value.proposals) || value.proposals.length > CONSULTATION_MAX_PROPOSALS
    || !Array.isArray(value.reviewDecisions) || value.reviewDecisions.length > CONSULTATION_MAX_PROPOSALS) return fail('consultation size');

  const proposals: AdviceProposal[] = [];
  for (const item of value.proposals) {
    const checked = validProposal(item, { consultationId: value.consultationId });
    if (typeof checked === 'string') return fail(checked);
    proposals.push(checked);
  }
  if (new Set(proposals.map(proposal => proposal.adviceId)).size !== proposals.length) return fail('duplicate advice id');
  const byId = new Map(proposals.map(proposal => [proposal.adviceId, proposal]));
  // Lineage: every reference resolves, is mutual, and the revision counts up along it (so no cycle can exist).
  // A trimmed history makes the oldest kept proposal a root, so a root may carry any revision.
  for (const proposal of proposals) {
    if (proposal.supersedes !== null) {
      const previous = byId.get(proposal.supersedes);
      if (!previous || previous.supersededBy !== proposal.adviceId || proposal.revision !== previous.revision + 1) return fail('lineage supersedes');
    }
    if (proposal.supersededBy !== null) {
      const next = byId.get(proposal.supersededBy);
      if (!next || next.supersedes !== proposal.adviceId) return fail('lineage supersededBy');
    }
  }
  const leaves = proposals.filter(proposal => proposal.supersededBy === null);
  if (leaves.length > 1) return fail('more than one leaf');

  const decisions: ReviewDecision[] = [];
  for (const item of value.reviewDecisions) {
    const checked = validDecision(item, { consultationId: value.consultationId, revision: value.revision });
    if (typeof checked === 'string') return fail(checked);
    const target = byId.get(checked.targetAdviceId);
    if (!target || target.revision !== checked.expectedAdviceRevision) return fail('decision target');
    if (checked.targetScope.kind === 'option' && checked.targetScope.optionIndex >= target.answer.options.length) return fail('decision scope');
    decisions.push(checked);
  }
  if (new Set(decisions.map(decision => decision.decisionId)).size !== decisions.length
    || new Set(decisions.map(decision => decision.targetAdviceId)).size !== decisions.length) return fail('decision identity');

  const { activeAdviceId, activeAdviceRevision } = value;
  if (value.lifecycle === 'closed') {
    if (activeAdviceId !== null || activeAdviceRevision !== null) return fail('closed consultation has an active leaf');
  } else if (activeAdviceId === null || activeAdviceRevision === null) {
    if (activeAdviceId !== null || activeAdviceRevision !== null || proposals.length > 0) return fail('active leaf missing');
  } else {
    const active = byId.get(activeAdviceId as string);
    if (!active || active.revision !== activeAdviceRevision || active.supersededBy !== null) return fail('active leaf');
  }
  if (value.revision < proposals.length + decisions.length) return fail('consultation revision');
  return { ok: true, value: value as unknown as ConsultationSessionState };
}
