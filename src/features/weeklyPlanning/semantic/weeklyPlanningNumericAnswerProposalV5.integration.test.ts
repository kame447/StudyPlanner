import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { renderWeeklyPlanningStableV5AssistantMessageCore } from '../dialogue/weeklyPlanningStableV5TurnDialogueCore';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../dialogue/weeklyPlanningStableV5AiDialogueRendererCore';
import { getWeeklyPlanningStableV5RuntimeSession } from '../application/weeklyPlanningStableV5RuntimeSession';
import { loadAiPlanningChatIndex, saveAiPlanningChatIndex, saveAiPlanningChatSnapshot } from '../chat/aiPlanningChatStore';
import { D5_TOP1_ANSWER_POLICY_VERSION } from '../../../../shared/d5AnswerPolicy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { c5ControllerHarness, OWNER, WEEK } from '../application/c5LocalSelection/controller.testUtils';
import { readC5RuntimeGraph } from '../application/c5LocalSelection/controlledCommit';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../application/weeklyPlanningStableV5RuntimeSession';
import { loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { registerControlledCandidateDomain } from '../application/weeklyPlanningControlledCandidateRegistry';
import { weeklyPlanningTurnRuntimeGateway } from '../application/weeklyPlanningTurnRuntimeGateway';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createCandidateChoiceClient } from '../../../services/ai/candidateChoiceClient';
import type { CandidateChoiceRequest } from '../application/candidateSelection/contracts';
import type { PlanningState } from '../types';
import { D5_EXACT_MINUTE_CANDIDATES } from '../application/weeklyPlanningRegisteredCandidateDomains';
import { createNumericPendingRegisteredDomainV5 } from './weeklyPlanningNumericRegisteredDomainV5';
import { normalizedChoice } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import { CANDIDATE_CHOICE_CATALOG_VERSION } from '../../../../shared/candidateChoiceDecision';
import * as rendererFactory from '../dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import { successfulWeeklyPlanningRendererCompletion } from '../testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { ControlledCandidateSemanticContribution } from '../application/weeklyPlanningControlledCandidateDomains';

// Historical v1 regressions must not follow the current production release version.
const LEGACY_PROPOSAL_POLICY_VERSION = 'd5-answer-proposal-2026-10-20-v1';
let restore: () => void;
beforeEach(() => {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
});
afterEach(() => { restore(); vi.restoreAllMocks(); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); });

function setup(options: { realContinuation?: boolean; initialIntent?: 'not_requested' | 'user_authorized'; top1?: boolean; presentingSiblingAck?: boolean; effortAck?: boolean; component?: boolean; measurement?: 'total_duration' | 'duration_per_unit'; minutes?: number;
  mode?: 'none' | 'low_top' | 'extra_meaning' | 'condition_change' | 'ellipsis_heads' | 'tie';
  collision?: 'estimate' | 'amount' | 'rangeStart' | 'rangeEnd' | 'target' | 'source_integer' | 'inactive' | 'range_label' | 'unrelated_label' | 'capacity' | 'recurrence';
  stale?: 'graph' | 'question' | 'continuation' } = {}) {
  const h = c5ControllerHarness();
  const graph = h.graph;
  graph.workloads = graph.workloads.filter(f => f.id !== 'completed-b');
  graph.effortEstimates = [];
  if (options.component) {
    graph.components = [{ id: 'material-a', taskId: graph.workloads[0].taskId, parentComponentId: null, role: 'material',
      label: '数学問題集', source: graph.workloads[0].source, createdRevision: 1 },
    { id: 'chapter-a', taskId: graph.workloads[0].taskId, parentComponentId: 'material-a', role: 'chapter',
      label: '第1章', source: graph.workloads[0].source, createdRevision: 1 }];
    graph.workloads[0].componentId = 'chapter-a';
  }
  const sibling = graph.workloads.find(f => f.id === 'work-b')!;
  sibling.amount = 30; sibling.unitCode = 'minute'; sibling.unitLabel = '分';
  if (options.collision === 'target') graph.workloads[0].amount = 15;
  if (options.collision === 'amount' || options.collision === 'source_integer') sibling.amount = 15;
  if (options.collision === 'rangeStart' || options.collision === 'rangeEnd') {
    sibling.rangeStart = options.collision === 'rangeStart' ? '15' : '1';
    sibling.rangeEnd = options.collision === 'rangeEnd' ? '15' : '44';
    sibling.amount = Number(sibling.rangeEnd) - Number(sibling.rangeStart) + 1;
  }
  if (options.collision === 'range_label') { sibling.rangeStart = 'chapter １５'; sibling.rangeEnd = 'end'; }
  if (options.collision === 'unrelated_label') { sibling.rangeStart = 'chapter 12'; sibling.rangeEnd = '0xF'; }
  if (options.collision === 'capacity') graph.availabilityDeclarations = [{ id: 'capacity-15', kind: 'capacity', dateExpression: null,
    namedTimePeriod: null, startTime: null, endTime: null, recurrenceKind: 'daily', days: [], constraintLevel: 'hard',
    capacityMinutes: 15, resolutionStatus: 'unresolved', source: sibling.source, createdRevision: 1 }];
  if (options.collision === 'recurrence') graph.recurrences = [{ id: 'repeat-15', taskId: sibling.taskId, targetFactId: sibling.taskId,
    kind: 'times_per_week', count: 15, days: [], source: sibling.source, createdRevision: 1 }];
  if (options.collision === 'estimate' || options.collision === 'inactive') {
    sibling.unitCode = 'page'; sibling.unitLabel = 'ページ';
    graph.effortEstimates = [{ id: 'sibling-effort', taskId: sibling.taskId, targetFactId: sibling.id,
      kind: 'total_duration', minutes: options.collision === 'inactive' ? 30 : 15, unitCode: null, precision: 'exact',
      source: sibling.source, createdRevision: 1 }];
    if (options.collision === 'inactive') graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'old-effort', minutes: 15 });
  }
  graph.factLifecycles = [...graph.tasks, ...graph.components, ...graph.workloads, ...graph.effortEstimates, ...graph.availabilityDeclarations, ...graph.recurrences].map(f => ({
    factId: f.id, status: f.id === 'old-effort' ? 'superseded' : 'active', createdRevision: 1,
    terminalRevision: f.id === 'old-effort' ? 2 : null, supersededByFactId: f.id === 'old-effort' ? 'sibling-effort' : null,
  }));
  hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId: h.conversationId, graph });
  const measurement = options.measurement ?? 'total_duration';
  const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const request = body.decisionContext.request as CandidateChoiceRequest;
    expect(request.menu.options.some(o => o.kind === 'none')).toBe(true);
    const selected = options.mode === 'none' ? 'none' : request.menu.options.find(o => o.kind === 'leaf' && o.candidate.tuple.minutes === (options.minutes ?? 5))!.id;
    const { semanticSufficiency: _sufficiency, ...response } = normalizedChoice(request, selected);
    // With top >= .90 a normalized runner-up is <= .10, so the .80 margin is implied; low_top covers both.
    const top = options.mode === 'tie' ? 0.5 : options.mode === 'low_top' ? 0.51 : options.mode === 'ellipsis_heads' ? .59 : 0.97;
    const other = request.menu.options.find(o => o.id !== selected)!.id;
    response.probabilities = request.menu.options.map(o => ({ optionId: o.id,
      probability: o.id === selected ? top : options.mode === 'low_top' ? (1 - top) / (request.menu.options.length - 1)
        : o.id === other ? 1 - top : 0 }));
    // These mutations happen while the mocked request is in flight.
    if (options.stale === 'graph') hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK,
      conversationId: h.conversationId, graph: { ...graph, revision: graph.revision + 1 } });
    if (options.stale === 'question') h.replaceState({ ...h.getState(), intakeState: { ...h.getState().intakeState!,
      lastQuestionContext: { ...h.getState().intakeState!.lastQuestionContext!, actionId: 'replaced-question' } } });
    return Response.json({ ...response, status: 'evaluated', catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION,
      conditionChange: options.mode === 'ellipsis_heads' ? .56 : options.mode === 'condition_change' ? options.top1 ? 0.5 : 0.02 : 0.001,
      independentMeaning: options.mode === 'ellipsis_heads' ? .50 : options.mode === 'extra_meaning' ? options.top1 ? 0.5 : 0.02 : 0.001 });
  });
  const client = createCandidateChoiceClient({ proxyUrl: 'https://choice.fixture', getToken: async () => 'fixture', transport,
    semanticPolicy: { calibrationEvidenceId: 'synthetic-only', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 } });
  const choose = vi.fn(client.choose);
  const ackControl = { fails: true, calls: 0, unexecutedClaim: false };
  const continueSelectedTurn = vi.fn(async ({ snapshot, graph: selectedGraph, pending, semanticContribution }: { snapshot: PlanningState; graph: typeof graph; pending: NonNullable<PlanningState['pendingTurn']>; semanticContribution?: ControlledCandidateSemanticContribution }) => {
    if (options.stale === 'continuation') h.replaceState({ ...h.getState(), intakeState: { ...h.getState().intakeState!,
      lastQuestionContext: { ...h.getState().intakeState!.lastQuestionContext!, actionId: 'replaced-question' } } });
    if (options.realContinuation) return weeklyPlanningTurnRuntimeGateway.continueSelectedTurn!({ snapshot, pending, userText: '15',
      userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [] }, selectedGraph, semanticContribution);
    if (options.effortAck) return renderWeeklyPlanningStableV5AssistantMessageCore({
      input: { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [], conversationId: h.conversationId,
        traceRequestId: pending.requestId, userText: '15', messages: snapshot.messages, previousState: snapshot.intakeState },
      result: { state: { ...snapshot.intakeState!, questions: [], lastQuestionContext: undefined }, message: '確認', draftCandidates: [], stableV5Graph: selectedGraph },
    }, { getSession: getWeeklyPlanningStableV5RuntimeSession, createRenderer: () => createWeeklyPlanningStableV5DialogueRendererCore({
      async createChatCompletion(request) {
        ackControl.calls++;
        const prompt = JSON.parse(request.messages.slice(-1)[0].content);
        const text = ackControl.fails ? '教材aは全部で999分です。' : '教材aは全部で15分で見積もります。';
        return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind, questionCode: prompt.applicationDecision.questionCode,
          groundingAcknowledgement: { factIds: prompt.currentTurnGrounding.acceptedFacts.filter((f: {kind: string}) => f.kind === 'effort_estimate').map((f: {factId: string}) => f.factId), text }, text: text + (ackControl.unexecutedClaim ? 'この計画を作成します。確認してください。' : '') });
      },
    }) });
    return { state: { ...snapshot.intakeState!, questions: [], lastQuestionContext: undefined },
      message: '反映しました。', draftCandidates: [], stableV5Graph: selectedGraph, responseSource: 'deterministic_fallback' as const };
  });
  const domain = createNumericPendingRegisteredDomainV5(D5_EXACT_MINUTE_CANDIDATES, options.top1 ? D5_TOP1_ANSWER_POLICY_VERSION : LEGACY_PROPOSAL_POLICY_VERSION,
    { candidateSource: 'answer_proposal' });
  const route = registerControlledCandidateDomain(domain, {
    policy: { id: 'synthetic-only', calibrationEvidenceId: 'synthetic-only', rules: Array.from({ length: 8 }, (_, i) => ({
      menuKind: 'leaves' as const, optionCount: i + 2, depth: 0, minimumTopProbability: 0.90, minimumMargin: 0.80 })) },
    maximumChildrenPerMenu: 8, maximumDecisions: 1, choose, sourceAccess: () => h.controls.access,
    inputForTurn: turn => weeklyPlanningTurnRuntimeGateway.prepareCandidateInput!({ ...turn, userId: OWNER,
      selectedDate: WEEK, plans: [], scheduleTemplates: [] }).normalizerInput,
    requestContextForTurn: pending => weeklyPlanningTurnRuntimeGateway.candidateRequestContext!(pending, { timeZone: 'Asia/Tokyo' }),
    continueSelectedTurn,
  });
  const present = () => h.submit('計画を相談します', { c5LocalSelection: undefined, candidateDomains: [route],
    execute: async ({ pending }) => {
      if (options.presentingSiblingAck) graph.effortEstimates = graph.effortEstimates.map(fact => fact.id === 'sibling-effort'
        ? { ...fact, source: { ...fact.source, turnId: pending.requestId } } : fact);
      const question = options.component ? '数学問題集の第1章は1問あたり何分かかりますか？' : 'どのくらいかかりますか？';
      const result: WeeklyPlanningTurnExecutionResult = { state: { ...createInitialPlanningIntakeState(), questions: [question],
      ...(options.initialIntent ? { draftGenerationIntent: options.initialIntent } : {}),
      lastQuestionContext: { kind: 'ambiguity', topicId: 'work-a', targetSlot: 'stable_v5:missing_effort_estimate', intent: measurement } },
      message: question, draftCandidates: [], stableV5Graph: graph,
      questionPresentationContent: { responseSource: 'ai', currentTurnGrounding: 'none', selfRepairNotice: false,
        groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false } };
      if (!options.presentingSiblingAck) return result;
      return renderWeeklyPlanningStableV5AssistantMessageCore({ input: { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
        conversationId: h.conversationId, traceRequestId: pending.requestId, userText: '数学の時間は未定。教材bは全部で15分', messages: [], }, result },
        { getSession: getWeeklyPlanningStableV5RuntimeSession, createRenderer: () => createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
          const prompt = JSON.parse(request.messages.slice(-1)[0].content);
          const fact = prompt.currentTurnGrounding.acceptedFacts.find((f: { kind: string }) => f.kind === 'effort_estimate');
          const ack = '教材bは全部で15分で見積もります。';
          return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind, questionCode: prompt.applicationDecision.questionCode,
            groundingAcknowledgement: { factIds: [fact.factId], text: ack }, text: ack + '教材aは全部で何分かかりますか？' });
        } }) });
    } });
  const fallback = vi.fn(async ({ snapshot }: { snapshot: PlanningState }) => ({ state: snapshot.intakeState!,
    message: 'Luna', draftCandidates: [] }));
  const answer = (text: string) => h.submit(text, { c5LocalSelection: undefined, candidateDomains: [route], execute: fallback });
  return { h, graph, domain, present, answer, choose, transport, fallback, continueSelectedTurn, ackControl };
}

describe('D5 answer proposal through canonical controller commit', () => {
  it.each([false, true])('real continuation/renderer rejects absent optional intent safely to Luna once (wire=%s)', async wire => {
    vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', 'enabled');
    vi.spyOn(rendererFactory, 'createAiWeeklyPlanningStableV5DialogueRenderer').mockImplementation(() =>
      createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion }));
    const run = setup({ realContinuation: true, top1: true, minutes: 15, measurement: 'duration_per_unit' });
    await run.present();
    if (wire) run.h.replaceState(JSON.parse(JSON.stringify(run.h.getState())));
    const before = run.h.getState();
    const graph = readC5RuntimeGraph(OWNER, run.h.conversationId);
    const answer = await run.answer('15');
    expect(answer.accepted).toBe(true);
    expect(run.choose).toHaveBeenCalledTimes(1);
    expect(run.continueSelectedTurn).toHaveBeenCalledTimes(1);
    expect(run.fallback).toHaveBeenCalledTimes(1);
    expect(run.h.getState().messages.slice(before.messages.length).map(message => message.role)).toEqual(['user', 'assistant']);
    expect(run.h.getState().messages.slice(-1)[0]?.content).toBe('Luna');
    expect(run.h.getState().intakeState?.c5SelectionLedger?.consumed).toEqual([]);
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId)).toEqual(graph);
    expect(run.h.getState().pendingApproval).toBeUndefined();
    expect(run.h.getState().draftBlocks).toEqual(before.draftBlocks);
    vi.unstubAllEnvs();
  });
  it.each([false, true].flatMap(wire => (['not_requested', 'user_authorized'] as const).map(initialIntent => ({ wire, initialIntent }))))(
    'real continuation/renderer retains the accepted authorization control ($initialIntent, wire=$wire)', async ({ wire, initialIntent }) => {
    vi.spyOn(rendererFactory, 'createAiWeeklyPlanningStableV5DialogueRenderer').mockImplementation(() =>
      createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion }));
    const run = setup({ realContinuation: true, initialIntent, top1: true, minutes: 15, measurement: 'duration_per_unit' });
    await run.present();
    if (wire) run.h.replaceState(JSON.parse(JSON.stringify(run.h.getState())));
    expect((await run.answer('15')).accepted).toBe(true);
    expect(run.fallback).not.toHaveBeenCalled();
    expect(run.h.getState().intakeState?.c5SelectionLedger?.consumed).toHaveLength(1);
  });
  it.each(['owner', 'revision', 'checkpoint', 'permission'] as const)('does not execute Luna over an intervening %s change', async change => {
    const run = setup({ top1: true, minutes: 15 });
    await run.present();
    run.continueSelectedTurn.mockImplementationOnce(async ({ snapshot, graph }) => {
      if (change === 'owner') run.h.session.ownerId = 'another-owner';
      if (change === 'revision') run.h.replaceState({ ...run.h.getState(), revision: run.h.getState().revision + 1 });
      if (change === 'checkpoint') window.localStorage.setItem(`studyplanner.weeklyPlanning.stableV5.${OWNER}.${WEEK}`, 'intervening-checkpoint');
      if (change === 'permission') run.h.controls.access = 'denied';
      return { state: { ...snapshot.intakeState!, draftGenerationIntent: 'not_requested' }, message: 'ACK', draftCandidates: [], stableV5Graph: graph };
    });
    expect((await run.answer('15')).accepted).toBe(false);
    expect(run.fallback).not.toHaveBeenCalled();
    expect(run.h.getState().intakeState?.c5SelectionLedger?.consumed).toEqual([]);
  });
  it('clean checkpoint rollback restores exactly one begun turn and executes Luna once', async () => {
    const run = setup({ top1: true, minutes: 15 });
    await run.present();
    const before = run.h.getState();
    const original = readC5RuntimeGraph(OWNER, run.h.conversationId);
    const key = `studyplanner.weeklyPlanning.stableV5.${OWNER}.${WEEK}`;
    const set = window.localStorage.setItem;
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((name, value) => {
      if (name === key) throw new Error('injected write failure before mutation');
      set(name, value);
    });
    expect((await run.answer('15')).accepted).toBe(true);
    expect(run.fallback).toHaveBeenCalledTimes(1);
    expect(run.h.getState().messages.slice(before.messages.length).map(message => message.role)).toEqual(['user', 'assistant']);
    expect(run.h.getState().intakeState?.c5SelectionLedger?.consumed).toEqual([]);
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId)).toEqual(original);
    expect(run.h.getState().pendingApproval).toBeUndefined();
  });
  it('unknown checkpoint readback never executes Luna or repeats the selection', async () => {
    const run = setup({ top1: true, minutes: 15 });
    await run.present();
    const key = `studyplanner.weeklyPlanning.stableV5.${OWNER}.${WEEK}`;
    const get = window.localStorage.getItem;
    const set = window.localStorage.setItem;
    let written = false;
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((name, value) => { set(name, value); if (name === key) written = true; });
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(name => {
      if (name === key && written) throw new Error('injected uncertain readback');
      return get(name);
    });
    const outcome = await run.answer('15');
    expect(outcome.accepted).toBe(false);
    expect(outcome.recoveryRequired).toBe(true);
    expect(run.fallback).not.toHaveBeenCalled();
    expect(run.choose).toHaveBeenCalledTimes(1);
  });
  it('fallback failure follows the existing visible assistant failure path without reselection', async () => {
    const run = setup({ top1: true, minutes: 15 });
    await run.present();
    run.continueSelectedTurn.mockImplementationOnce(async ({ snapshot, graph }) => ({
      state: { ...snapshot.intakeState!, draftGenerationIntent: 'not_requested' }, message: 'ACK', draftCandidates: [], stableV5Graph: graph,
    }));
    run.fallback.mockRejectedValueOnce(new Error('injected Luna failure'));
    await expect(run.answer('15')).rejects.toThrow('injected Luna failure');
    expect(run.h.getState().messages.slice(-1)[0]?.role).toBe('assistant');
    expect(run.h.getState().pendingTurn).toBeUndefined();
    expect(run.h.getState().intakeState?.c5SelectionLedger?.consumed).toEqual([]);
    expect(run.choose).toHaveBeenCalledTimes(1);
    expect(run.fallback).toHaveBeenCalledTimes(1);
  });
  it('production smoke reads the real persisted chat graph/ledger and correlates actual request → receipt → consumed selection', async () => {
    const run = setup({ top1: true, minutes: 15, measurement: 'duration_per_unit' });
    await run.present();
    const capturedBefore = run.h.getState().intakeState!.lastQuestionContext!.controlledCandidate;
    await run.answer('15');
    const saved = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })!;
    const request = run.choose.mock.calls[0][0];
    const index = loadAiPlanningChatIndex(OWNER);
    expect(saveAiPlanningChatIndex(OWNER, index)).toBe(true);
    expect(saveAiPlanningChatSnapshot(OWNER, index.activeChatId, saved)).toBe(true);
    // The same browser-serializable reader/correlator used by the production smoke.
    const helperUrl = new URL('../../../../tests/e2e/support/d5-production-readonly.mjs', import.meta.url).href;
    const { readOwnedConversation, consumedD5Request, boundOffRollbackCandidate } = await import(helperUrl);
    vi.stubGlobal('localStorage', window.localStorage);
    try {
      const observed = readOwnedConversation(OWNER);
      expect(observed.graph).toEqual(saved.graph);
      expect(observed.planningState.intakeState.c5SelectionLedger).toEqual(saved.planningState.intakeState!.c5SelectionLedger);
      expect(observed.graph.effortEstimates).toMatchObject([{ targetFactId: 'work-a', minutes: 15, kind: 'duration_per_unit', unitCode: 'problem' }]);
      expect(request.context.target.id).toBe('work-a');
      expect(request.context.scope.domainPolicyVersion).toBe(D5_TOP1_ANSWER_POLICY_VERSION);
      expect(request.menu.options.filter(option => option.kind === 'leaf').map(option => option.kind === 'leaf' && option.candidate.id)).toEqual(['numeric:0']);
      expect(consumedD5Request(observed, request, OWNER, 'work-a')).toBe(true);
      expect(consumedD5Request(observed, { ...request, requestId: 'another-attempt' }, OWNER, 'work-a')).toBe(false);
      expect(consumedD5Request(observed, { ...request, candidateSetHash: 'another-manifest' }, OWNER, 'work-a')).toBe(false);
      const wrongCandidate = structuredClone(observed);
      wrongCandidate.planningState.intakeState.c5SelectionLedger.consumed[0].candidateId = 'different-leaf';
      expect(consumedD5Request(wrongCandidate, request, OWNER, 'work-a')).toBe(false);
      expect(consumedD5Request(observed, request, OWNER, 'another-target')).toBe(false);
      expect(readOwnedConversation('foreign-owner')).toBeNull();
      const off = [{ request, row: { v2: true, status: 'unavailable', off: true, provider: null }, evaluated: false }];
      const scope = { owner: OWNER, conversationId: saved.conversationId, target: 'work-a', policyVersion: D5_TOP1_ANSWER_POLICY_VERSION };
      expect(boundOffRollbackCandidate(capturedBefore, off, scope)).toBe(true);
      expect(boundOffRollbackCandidate(undefined, off, scope)).toBe(false);
      expect(boundOffRollbackCandidate(capturedBefore, [], scope)).toBe(false);
      expect(boundOffRollbackCandidate(capturedBefore, [...off, ...off], scope)).toBe(false);
      expect(boundOffRollbackCandidate(capturedBefore, [{ ...off[0], evaluated: true }], scope)).toBe(false);
      expect(boundOffRollbackCandidate(capturedBefore, [{ ...off[0], row: { ...off[0].row, off: false } }], scope)).toBe(false);
      expect(boundOffRollbackCandidate(capturedBefore, [{ ...off[0], request: { ...request, selectionEpoch: request.selectionEpoch + 1 } }], scope)).toBe(false);
      expect(boundOffRollbackCandidate(capturedBefore, off, { ...scope, owner: 'foreign-owner' })).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([
    ['15', 15], ['十五分', 15], ['１．５時間', 90], ['1時間30分', 90], ['一時間半', 90],
  ] as const)('v2 accepts %s at unique top-1 beside a sibling 15, once across reload', async (text, minutes) => {
    const run = setup({ top1: true, minutes, collision: 'estimate', mode: 'low_top' });
    await run.present();
    expect((await run.answer(text)).accepted).toBe(true);
    expect(run.fallback).not.toHaveBeenCalled();
    const saved = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })!;
    expect(saved.graph.effortEstimates.filter(f => f.targetFactId === 'work-a')).toMatchObject([{ minutes, kind: 'total_duration' }]);
    expect(saved.planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
    expect(saved.graph.effortEstimates.filter(f => f.id === 'sibling-effort')).toMatchObject([{ minutes: 15 }]);
  });
  it.each(['none', 'tie'] as const)('v2 abstains on %s', async mode => {
    const run = setup({ top1: true, mode, minutes: 15 }); await run.present(); await run.answer('15');
    expect(run.fallback).toHaveBeenCalledOnce();
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId)).toEqual(run.graph);
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  });
  it.each(['extra_meaning', 'condition_change', 'ellipsis_heads'] as const)('v2 candidate head accepts despite diagnostic %s scores', async mode => {
    const run = setup({ top1: true, mode, minutes: 15 }); await run.present(); await run.answer('15');
    expect(run.choose).toHaveBeenCalledOnce(); expect(run.fallback).not.toHaveBeenCalled();
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId).effortEstimates).toMatchObject([{ minutes: 15 }]);
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
  });
  it.each([
    ['全部で300分', true, 'duration_per_unit'],
    ['1問5分、英語も30分追加', false, 'duration_per_unit'],
  ] as const)('mock none preserves scope/compound contrast %s for whole-reply Luna fallback', async (text, component, measurement) => {
    const run = setup({ top1: true, mode: 'none', component, measurement });
    await run.present(); await run.answer(text);
    expect(run.choose).toHaveBeenCalledOnce();
    const request = run.choose.mock.calls[0][0];
    expect(request.wholeUtterance).toBe(text);
    if (component) {
      expect(request.context.scope.componentChain).toMatchObject([{ label: '数学問題集' }, { label: '第1章' }]);
      expect(request.context.presentedQuestion).toBe('数学問題集の第1章は1問あたり何分かかりますか？');
    }
    expect(run.fallback.mock.calls[0][0]).toMatchObject({ userText: text });
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId)).toEqual(run.graph);
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  });
  it.each(['わかりません', '保存してください', 'この内容で承認します'])('v2 refusal/approval has no exact proposal or commit: %s', async text => {
    const run = setup({ top1: true }); await run.present(); await run.answer(text);
    expect(run.choose).not.toHaveBeenCalled();
    expect(run.fallback.mock.calls[0][0]).toMatchObject({ userText: text });
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId)).toEqual(run.graph);
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  });
  it.each(['5分くらい', '1.5分', '5〜10分'])('v2 sends unsupported exactness to whole-utterance fallback: %s', async text => {
    const run = setup({ top1: true }); await run.present(); await run.answer(text);
    expect(run.choose).not.toHaveBeenCalled();
    expect(run.fallback.mock.calls[0][0]).toMatchObject({ userText: text });
  });
  it.each(['15ページ', '全部で5分', '英語は5分', '5分。別の教材も追加', 'わかりません'])('v2 preserves a model-rejected disconfirming reply: %s', async text => {
    const run = setup({ top1: true, mode: 'none', measurement: 'duration_per_unit' });
    await run.present(); await run.answer(text);
    expect(run.fallback.mock.calls[0][0]).toMatchObject({ userText: text });
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId)).toEqual(run.graph);
  });
  it('captures v2 after an actual required sibling effort ACK, then dispatches and consumes once', async () => {
    const run = setup({ top1: true, collision: 'estimate', minutes: 15, presentingSiblingAck: true });
    await run.present();
    const shown = run.h.getState().intakeState!.lastQuestionContext!;
    expect(shown.presentation!.content.currentTurnGrounding).toBe('required_before_resume');
    expect(shown.controlledCandidate?.domainId).toBe('d5_numeric');
    await run.answer('15');
    expect(run.choose).toHaveBeenCalledOnce(); expect(run.fallback).not.toHaveBeenCalled();
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
  });
  it('does not roll back an authorized numeric selection because a free-form ACK is inaccurate', async () => {
    const run = setup({ top1: true, minutes: 15, effortAck: true }); await run.present();
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId: run.h.conversationId, graph: run.graph, planningState: run.h.getState() })).toBe(true);
    await run.answer('15');
    expect(run.ackControl.calls).toBe(1);
    // The deliberately wrong 999-minute sentence is a measurable model-quality
    // failure, but it does not replace the user's accepted typed 15-minute choice.
    expect(run.h.getState().messages.slice(-1)[0].content).toContain('999分');
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId).effortEstimates)
      .toMatchObject([{ minutes: 15, kind: 'total_duration' }]);
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
    const saved = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })!;
    expect(saved.graph.effortEstimates).toMatchObject([{ minutes: 15 }]);
    expect(saved.planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
    expect(run.h.getState().pendingApproval).toBeUndefined();
  });
  it('rejects a false plan-completion claim without undoing the authorized numeric choice', async () => {
    const run = setup({ top1: true, minutes: 15, effortAck: true });
    await run.present();
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId: run.h.conversationId,
      graph: run.graph, planningState: run.h.getState() })).toBe(true);
    const before = structuredClone(readC5RuntimeGraph(OWNER, run.h.conversationId));
    run.ackControl.fails = false;
    run.ackControl.unexecutedClaim = true;
    await run.answer('15');
    expect(run.ackControl.calls).toBe(1); // Existing execution-claim rejection is terminal; no extra repair call.
    expect(run.h.getState().messages.slice(-1)[0]?.content).toContain('返信を作れませんでした');
    expect(run.h.getState().messages.slice(-1)[0]?.content).not.toContain('計画を作成します');
    expect(run.h.getState().previewCandidates).toEqual([]);
    expect(run.h.getState().pendingApproval).toBeUndefined();
    expect(before.effortEstimates).toEqual([]);
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId).effortEstimates).toMatchObject([{ minutes: 15 }]);
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
    expect(loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })!.graph.effortEstimates)
      .toMatchObject([{ minutes: 15 }]);
  });
  it('rebinds the numeric policy revision and preserves the question-time record', async () => {
    const run = setup(); await run.present();
    const frozen = run.h.getState().intakeState!.lastQuestionContext!.controlledCandidate!;
    const before = JSON.stringify(frozen);
    const proposal = run.domain.proposeAnswerPayload!({ target: frozen.basis.binding.target, scope: frozen.basis.binding.scope,
      sources: frozen.basis.binding.sources, candidates: frozen.basis.candidates, domainData: frozen.domainData }, '1問5分です')!;
    expect(proposal.domainData.domainMinutes).toEqual([1, 60, 5, 300]);
    expect(JSON.parse(proposal.sources.find(s => s.id === 'numeric-domain-policy')!.revision)).toEqual({
      domainPolicyVersion: LEGACY_PROPOSAL_POLICY_VERSION, domain: [1, 60, 5, 300] });
    expect(proposal.sources).not.toEqual(frozen.basis.binding.sources);
    expect(JSON.stringify(frozen)).toBe(before);
  });
  it.each([
    ['1問5分です', 'duration_per_unit', 5, [1, 60, 5, 300]],
    ['150分です', 'total_duration', 150, [150]],
    ['2時間です', 'total_duration', 120, [2, 120]],
  ] as const)('commits %s with the exact answer menu and receipt', async (text, measurement, minutes, candidates) => {
    const run = setup({ measurement, minutes });
    expect((await run.present()).accepted).toBe(true);
    expect(run.h.getState().intakeState!.lastQuestionContext!.controlledCandidate!.domainData.domainMinutes).toEqual(D5_EXACT_MINUTE_CANDIDATES);
    expect((await run.answer(text)).accepted).toBe(true);
    expect(run.fallback).not.toHaveBeenCalled(); expect(run.choose).toHaveBeenCalledTimes(1);
    const request = run.choose.mock.calls[0][0];
    expect(request.wholeUtterance).toBe(text);
    expect(request.menu.options.flatMap(o => o.kind === 'leaf' ? [o.candidate.tuple.minutes] : [])).toEqual(candidates);
    const saved = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })!;
    expect(saved.graph.effortEstimates).toMatchObject([{ targetFactId: 'work-a', minutes, kind: measurement,
      unitCode: measurement === 'duration_per_unit' ? 'problem' : null }]);
    expect(saved.planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
    expect(saved.graph.workloads).toEqual(run.graph.workloads);
  });

  it.each(['none', 'low_top', 'extra_meaning', 'condition_change'] as const)('falls back without committing on %s', async mode => {
    const run = setup({ mode, minutes: 120 });
    await run.present();
    await run.answer('2時間です');
    expect(run.choose).toHaveBeenCalledTimes(1); expect(run.fallback).toHaveBeenCalledTimes(1);
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId)).toEqual(run.graph);
  });

  it('returns a multi-clause mock none to Luna with the whole utterance', async () => {
    const run = setup({ mode: 'none' }); await run.present();
    const text = '1問5分です。別の教材も増やしたい';
    await run.answer(text);
    expect(run.choose.mock.calls[0][0].wholeUtterance).toBe(text);
    expect(run.fallback.mock.calls[0][0]).toMatchObject({ userText: text });
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  });

  it.each(['はい', '十五分', '1 2 3 4 5', '1.5時間', '1,500分'])('never calls Jev without a complete proposal: %s', async text => {
    const run = setup(); await run.present(); await run.answer(text);
    expect(run.choose).not.toHaveBeenCalled(); expect(run.fallback).toHaveBeenCalledTimes(1);
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId)).toEqual(run.graph);
  });

  it.each(['estimate', 'amount', 'rangeStart', 'rangeEnd', 'range_label', 'target', 'source_integer', 'capacity', 'recurrence'] as const)('rejects a confident selection colliding with %s', async collision => {
    const run = setup({ collision, minutes: collision === 'source_integer' ? 900 : 15 });
    await run.present();
    expect(run.h.getState().intakeState!.lastQuestionContext!.controlledCandidate).toBeDefined();
    await run.answer('15です');
    expect(run.choose).toHaveBeenCalledTimes(1); expect(run.fallback).toHaveBeenCalledTimes(1);
    expect(run.continueSelectedTurn).not.toHaveBeenCalled();
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId)).toEqual(run.graph);
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  });

  it.each(['inactive', 'unrelated_label'] as const)('ignores %s for collision comparison', async collision => {
    const run = setup({ collision, minutes: 15 }); await run.present();
    expect((await run.answer('15です')).accepted).toBe(true);
    expect(run.fallback).not.toHaveBeenCalled();
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
  });

  it.each(['graph', 'question', 'continuation'] as const)('rejects stale %s without consuming a selection', async stale => {
    const run = setup({ stale }); await run.present(); await run.answer('5分です');
    expect(run.choose).toHaveBeenCalledTimes(1);
    expect(run.h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
    expect(readC5RuntimeGraph(OWNER, run.h.conversationId).effortEstimates).toEqual([]);
  });
});
