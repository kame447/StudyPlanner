import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { c5ControllerHarness, OWNER, WEEK } from '../application/c5LocalSelection/controller.testUtils';
import { readC5RuntimeGraph } from '../application/c5LocalSelection/controlledCommit';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../application/weeklyPlanningStableV5RuntimeSession';
import { loadWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { registerControlledCandidateDomain } from '../application/weeklyPlanningControlledCandidateRegistry';
import { weeklyPlanningTurnRuntimeGateway } from '../application/weeklyPlanningTurnRuntimeGateway';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createCandidateChoiceClient } from '../../../services/ai/candidateChoiceClient';
import type { CandidateChoiceRequest } from '../application/candidateSelection/contracts';
import type { PlanningState } from '../types';
import { D5_ANSWER_PROPOSAL_POLICY_VERSION, D5_EXACT_MINUTE_CANDIDATES } from '../application/weeklyPlanningRegisteredCandidateDomains';
import { createNumericPendingRegisteredDomainV5 } from './weeklyPlanningNumericRegisteredDomainV5';
import { normalizedChoice } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import { CANDIDATE_CHOICE_CATALOG_VERSION } from '../../../../shared/candidateChoiceDecision';

let restore: () => void;
beforeEach(() => {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
});
afterEach(() => { restore(); vi.restoreAllMocks(); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); });

function setup(options: { measurement?: 'total_duration' | 'duration_per_unit'; minutes?: number;
  mode?: 'none' | 'low_top' | 'extra_meaning' | 'condition_change';
  collision?: 'estimate' | 'amount' | 'rangeStart' | 'rangeEnd' | 'target' | 'source_integer' | 'inactive' | 'range_label' | 'unrelated_label' | 'capacity' | 'recurrence';
  stale?: 'graph' | 'question' | 'continuation' } = {}) {
  const h = c5ControllerHarness();
  const graph = h.graph;
  graph.workloads = graph.workloads.filter(f => f.id !== 'completed-b');
  graph.effortEstimates = [];
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
  graph.factLifecycles = [...graph.tasks, ...graph.workloads, ...graph.effortEstimates, ...graph.availabilityDeclarations, ...graph.recurrences].map(f => ({
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
    const top = options.mode === 'low_top' ? 0.89 : 0.97;
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
      conditionChange: options.mode === 'condition_change' ? 0.02 : 0.001,
      independentMeaning: options.mode === 'extra_meaning' ? 0.02 : 0.001 });
  });
  const client = createCandidateChoiceClient({ proxyUrl: 'https://choice.fixture', getToken: async () => 'fixture', transport,
    semanticPolicy: { calibrationEvidenceId: 'synthetic-only', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 } });
  const choose = vi.fn(client.choose);
  const continueSelectedTurn = vi.fn(async ({ snapshot, graph: selectedGraph }: { snapshot: PlanningState; graph: typeof graph }) => {
    if (options.stale === 'continuation') h.replaceState({ ...h.getState(), intakeState: { ...h.getState().intakeState!,
      lastQuestionContext: { ...h.getState().intakeState!.lastQuestionContext!, actionId: 'replaced-question' } } });
    return { state: { ...snapshot.intakeState!, questions: [], lastQuestionContext: undefined },
      message: '反映しました。', draftCandidates: [], stableV5Graph: selectedGraph, responseSource: 'deterministic_fallback' as const };
  });
  const domain = createNumericPendingRegisteredDomainV5(D5_EXACT_MINUTE_CANDIDATES, D5_ANSWER_PROPOSAL_POLICY_VERSION,
    { candidateSource: 'answer_proposal' });
  const route = registerControlledCandidateDomain(domain, {
    policy: { id: 'synthetic-only', calibrationEvidenceId: 'synthetic-only', rules: Array.from({ length: 8 }, (_, i) => ({
      menuKind: 'leaves' as const, optionCount: i + 2, depth: 0, minimumTopProbability: 0.90, minimumMargin: 0.80 })) },
    maximumChildrenPerMenu: 8, maximumDecisions: 1, choose, sourceAccess: () => 'allowed',
    inputForTurn: turn => weeklyPlanningTurnRuntimeGateway.prepareCandidateInput!({ ...turn, userId: OWNER,
      selectedDate: WEEK, plans: [], scheduleTemplates: [] }).normalizerInput,
    requestContextForTurn: pending => weeklyPlanningTurnRuntimeGateway.candidateRequestContext!(pending, { timeZone: 'Asia/Tokyo' }),
    continueSelectedTurn,
  });
  const present = () => h.submit('計画を相談します', { c5LocalSelection: undefined, candidateDomains: [route],
    execute: async () => ({ state: { ...createInitialPlanningIntakeState(), questions: ['どのくらいかかりますか？'],
      lastQuestionContext: { kind: 'ambiguity', topicId: 'work-a', targetSlot: 'stable_v5:missing_effort_estimate', intent: measurement } },
      message: 'どのくらいかかりますか？', draftCandidates: [], stableV5Graph: graph,
      questionPresentationContent: { responseSource: 'ai', currentTurnGrounding: 'none', selfRepairNotice: false,
        groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false } }) });
  const fallback = vi.fn(async ({ snapshot }: { snapshot: PlanningState }) => ({ state: snapshot.intakeState!,
    message: 'Luna', draftCandidates: [] }));
  const answer = (text: string) => h.submit(text, { c5LocalSelection: undefined, candidateDomains: [route], execute: fallback });
  return { h, graph, domain, present, answer, choose, transport, fallback, continueSelectedTurn };
}

describe('D5 answer proposal through canonical controller commit', () => {
  it('rebinds the numeric policy revision and preserves the question-time record', async () => {
    const run = setup(); await run.present();
    const frozen = run.h.getState().intakeState!.lastQuestionContext!.controlledCandidate!;
    const before = JSON.stringify(frozen);
    const proposal = run.domain.proposeAnswerPayload!({ target: frozen.basis.binding.target, scope: frozen.basis.binding.scope,
      sources: frozen.basis.binding.sources, candidates: frozen.basis.candidates, domainData: frozen.domainData }, '1問5分です')!;
    expect(proposal.domainData.domainMinutes).toEqual([1, 60, 5, 300]);
    expect(JSON.parse(proposal.sources.find(s => s.id === 'numeric-domain-policy')!.revision)).toEqual({
      domainPolicyVersion: D5_ANSWER_PROPOSAL_POLICY_VERSION, domain: [1, 60, 5, 300] });
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
