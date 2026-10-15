import { canonicalCandidateSerialization, freezeCandidateValue } from './candidateSelection/canonical';
import { snapshotCandidateBasis } from './candidateSelection/manifest';
import type { CandidateBinding } from './candidateSelection/contracts';
import type { ControlledCandidateQuestionSnapshot, ControlledCandidateDomain } from './weeklyPlanningControlledCandidateDomains';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { decodeC5Ledger } from './c5LocalSelection/basis';

export const CONTROLLED_CANDIDATE_SESSION_CAPABILITY = 'controlled-candidate-question-v1' as const;
const codes = { d5_numeric: 'missing_effort_estimate', availability_date: 'missing_availability_date_scope' } as const;
/** Readability supplies data, never a staged selection or an opaque receipt. */
export function decodeControlledCandidateQuestion(value: unknown, ownerId: string, conversationId: string): ControlledCandidateQuestionSnapshot | null {
  try {
    const v = freezeCandidateValue(value) as unknown as ControlledCandidateQuestionSnapshot;
    if (!v || Object.keys(v).sort().join() !== 'basis,domainData,domainId,domainPolicyVersion,payloadSerialization,version'
      || v.version !== 1 || !(v.domainId in codes) || typeof v.domainPolicyVersion !== 'string' || !v.domainPolicyVersion.trim()
      || typeof v.domainData !== 'object' || !v.domainData || Array.isArray(v.domainData)) return null;
    const basis = snapshotCandidateBasis(v.basis);
    if (basis.binding.ownerId !== ownerId || basis.binding.conversationId !== conversationId
      || basis.binding.question.code !== codes[v.domainId] || !basis.binding.question.presentedQuestion) return null;
    const { payloadSerialization, ...payload } = v;
    return canonicalCandidateSerialization(payload) === payloadSerialization ? v : null;
  } catch { return null; }
}
export function freezeControlledCandidateQuestion(domain: ControlledCandidateDomain, basis: ControlledCandidateQuestionSnapshot['basis'], domainData: ControlledCandidateQuestionSnapshot['domainData']): ControlledCandidateQuestionSnapshot {
  const payload = { version: 1 as const, domainId: domain.domainId, domainPolicyVersion: domain.domainPolicyVersion,
    basis: snapshotCandidateBasis(basis), domainData };
  const frozen = freezeCandidateValue({ ...payload, payloadSerialization: canonicalCandidateSerialization(payload) }) as unknown as ControlledCandidateQuestionSnapshot;
  if (!decodeControlledCandidateQuestion(frozen, basis.binding.ownerId, basis.binding.conversationId)) throw new Error('Invalid controlled question payload.');
  return frozen;
}
export function validControlledCandidateSessionRecords(state: PlanningIntakeState | undefined, ownerId: string, conversationId: string): boolean {
  const raw = state?.lastQuestionContext?.controlledCandidate;
  if (state?.controlledCandidateProtocolVersion !== undefined && (state.controlledCandidateProtocolVersion !== 1
    || !decodeC5Ledger(state.c5SelectionLedger, ownerId, conversationId))) return false;
  if (raw === undefined) return true;
  if (state?.controlledCandidateProtocolVersion !== 1) return false;
  const decoded = decodeControlledCandidateQuestion(raw, ownerId, conversationId);
  const ledger = decodeC5Ledger(state?.c5SelectionLedger, ownerId, conversationId);
  const context = state?.lastQuestionContext;
  return Boolean(decoded && ledger && context && questionMatchesContext(decoded.basis.binding, context)
    && decoded.basis.binding.selectionEpoch === ledger.lastEpoch);
}
function questionMatchesContext(binding: CandidateBinding, context: NonNullable<PlanningIntakeState['lastQuestionContext']>): boolean {
  const q = binding.question; const p = context.presentation;
  return context.actionId === q.id && context.topicId === binding.target.id
    && p?.graphRevision === binding.graphRevision && p.turnId === q.presentingTurnId
    && p.assistantMessageId === q.presentingMessageId && p.planningStateRevision === q.presentationRevision;
}
