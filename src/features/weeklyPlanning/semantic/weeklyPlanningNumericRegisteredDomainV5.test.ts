import { describe, expect, it, vi } from 'vitest';
import type { ControlledCandidateCaptureContext, ControlledCandidateStageContext } from '../application/weeklyPlanningControlledCandidateDomains';
import type { CandidateBasis } from '../application/candidateSelection/contracts';
import { normalizedChoice } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import { numericFixture } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { createNumericPendingRegisteredDomainV5 } from './weeklyPlanningNumericRegisteredDomainV5';

function presenting(measurement: 'total_duration' | 'duration_per_unit' = 'duration_per_unit') {
  const { graph } = numericFixture(measurement);
  const question = {
    id: 'candidate-question:d5_numeric:turn-before:workload-1',
    code: 'missing_effort_estimate',
    presentingTurnId: 'turn-before', presentingMessageId: 'message-before',
    presentationRevision: 5,
    presentedQuestion: { assistantMessageId: 'message-before', text: '数学は1問何分かかりますか？' },
  };
  return {
    ownerId: 'owner-1', conversationId: 'conversation-numeric', graph, question,
    selectionEpoch: 2, domainPolicyVersion: 'fixture-question-domain-v1',
    state: { intakeState: { lastQuestionContext: { topicId: 'workload-1',
      targetSlot: 'stable_v5:missing_effort_estimate', intent: measurement,
      presentation: { graphRevision: 2 } } } },
  } as unknown as ControlledCandidateCaptureContext;
}

describe('D5 real controlled candidate producer', () => {
  it('captures one machine-owned complete scope and a finite menu before the user replies', () => {
    const domain = createNumericPendingRegisteredDomainV5([2, 3, 5, 10], 'fixture-question-domain-v1');
    const frozen = domain.capture(presenting());
    expect(frozen).not.toBeNull();
    expect(frozen?.target).toEqual({ kind: 'workload', id: 'workload-1' });
    expect(frozen?.candidates.map(c => c.tuple.minutes)).toEqual([2, 3, 5, 10]);
    expect(frozen?.scope).toMatchObject({ amount: 10, unitCode: 'problem', task: { title: '数学' } });
    expect(frozen?.domainData).toMatchObject({
      domainMinutes: [2, 3, 5, 10], measurement: 'duration_per_unit', perUnit: 'problem',
    });
    expect(JSON.stringify(frozen)).not.toContain('問題を10問進める');
  });
  it('stages a complete bound minute choice with the original whole text and no generative dispatch', async () => {
    const presentingContext = presenting();
    const domain = createNumericPendingRegisteredDomainV5([2, 3, 5, 10], 'fixture-question-domain-v1');
    const captured = domain.capture(presentingContext)!;
    expect(captured).not.toBeNull();
    const fixture = numericFixture('duration_per_unit');
    fixture.input.userText = '1問3分です';
    fixture.input.traceRequestId = 'answer-request';
    const pending = fixture.input.publicStateSummary!.pendingQuestion as Record<string, unknown>;
    pending.actionId = presentingContext.question.id;
    const binding: CandidateBasis['binding'] = {
      ownerId: 'owner-1', conversationId: 'conversation-numeric',
      requestId: 'answer-request', inputRevision: 5, graphRevision: 2,
      sources: captured.sources, target: captured.target, scope: captured.scope,
      question: presentingContext.question, selectionEpoch: 2,
    };
    const basis = { binding, candidates: captured.candidates };
    const ledger = { version: 1 as const, ownerId: binding.ownerId, conversationId: binding.conversationId,
      lastEpoch: 2, consumed: [] };
    const current = { intakeState: { c5SelectionLedger: ledger }, messages: [
      { id: presentingContext.question.presentingMessageId, role: 'assistant',
        content: presentingContext.question.presentedQuestion!.text },
    ] };
    const choose = vi.fn(async (request: Parameters<ControlledCandidateStageContext['choose']>[0], dispatch: () => void) => {
      dispatch();
      return normalizedChoice(request, 'leaf:1');
    });
    const context = {
      frozen: { domainId: 'd5_numeric', domainPolicyVersion: domain.domainPolicyVersion,
        basis, domainData: captured.domainData },
      basis, userText: fixture.input.userText, normalizerInput: fixture.input,
      pending: { requestId: 'answer-request', turnId: 'answer-turn', baseRevision: 5 },
      snapshot: current,
      policy: { id: 'synthetic-v1', calibrationEvidenceId: 'synthetic-only', rules: [
        { menuKind: 'leaves', optionCount: 5, depth: 0, minimumTopProbability: 0.98, minimumMargin: 0.90 },
      ] },
      maximumChildrenPerMenu: 16, maximumDecisions: 1,
      readRequestContext: () => ({}),
      sourceAccess: () => 'allowed',
      readCommittedGraph: () => fixture.graph,
      readCurrentState: () => current,
      readLedger: () => ledger,
      choose,
      observeCurrentBasis: () => ({ ...basis, sourceAccess: 'allowed', intentProvenance: 'validated_current_turn',
        questionPresentation: 'fresh', targetStatus: 'active', formalEligibility: 'eligible' }),
      prepareLocalCandidateReducerCommit: vi.fn(() => null),
    } as unknown as ControlledCandidateStageContext;
    const staged = await domain.stage(context);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(staged).not.toBeNull();
    expect(staged?.branch).toBe('d5_pending_selection');
    expect(staged?.semanticContribution.document.tasks[0].effortEstimates[0]).toMatchObject({
      minutes: 3, kind: 'duration_per_unit', unitCode: 'problem', precision: 'exact',
    });
    expect(staged?.selected.graph.effortEstimates).toHaveLength(1);
    expect(validateWeeklyPlanningSemanticValueV5(staged!.semanticContribution.document).errors).toEqual([]);
  });

  it('declines unsupported question types, malformed finite domains and stale scope', () => {
    const valid = presenting();
    const domain = createNumericPendingRegisteredDomainV5([2, 3, 5], 'fixture-question-domain-v1');
    const missingIntent = structuredClone(valid);
    delete missingIntent.state.intakeState?.lastQuestionContext?.intent;
    expect(domain.capture(missingIntent)).toBeNull();
    expect(createNumericPendingRegisteredDomainV5([0, 3], 'fixture-question-domain-v1').capture(valid)).toBeNull();
    const stale = structuredClone(valid);
    stale.graph.revision += 1;
    expect(domain.capture(stale)).toBeNull();
  });
});
