import { createCandidateManifest } from './candidateSelection/manifest';
import { selectApplicationCandidate } from './candidateSelection/transaction';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { c5ControllerHarness, OWNER, WEEK } from './c5LocalSelection/controller.testUtils';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { submitWeeklyPlanningControlledTurn } from '../weeklyPlanningTurnController';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { weeklyPlanningTurnRuntimeGateway } from './weeklyPlanningTurnRuntimeGateway';
import { registerControlledCandidateDomain } from './weeklyPlanningControlledCandidateRegistry';
import { decodeControlledCandidateQuestion } from './weeklyPlanningControlledCandidateQuestion';
import type { ControlledCandidateDomain } from './weeklyPlanningControlledCandidateDomains';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { prepareWeeklyPlanningStableV5Checkpoint, serializeWeeklyPlanningStableV5CheckpointWithMessageCount, parseWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionCodec';

let restore: () => void;
beforeEach(() => { resetWeeklyPlanningStableV5RuntimeSessionsForTest(); restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage); });
afterEach(() => { restore(); vi.restoreAllMocks(); });
function setup() {
  const h = c5ControllerHarness(); let access = true;
  const stage = vi.fn<ControlledCandidateDomain['stage']>(async context => {
    expect(context.basis.binding.requestId).toBe(context.pending.requestId);
    expect(context.basis.binding.inputRevision).toBe(context.pending.baseRevision);
    expect(context.normalizerInput.userText).toBe('全文を保持した回答');
    expect(context.normalizerInput.committedGraph).toEqual(h.graph);
    expect(context.sourceAccess()).toBe('allowed');
    const manifest = await createCandidateManifest(context.basis);
    const staged = await selectApplicationCandidate({ manifest, wholeUtterance: context.userText, policy: context.policy,
      maximumChildrenPerMenu: 2, maximumDecisions: 1, readCurrent: () => context.observeCurrentBasis(context.basis), choose: context.choose });
    expect(staged.status).toBe('staged');
    if (staged.status !== 'staged') throw new Error('fake capability unavailable');
    const ledger = context.readLedger()!;
    const receiptInput = { selection: staged.selection, current: context.readCurrentState(), ledger,
      view: { observation: context.observeCurrentBasis(context.basis), ledger: { ownerId: ledger.ownerId, conversationId: ledger.conversationId, consumed: ledger.consumed },
        validateLeaf: () => true }, revalidateFinalized: () => true };
    expect(context.prepareLocalCandidateReducerCommit({ ...receiptInput, selection: structuredClone(staged.selection) })).toBeNull();
    expect(context.prepareLocalCandidateReducerCommit(receiptInput)).not.toBeNull();
    expect(context.readLedger()?.consumed).toEqual([]); // Issuance alone cannot consume or mutate state.
    return null; // This fake proves host registration/gating, not a D5 interpretation or effect.
  });
  const domain: ControlledCandidateDomain = {
    domainId: 'd5_numeric', questionCode: 'missing_effort_estimate', domainPolicyVersion: 'fake-host-proof-only',
    capture: context => ({ target: { kind: 'workload', id: 'work-a' }, scope: { amount: context.graph.workloads[0].amount },
      sources: [{ id: 'work-a', revision: 'fixture-v1' }], candidates: [
        { id: 'five', label: '5', tuple: { minutes: 5 } }, { id: 'seven', label: '7', tuple: { minutes: 7 } },
      ], domainData: { meaning: 'typed fixture only' } }), stage,
  };
  const route = registerControlledCandidateDomain(domain, {
    policy: h.options.policy, maximumChildrenPerMenu: 2, maximumDecisions: 1,
    sourceAccess: () => access ? 'allowed' : 'denied', choose: async (request, beforeDispatch) => {
      beforeDispatch(); const selected = request.menu.options.find(option => option.kind === 'leaf' && option.candidate.id === 'seven')!.id;
      return { requestId: request.requestId, nodeId: request.menu.nodeId, selectionEpoch: request.selectionEpoch,
        candidateSetHash: request.candidateSetHash, semanticSufficiency: 'only_candidate_meaning', optionId: selected,
        probabilities: request.menu.options.map(option => ({ optionId: option.id, probability: option.id === selected ? 0.96 : 0.02 })) };
    },
    inputForTurn: turn => weeklyPlanningTurnRuntimeGateway.prepareCandidateInput!({ ...turn, userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [] }).normalizerInput,
    requestContextForTurn: pending => weeklyPlanningTurnRuntimeGateway.candidateRequestContext!(pending, { timeZone: 'Asia/Tokyo' }),
    continueSelectedTurn: async () => { throw new Error('fake stage never supplies an effect'); },
  });
  const execute = vi.fn(async () => ({ state: { ...createInitialPlanningIntakeState(), questions: ['数値の候補を確認します。'],
    lastQuestionContext: { kind: 'ambiguity' as const, targetSlot: 'stable_v5:missing_effort_estimate', topicId: 'work-a', intent: 'duration_per_unit' } },
    message: '数値の候補を確認します。', draftCandidates: [], stableV5Graph: h.graph,
    questionPresentationContent: { responseSource: 'ai' as const, currentTurnGrounding: 'none' as const,
      selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false } }));
  const submit = (text: string, routes = [route]) => submitWeeklyPlanningControlledTurn({ session: h.session, ownerId: OWNER,
    userText: text, getState: h.getState, dispatch: h.dispatch, execute, candidateDomains: routes,
    now: () => '2026-10-06T08:00:00.000Z' });
  return { h, submit, stage, execute, route, revoke: () => { access = false; } };
}
it('registers a fake typed domain at actual presenting commit and reaches stage on the next turn without identity patching', async () => {
  const h = setup(); await h.submit('質問を提示してください');
  const q = h.h.getState().intakeState!.lastQuestionContext!;
  expect(typeof q.actionId).toBe('string');
  expect(q.actionId).toMatch(/^candidate-question:d5_numeric:/);
  expect(q.controlledCandidate?.basis.binding.question.id).toBe(q.actionId);
  expect(q.controlledCandidate?.basis.binding.question.presentedQuestion?.text).toBe('数値の候補を確認します。');
  await h.submit('全文を保持した回答'); expect(h.stage).toHaveBeenCalledTimes(1); expect(h.execute).toHaveBeenCalledTimes(2);
});
it('keeps unregistered and ambiguous duplicate domains inert', async () => {
  const h = setup(); await h.submit('質問を提示してください', []);
  expect(h.h.getState().intakeState!.lastQuestionContext?.controlledCandidate).toBeUndefined();
  await h.submit('全文を保持した回答', [h.route, h.route]); expect(h.stage).not.toHaveBeenCalled();
});
it('keeps a revoked live lease inert before domain staging', async () => {
  const h = setup(); await h.submit('質問を提示してください'); h.revoke();
  await h.submit('全文を保持した回答'); expect(h.stage).not.toHaveBeenCalled();
});
it('reads a new snapshot as data, rejects malformed wire and retains the capability across ordinary fallback', async () => {
  const h = setup(); await h.submit('質問を提示してください');
  const initial = h.h.getState().intakeState!.lastQuestionContext!.controlledCandidate!;
  expect(initial).toBeDefined();
  expect(decodeControlledCandidateQuestion(initial, OWNER, h.h.conversationId)).toEqual(initial);
  expect(decodeControlledCandidateQuestion({ ...initial, extra: true }, OWNER, h.h.conversationId)).toBeNull();
  await h.submit('全文を保持した回答', []);
  const state = h.h.getState(); expect(state.intakeState?.controlledCandidateProtocolVersion).toBe(1);
  const raw = serializeWeeklyPlanningStableV5CheckpointWithMessageCount({ ownerId: OWNER, conversationId: h.h.conversationId, weekStartDate: WEEK,
    graph: h.h.graph, planningState: state, messageCount: state.messages.length, savedAt: '2026-10-06T08:00:00.000Z' })!;
  expect(raw).not.toBeNull(); expect(JSON.parse(raw).requiredCapabilities).toEqual(['controlled-candidate-question-v1']);
  const parsed = parseWeeklyPlanningStableV5PersistedSession({ raw, ownerId: OWNER, weekStartDate: WEEK }); expect(parsed).not.toBeNull();
  expect(prepareWeeklyPlanningStableV5Checkpoint({ ownerId: OWNER, conversationId: h.h.conversationId, weekStartDate: WEEK, graph: h.h.graph, planningState: parsed!.planningState }).status).toBe('ready');
});
