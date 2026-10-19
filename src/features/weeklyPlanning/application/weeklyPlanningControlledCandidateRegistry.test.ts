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
import type { WeeklyPlanningQuestionPresentationContent } from '../intake/weeklyPlanningIntakeTypes';
import { weeklyPlanningStableV5AcceptedFactsForTurn } from '../dialogue/weeklyPlanningStableV5CurrentTurnGrounding';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { prepareWeeklyPlanningStableV5Checkpoint, serializeWeeklyPlanningStableV5CheckpointWithMessageCount, parseWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionCodec';

let restore: () => void;
beforeEach(() => { resetWeeklyPlanningStableV5RuntimeSessionsForTest(); restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage); });
afterEach(() => { restore(); vi.restoreAllMocks(); });
const directContent: WeeklyPlanningQuestionPresentationContent = { responseSource: 'ai', currentTurnGrounding: 'none',
  selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false };
function setup(options: { content?: Partial<WeeklyPlanningQuestionPresentationContent>; stampPresentingFacts?: boolean;
  rejectsCoPresentedFacts?: ControlledCandidateDomain['rejectsCoPresentedFacts'] } = {}) {
  const h = c5ControllerHarness(); let access = true;
  const rejectsCoPresentedFacts = vi.fn<ControlledCandidateDomain['rejectsCoPresentedFacts']>(options.rejectsCoPresentedFacts ?? (() => false));
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
      ], domainData: { meaning: 'typed fixture only' } }), stage, rejectsCoPresentedFacts,
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
  const execute = vi.fn(async (turn: { pending: { requestId: string } }) => ({ state: { ...createInitialPlanningIntakeState(), questions: ['数値の候補を確認します。'],
    lastQuestionContext: { kind: 'ambiguity' as const, targetSlot: 'stable_v5:missing_effort_estimate', topicId: 'work-a', intent: 'duration_per_unit' } },
    message: '数値の候補を確認します。', draftCandidates: [],
    // Optionally mark one sibling as accepted by this presenting request, as the canonicalizer would.
    stableV5Graph: options.stampPresentingFacts ? { ...h.graph, workloads: h.graph.workloads.map(fact => fact.id === 'work-b'
      ? { ...fact, source: { ...fact.source, turnId: turn.pending.requestId } } : fact) } : h.graph,
    questionPresentationContent: { ...directContent, ...options.content,
      groundingContext: { ...directContent.groundingContext, ...options.content?.groundingContext } } }));
  const submit = (text: string, routes = [route]) => submitWeeklyPlanningControlledTurn({ session: h.session, ownerId: OWNER,
    userText: text, getState: h.getState, dispatch: h.dispatch, execute, candidateDomains: routes,
    now: () => '2026-10-06T08:00:00.000Z' });
  return { h, submit, stage, execute, route, rejectsCoPresentedFacts, revoke: () => { access = false; } };
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

const captured = (h: ReturnType<typeof setup>) => h.h.getState().intakeState!.lastQuestionContext?.controlledCandidate !== undefined;
it.each([
  ['unaccompanied', {}, true],
  ['recommended grounding without a proposal', { currentTurnGrounding: 'recommended' }, true],
  ['recommended grounding with one proposal', { currentTurnGrounding: 'recommended', groundingContext: { proposed: 1, contested: 0 } }, true],
  ['required_before_resume grounding', { currentTurnGrounding: 'required_before_resume' }, false],
  ['a deterministic fallback with recommended grounding', { responseSource: 'deterministic_fallback', currentTurnGrounding: 'recommended' }, false],
  ['two proposals', { currentTurnGrounding: 'recommended', groundingContext: { proposed: 2, contested: 0 } }, false],
  ['a contested grounding', { currentTurnGrounding: 'recommended', groundingContext: { proposed: 0, contested: 1 } }, false],
  ['a self-repair notice', { currentTurnGrounding: 'recommended', selfRepairNotice: true }, false],
  ['a preview promotion control', { currentTurnGrounding: 'recommended', previewPromotionControl: true }, false],
] as const)('captures a controlled question presented with %s only when the controlled presentation gate allows it', async (_label, content, expected) => {
  const h = setup({ content: content as Partial<WeeklyPlanningQuestionPresentationContent> });
  await h.submit('質問を提示してください');
  expect(captured(h)).toBe(expected);
  expect(h.rejectsCoPresentedFacts).toHaveBeenCalledTimes(expected ? 1 : 0);
});
it.each([
  ['rejects co-presented facts', (): boolean => true],
  ['throws', (): boolean => { throw new Error('hook failure'); }],
  ['returns a non-boolean', (): boolean => undefined as unknown as boolean],
] as const)('skips capture without an epoch bump when the domain hook %s', async (_label, hook) => {
  const h = setup({ content: { currentTurnGrounding: 'recommended' }, rejectsCoPresentedFacts: hook });
  await h.submit('質問を提示してください');
  const state = h.h.getState().intakeState!;
  expect(captured(h)).toBe(false);
  expect(state.lastQuestionContext?.actionId).toBeUndefined();
  expect(state.c5SelectionLedger).toBeUndefined();
  expect(state.controlledCandidateProtocolVersion).toBeUndefined();
});
it('supplies the facts accepted by the presenting request ID, not the presentation turn ID, and only at question time', async () => {
  const h = setup({ content: { currentTurnGrounding: 'recommended' }, stampPresentingFacts: true });
  await h.submit('質問を提示してください');
  expect(captured(h)).toBe(true);
  const [{ targetId, facts }] = h.rejectsCoPresentedFacts.mock.calls[0];
  expect(targetId).toBe('work-a');
  expect(facts.map(fact => [fact.kind, fact.factId])).toEqual([['workload', 'work-b']]);
  const presentation = h.h.getState().intakeState!.lastQuestionContext!.presentation!;
  const presentingGraph = (await h.execute.mock.results[0].value).stableV5Graph!;
  expect(presentation.turnId).not.toBe(h.execute.mock.calls[0][0].pending.requestId);
  expect(weeklyPlanningStableV5AcceptedFactsForTurn(presentingGraph, presentation.turnId)).toEqual([]);
  await h.submit('全文を保持した回答');
  expect(h.stage).toHaveBeenCalledTimes(1);
  // One call per presenting commit (the fake answer turn presents again); staging never calls it.
  expect(h.rejectsCoPresentedFacts).toHaveBeenCalledTimes(h.execute.mock.calls.length);
});
