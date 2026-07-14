import { describe, expect, it } from 'vitest';
import type { AssumptionProposalRecord } from '../intake/weeklyPlanningAssumptionProposals';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import {
  applyAssumptionDecision,
  applyCorrectionEnvelopes,
  validateAssumptionDecisionCommand,
} from './weeklyPlanningAssumptionLifecycle';

const context = {
  conversationId: 'conversation-1',
  turnId: 'turn-5',
  currentStateRevision: 4,
};

function pendingRecord(overrides: Partial<AssumptionProposalRecord> = {}): AssumptionProposalRecord {
  return {
    proposalId: 'proposal-1',
    conversationId: 'conversation-1',
    slot: 'duration',
    targetRef: 'task:0',
    proposedValue: 90,
    proposedUnit: 'minutes',
    reasonCode: 'missing_duration',
    sourceFactRefs: ['task:0'],
    createdAtTurnId: 'turn-3',
    createdFromStateRevision: 3,
    status: 'pending',
    ...overrides,
  };
}

describe('weeklyPlanningAssumptionLifecycle', () => {
  it('accepts only a current pending proposal and preserves history', () => {
    const record = pendingRecord();
    const validation = validateAssumptionDecisionCommand({
      type: 'accept_assumption',
      proposalId: record.proposalId,
      expectedStateRevision: 4,
      sourceText: 'その仮定で進めて',
      confidence: 'high',
    }, [record], context);

    expect(validation.accepted).toBe(true);
    const result = applyAssumptionDecision({ records: [record], validation, context });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].status).toBe('accepted');
    expect(result.records[0].decidedAtTurnId).toBe('turn-5');
    expect(result.records[0].resolvedBy?.kind).toBe('fact');
    expect(result.acceptedFact?.value).toBe(90);
    expect(record.status).toBe('pending');
  });

  it('rejects stale and non-pending decisions', () => {
    const stale = validateAssumptionDecisionCommand({
      type: 'reject_assumption',
      proposalId: 'proposal-1',
      expectedStateRevision: 3,
      sourceText: '違います',
      confidence: 'high',
    }, [pendingRecord()], context);
    expect(stale).toEqual({ accepted: false, reason: 'invalid-decision-shape' });

    const decided = validateAssumptionDecisionCommand({
      type: 'reject_assumption',
      proposalId: 'proposal-1',
      expectedStateRevision: 4,
      sourceText: '違います',
      confidence: 'high',
    }, [pendingRecord({ status: 'accepted' })], context);
    expect(decided).toEqual({ accepted: false, reason: 'proposal-not-pending' });
  });

  it('supersedes the old record and creates a replacement proposal on modify', () => {
    const record = pendingRecord();
    const validation = validateAssumptionDecisionCommand({
      type: 'modify_assumption',
      proposalId: record.proposalId,
      expectedStateRevision: 4,
      replacementValue: 60,
      replacementUnit: 'minutes',
      sourceText: '60分にして',
      confidence: 'high',
    }, [record], context);
    const result = applyAssumptionDecision({ records: [record], validation, context });

    expect(result.records).toHaveLength(2);
    expect(result.records[0].status).toBe('superseded');
    expect(result.records[0].resolvedBy?.kind).toBe('proposal');
    expect(result.replacementProposal?.status).toBe('pending');
    expect(result.replacementProposal?.proposedValue).toBe(60);
  });

  it('applies independent correction envelopes and expires related proposals atomically', () => {
    const state = {
      ...createInitialPlanningIntakeState(),
      tasks: [
        {
          title: '数学',
          unit: 'hours' as const,
          amount: 2,
          rawText: '数学を2時間',
          requiresTimeEstimate: false,
          source: 'command' as const,
        },
        {
          title: '英語',
          unit: 'hours' as const,
          amount: 1,
          rawText: '英語を1時間',
          requiresTimeEstimate: false,
          source: 'command' as const,
        },
      ],
      sourceTurns: ['turn-1', 'turn-2', 'turn-3', 'turn-4'],
    };
    const result = applyCorrectionEnvelopes({
      state,
      records: [pendingRecord()],
      context,
      envelopes: [
        {
          correctionId: 'correction-remove-math',
          conversationId: 'conversation-1',
          expectedStateRevision: 4,
          operation: 'remove',
          target: { kind: 'task', taskRef: 'task:0' },
          sourceText: '数学は外して',
        },
        {
          correctionId: 'correction-ambiguous',
          conversationId: 'conversation-1',
          expectedStateRevision: 4,
          operation: 'remove',
          target: { kind: 'accepted_fact', factRef: 'night-block' },
          sourceText: '夜の分も動かして',
        },
      ],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.state.tasks.map((task) => task.title)).toEqual(['英語']);
    expect(result.records[0].status).toBe('expired');
    expect(result.previewStale).toBe(true);
    expect(result.state.draftGenerationIntent).toBe('not_requested');
  });
});
