import { expect, it, vi } from 'vitest';
import type { ControlledCandidateCaptureContext, ControlledCandidateStageContext } from '../application/weeklyPlanningControlledCandidateDomains';
import { createTemporalDateRegisteredDomainV5 } from './weeklyPlanningTemporalDateRegisteredDomainV5';
import { temporalDateFixtureV5 } from './weeklyPlanningTemporalDateChoiceV5.testUtils';
import { normalizedChoice } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import { createCandidateManifest, projectCandidateProviderContext } from '../application/candidateSelection/manifest';

function captureContext() {
  const f = temporalDateFixtureV5();
  const question = { ...f.binding.question,
    presentedQuestion: { assistantMessageId: f.binding.question.presentingMessageId,
      text: '18時から20時の予定は何日にありますか？' } };
  const context = {
    graph: f.graph, ownerId: f.binding.ownerId, conversationId: f.binding.conversationId,
    selectionEpoch: f.binding.selectionEpoch, question,
    requestContext: { currentDate: '2026-10-05', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
    state: { intakeState: { lastQuestionContext: {
      targetSlot: 'stable_v5:missing_availability_date_scope', topicId: f.target.id,
      presentation: { graphRevision: f.graph.revision },
    } } },
    messages: [],
  } as unknown as ControlledCandidateCaptureContext;
  return { f, context };
}

it('captures the existing typed single-date question as complete immutable leaves', async () => {
  const { f, context } = captureContext();
  const domain = createTemporalDateRegisteredDomainV5();
  const captured = domain.capture(context);
  expect(captured).not.toBeNull();
  expect(captured?.target).toEqual({ kind: 'availability_declaration', id: f.target.id });
  expect(captured?.candidates.map(x => x.tuple.dateExpression)).toEqual([
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
    '2026-10-09', '2026-10-10', '2026-10-11',
  ]);
  expect(captured?.scope).toMatchObject({ startTime: '18:00', endTime: '20:00',
    kind: 'unavailable', timeZone: 'Asia/Tokyo' });
  const manifest = await createCandidateManifest({ binding: { ...f.binding,
    question: context.question, scope: captured!.scope, sources: captured!.sources,
    target: captured!.target }, candidates: captured!.candidates });
  expect(JSON.stringify(projectCandidateProviderContext(manifest))).not.toContain(f.target.source.sourceText);
  const changed = structuredClone(context);
  changed.state.intakeState!.lastQuestionContext!.topicId = 'wrong-id';
  expect(domain.capture(changed)).toBeNull();
});

function stageFixture() {
  const { f, context: presenting } = captureContext();
  const domain = createTemporalDateRegisteredDomainV5();
  const captured = domain.capture(presenting)!;
  expect(captured).not.toBeNull();
  const binding = { ...f.binding, question: presenting.question,
    sources: captured.sources, scope: captured.scope,
    inputRevision: 5, requestId: f.input.traceRequestId };
  const basis = { binding, candidates: captured.candidates };
  const ledger = { version: 1 as const, ownerId: binding.ownerId, conversationId: binding.conversationId,
    lastEpoch: binding.selectionEpoch, consumed: [] };
  const state = { intakeState: { c5SelectionLedger: ledger },
    messages: [{ role: 'assistant', id: binding.question.presentingMessageId,
      content: binding.question.presentedQuestion!.text }] };
  const choose = vi.fn(async (request: Parameters<ControlledCandidateStageContext['choose']>[0],
    beforeDispatch: () => void) => {
    beforeDispatch();
    return normalizedChoice(request, 'leaf:2');
  });
  let sourceAccess: 'allowed' | 'denied' = 'allowed';
  const stage = {
    frozen: { domainId: domain.domainId, domainPolicyVersion: domain.domainPolicyVersion,
      basis, domainData: captured.domainData },
    snapshot: state, pending: { requestId: f.input.traceRequestId, turnId: 'answer-turn', baseRevision: 5 },
    basis, userText: f.input.userText, normalizerInput: f.input,
    policy: { id:'synthetic-date-test', calibrationEvidenceId:'scripted-only', rules: [
      {menuKind:'leaves',optionCount:8,depth:0,minimumTopProbability:0.9,minimumMargin:0.8},
    ] },
    maximumChildrenPerMenu: 9, maximumDecisions: 1,
    choose, readCurrentState: () => state, readCommittedGraph: () => f.graph,
    readRequestContext: () => ({currentDate:'2026-10-05',timeZone:'Asia/Tokyo',weekStartsOn:'monday'}),
    readLedger: () => ledger, sourceAccess: () => sourceAccess,
    observeCurrentBasis: () => ({...basis,sourceAccess,intentProvenance:'validated_current_turn',
      questionPresentation:'fresh',targetStatus:'active',formalEligibility:'eligible'}),
    prepareLocalCandidateReducerCommit: vi.fn(() => null),
  } as unknown as ControlledCandidateStageContext;
  return { f, domain, stage, choose, deny: () => { sourceAccess = 'denied'; } };
}

it('stages one frozen date through the native controlled commit, without creating permission to save', async () => {
  const { f, domain, stage, choose } = stageFixture();
  const result = await domain.stage(stage);
  expect(choose).toHaveBeenCalledTimes(1);
  expect(result).not.toBeNull();
  expect(result?.branch).toBe('temporal_date_selection');
  expect(result?.semanticContribution.document.availabilityDeclarations[0]).toMatchObject({
    dateExpression: '2026-10-07', startTime: '18:00', endTime: '20:00',
    kind: 'unavailable', constraintLevel: 'hard',
  });
  expect(result?.selected.graph.availabilityDeclarations).toHaveLength(2);
  expect(result?.selected.graph.availabilityDeclarations[0].id).toBe(f.target.id);
  expect(result?.prepare()).toBeNull(); // No opaque reducer receipt in this isolated port fixture.
});

it('fails closed before provider exposure when the source owner becomes unavailable', async () => {
  const { domain, stage, choose, deny } = stageFixture();
  deny();
  expect(await domain.stage(stage)).toBeNull();
  expect(choose).not.toHaveBeenCalled();
});
