import { describe, expect, it } from 'vitest';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { serializeWeeklyPlanningVNextSessionCheckpoint } from '../application/weeklyPlanningVNextSessionCheckpoint';
import { MAX_CONVERSATION_SYNC_BYTES, validateConversationPayload, validateLocalConversationPayload } from './weeklyPlanningConversationPayload';
import { CONSULTATION_MAX_PROPOSALS, CONSULTATION_MAX_PROPOSAL_BYTES, CONSULTATION_NO_FRESHNESS_FINGERPRINT, commitAdviceProposal, createConsultationSession } from '../../consultation';
import type { ConversationPayload, ConversationScope } from './weeklyPlanningConversationSync';

const scope: ConversationScope = { ownerId: 'owner', chatId: 'ai-chat-payload', weekStartDate: '2026-11-02', conversationId: 'conversation' };
/** The largest consultation the reader accepts: four proposals, each at the size bound. */
function fullConsultation() {
  let state = createConsultationSession({ consultationId: 'consultation-1', ownerId: scope.ownerId, conversationId: scope.conversationId });
  for (let index = 0; index < CONSULTATION_MAX_PROPOSALS; index += 1) {
    const filler = 'あ'.repeat(Math.floor(CONSULTATION_MAX_PROPOSAL_BYTES / 3) - 400);
    const result = commitAdviceProposal(state, { adviceId: `advice-${index}`, expectedConsultationRevision: state.revision, sourceQuestionTurnId: `turn-${index}`,
      contextFingerprint: CONSULTATION_NO_FRESHNESS_FINGERPRINT, createdAt: '2026-11-07T00:00:00.000Z',
      answer: { schemaVersion: 'learning-consultation-answer.v1', kind: 'proposal', userFacingAnswer: filler, assumptions: [], overallUncertainty: 'low',
        options: [{ title: '案', strategySummary: '案', tradeoffs: [], recommendations: [{ recommendationKind: 'study_method', rationale: '理由', assumptionRefs: [], evidenceRefs: [], uncertainty: 'low' }] }] } });
    if (!result.accepted) throw new Error(result.reason);
    state = result.state;
  }
  return state;
}
function payload(consultation?: unknown): ConversationPayload {
  const state = createInitialPlanningState(scope.weekStartDate);
  state.messages = [{ id: 'message', role: 'user', content: '数学を1時間', createdAt: '2026-11-07T00:00:00.000Z' }];
  const core = serializeWeeklyPlanningVNextSessionCheckpoint({ ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId,
    vnext: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [],
      ...(consultation ? { consultation: consultation as never } : {}) },
    savedAt: '2026-11-07T00:00:00.000Z' });
  return { core, ui: JSON.stringify({ ownerId: scope.ownerId, conversationId: scope.conversationId, payload: { version: 2, state } }), title: '数学' };
}

describe('cloud conversation payload uses the production readers', () => {
  it('accepts coherent core/UI and a genuinely empty-core conversation', () => {
    expect(validateConversationPayload(scope, payload())).toBe(true);
    expect(validateLocalConversationPayload(scope, payload())).toBe(true);
    expect(validateConversationPayload(scope, { ...payload(), core: null })).toBe(true);
  });
  it('synchronizes a stored consultation (#246) and stays far below the sync limit even when it is full', () => {
    const full = payload(fullConsultation());
    expect(validateConversationPayload(scope, full)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(full)).byteLength).toBeLessThan(MAX_CONVERSATION_SYNC_BYTES / 10);
  });
  it('does not synchronize a damaged consultation or one of another conversation', () => {
    // The writer refuses to produce a damaged consultation, so the damaged bytes are made by hand.
    const damaged = (change: object) => {
      const value = payload(fullConsultation()); const core = JSON.parse(value.core!);
      core.vnext.consultation = { ...core.vnext.consultation, ...change };
      return { ...value, core: JSON.stringify(core) };
    };
    expect(validateConversationPayload(scope, damaged({}))).toBe(true);
    expect(validateConversationPayload(scope, damaged({ conversationId: 'foreign' }))).toBe(false);
    expect(validateConversationPayload(scope, damaged({ activeAdviceId: 'missing' }))).toBe(false);
  });
  it('rejects another owner, conversation, or planning week', () => {
    for (const altered of [{ ownerId: 'foreign' }, { conversationId: 'foreign' }, { weekStartDate: '2026-11-09' }]) {
      expect(validateConversationPayload({ ...scope, ...altered }, payload())).toBe(false);
      expect(validateLocalConversationPayload({ ...scope, ...altered }, payload())).toBe(false);
    }
  });
  it('does not synchronize in-flight turns, approvals or unresolved actual-save recovery', () => {
    for (const field of ['pendingTurn', 'pendingApproval', 'approvalRecovery']) {
      const value = payload(); const ui = JSON.parse(value.ui); ui.payload.state[field] = { status: 'pending' };
      expect(validateConversationPayload(scope, { ...value, ui: JSON.stringify(ui) })).toBe(false);
    }
  });
  it('rejects unknown future capabilities, malformed JSON and oversize bytes without truncating', () => {
    const value = payload(); const core = JSON.parse(value.core!); core.requiredCapabilities = ['unknown-future'];
    expect(validateConversationPayload(scope, { ...value, core: JSON.stringify(core) })).toBe(false);
    expect(validateConversationPayload(scope, { ...value, ui: 'not-json' })).toBe(false);
    expect(validateConversationPayload(scope, { ...value, ui: 'あ'.repeat(MAX_CONVERSATION_SYNC_BYTES) })).toBe(false);
    expect(validateConversationPayload(scope, value)).toBe(true);
  });
});
