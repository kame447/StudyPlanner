import { afterEach, describe, expect, it, vi } from 'vitest';
import * as manifestModule from '../application/candidateSelection/manifest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningMessage } from '../types';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningSemanticBaseMessagesV5 } from './weeklyPlanningSemanticPromptAssemblyV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { selectReplyReferenceHintV5, type ReplyReferenceChoiceCalibrationV5 } from './weeklyPlanningReplyReferenceChoiceV5';
import { buildReplyReferenceSnapshotV5, createReplyReferenceSnapshotV5, extractReplyReferenceEvidenceV5,
  resolveReplyReferenceCandidateV5, type ReplyReferenceSourceV5 } from './weeklyPlanningReplyReferenceCandidatesV5';

const source = (turnId: string) => ({ conversationId: 'c', turnId, semanticLocalId: 'local', sourceText: '入力', origin: 'user' as const });
afterEach(() => vi.restoreAllMocks());
const messages: WeeklyPlanningMessage[] = [
  { id: 'c:turn:1:user', role: 'user', content: '数学をやりたい', createdAt: '2026-10-17T00:00:00Z' },
  { id: 'c:turn:2:user', role: 'user', content: '青チャートの微積分を20問', createdAt: '2026-10-17T00:01:00Z' },
  { id: 'c:turn:3:assistant', role: 'assistant', content: '1問あたりの時間は？', createdAt: '2026-10-17T00:02:00Z' },
];
function fixture() {
  const graph = createEmptyWeeklyPlanningFactGraphV5(); graph.revision = 3;
  graph.tasks.push({ id: 'task', title: '数学', category: 'study', source: source('c:request:1'), createdRevision: 1 });
  graph.components.push(
    { id: 'material', taskId: 'task', parentComponentId: null, label: '青チャート', role: 'material', source: source('c:request:2'), createdRevision: 2 },
    { id: 'topic', taskId: 'task', parentComponentId: 'material', label: '微積分', role: 'topic', source: source('c:request:2'), createdRevision: 2 });
  graph.workloads.push({ id: 'work', taskId: 'task', componentId: 'topic', quantityRole: 'target', amount: 20,
    unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false,
    periodExpression: null, source: source('c:request:2'), createdRevision: 3 });
  graph.factLifecycles = [...graph.tasks, ...graph.components, ...graph.workloads].map(fact => ({
    factId: fact.id, status: 'active' as const, createdRevision: fact.createdRevision, terminalRevision: null, supersededByFactId: null }));
  return graph;
}
function question(): PlanningIntakeState {
  return { lastQuestionContext: { kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate', topicId: 'work', intent: 'duration_per_unit', presentation: {
    version: 1, turnId: 'c:turn:3', assistantMessageId: 'c:turn:3:assistant', planningStateRevision: 7, graphRevision: 3,
    content: { responseSource: 'deterministic_fallback', currentTurnGrounding: 'none', selfRepairNotice: false,
      groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false },
  } } } as PlanningIntakeState;
}
function compilation(graph: ReturnType<typeof fixture>) {
  return { graphRevision: graph.revision, issues: compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph),
    context: { ownerId: 'owner', currentDate: '2026-10-17', planningStartDate: '2026-10-19', planningEndDate: '2026-10-25', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
  }).issues };
}
function input(graph = fixture()): ReplyReferenceSourceV5 {
  return { graph, messages, previousState: question(), inputStateRevision: 7, conversationId: 'c', compilation: compilation(graph) };
}
describe('compiler-owned open reply destinations', () => {
  it('deduplicates while preserving user source and separately marks the current assistant question', () => {
    const current = input(), before = structuredClone(current.graph), snapshot = createReplyReferenceSnapshotV5(current)!;
    expect(snapshot.candidates).toEqual([expect.objectContaining({ sourceMessageId: 'c:turn:2:user', sourceTurnId: 'c:request:2',
      targetKind: 'workload', targetFactId: 'work', componentPath: ['青チャート', '微積分'], slot: 'duration_per_unit' })]);
    expect(snapshot.pendingQuestion).toEqual({ messageOrdinal: 3, questionCode: 'stable_v5:missing_effort_estimate', candidateKeys: [snapshot.candidates[0].key] });
    expect(snapshot.dialogueHistory).toEqual(messages.map((message, index) => ({ messageOrdinal: index + 1, role: message.role, content: message.content })));
    expect(resolveReplyReferenceCandidateV5(snapshot, snapshot.candidates[0].key, current)).toEqual(snapshot.candidates[0]);
    expect(resolveReplyReferenceCandidateV5(snapshot, 'missing', current)).toBeNull();
    expect(current.graph).toEqual(before);
  });
  it('does not offer the same time at every level, or offer already resolved slots', () => {
    const graph = fixture(); graph.workloads[0].quantityRole = 'unknown';
    const snapshot = createReplyReferenceSnapshotV5(input(graph))!;
    expect(snapshot.candidates.map(item => item.slot).sort()).toEqual(['duration_per_unit', 'quantity_role']);
    expect(snapshot.candidates.every(item => item.targetKind === 'workload')).toBe(true);
    graph.workloads[0].quantityRole = 'target';
    graph.effortEstimates.push({ id: 'estimate', taskId: 'task', targetFactId: 'work', kind: 'duration_per_unit', minutes: 4,
      unitCode: 'problem', precision: 'exact', source: source('c:request:2'), createdRevision: 3 });
    graph.factLifecycles.push({ factId: 'estimate', status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null });
    expect(buildReplyReferenceSnapshotV5(input(graph))).toMatchObject({ snapshot: null, diagnostics: { reason: 'no_open_slots', candidateCount: 0 } });
  });
  it('excludes inactive ancestry without disabling a separate valid destination', () => {
    const graph = fixture(); graph.factLifecycles.find(item => item.factId === 'material')!.status = 'removed';
    graph.workloads.push({ ...graph.workloads[0], id: 'other', componentId: null });
    graph.factLifecycles.push({ ...graph.factLifecycles.find(item => item.factId === 'work')!, factId: 'other' });
    const built = buildReplyReferenceSnapshotV5(input(graph));
    expect(built.snapshot?.candidates.map(item => item.targetFactId)).toEqual(['other']);
    expect(built.diagnostics.excludedAncestorCount).toBe(1); expect(built.snapshot?.pendingQuestion).toBeNull();
  });
  it('prunes over 64 by pending question, newest anchor, then stable identity with count-only diagnostics', async () => {
    const graph = fixture();
    graph.workloads[0].source = source('c:request:1');
    for (let index = 0; index < 70; index++) {
      const id = index === 69 ? 'zzz-newest' : 'work-' + index;
      graph.workloads.push({ ...graph.workloads[0], id, source: source(index === 69 ? 'c:request:2' : 'c:request:1') });
      graph.factLifecycles.push({ factId: id, status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null });
    }
    const built = buildReplyReferenceSnapshotV5(input(graph));
    expect(built.diagnostics).toMatchObject({ reason: 'pruned', candidateCountBeforePrune: 71, candidateCount: 64, prunedCount: 7 });
    expect(built.snapshot?.candidates[0].targetFactId).toBe('work');
    expect(built.snapshot?.candidates[0].sourceMessageId).toBe('c:turn:1:user');
    expect(built.snapshot?.candidates[1].targetFactId).toBe('zzz-newest');
    expect(built.snapshot?.pendingQuestion?.candidateKeys).toEqual([built.snapshot!.candidates[0].key]);
    expect(buildReplyReferenceSnapshotV5(input(graph))).toEqual(built); expect(JSON.stringify(built.diagnostics)).not.toContain('work-');
    const current = input(graph);
    expect(await selectReplyReferenceHintV5({ ...args(current), port: { choose: async (request, beforeDispatch) => {
      expect(request.menu.kind).toBe('leaves'); expect(request.menu.options).toHaveLength(65);
      beforeDispatch(); return response(request, built.snapshot!.pendingQuestion!.candidateKeys[0]);
    } } })).toMatchObject({ targetFactId: 'work' });
  });
  it('requires current compilation and respects the question-time measurement rather than recomputing it', () => {
    const current = input(); current.previousState!.lastQuestionContext!.intent = 'session_duration';
    expect(createReplyReferenceSnapshotV5(current)?.candidates[0].slot).toBe('session_duration');
    delete current.previousState!.lastQuestionContext!.intent;
    expect(createReplyReferenceSnapshotV5(current)?.pendingQuestion).toBeNull();
    expect(buildReplyReferenceSnapshotV5({ ...current, compilation: undefined }).diagnostics.reason).toBe('missing_compilation');
    expect(buildReplyReferenceSnapshotV5({ ...current, compilation: { ...current.compilation!, graphRevision: 2 } }).diagnostics.reason).toBe('stale_compilation');
  });
  it('validates compiler-provided completed-work evidence and its separate scheduling workload', () => {
    const graph = fixture(); graph.workloads[0].quantityRole = 'completed';
    graph.workloads.push({ ...graph.workloads[0], id: 'remaining', quantityRole: 'remaining' });
    graph.factLifecycles.push({ ...graph.factLifecycles.find(item => item.factId === 'work')!, factId: 'remaining' });
    const current = input(graph);
    current.compilation = { graphRevision: 3, issues: [{ domain: 'work_item', code: 'missing_effort_estimate', blocking: true, factId: 'work',
      details: { estimateForWorkloadFactId: 'remaining', questionBasis: 'completed_workload_total' } }] };
    Object.assign(current.previousState!.lastQuestionContext!, { intent: 'total_duration', estimateForWorkloadFactId: 'remaining', questionBasis: 'completed_workload_total' });
    const snapshot = createReplyReferenceSnapshotV5(current)!;
    expect(snapshot.candidates[0]).toMatchObject({ targetFactId: 'work', slot: 'total_duration' });
    expect(snapshot.pendingQuestion?.candidateKeys).toEqual([snapshot.candidates[0].key]);
    graph.factLifecycles.find(item => item.factId === 'remaining')!.status = 'removed';
    expect(createReplyReferenceSnapshotV5(current)).toBeNull();
  });
  it('uses ancestor user anchors first and assistant anchors only when no user source remains', () => {
    const current = input();
    current.messages = [messages[1], ...Array.from({ length: 8 }, (_, index) => ({ ...messages[0], id: `c:turn:${index + 4}:user` })),
      { ...messages[0], id: 'c:turn:12:user' }, { ...messages[2], id: 'c:turn:13:assistant' }];
    current.graph.tasks[0].source.turnId = 'c:request:12';
    Object.assign(current.previousState!.lastQuestionContext!.presentation!, { turnId: 'c:turn:13', assistantMessageId: 'c:turn:13:assistant' });
    expect(createReplyReferenceSnapshotV5(current)?.candidates[0]).toMatchObject({ sourceMessageId: 'c:turn:12:user', sourceTurnId: 'c:request:12' });
    current.graph.tasks[0].source.turnId = 'c:request:1';
    expect(createReplyReferenceSnapshotV5(current)?.candidates[0]).toMatchObject({ sourceMessageId: 'c:turn:13:assistant', sourceTurnId: 'c:turn:13' });
  });
  it('keeps long questions eligible and bounds history/labels without splitting emoji', () => {
    const current = input(); current.graph.tasks[0].title = '📘'.repeat(700);
    current.messages = messages.map(message => ({ ...message, content: '📚'.repeat(700) }));
    const snapshot = createReplyReferenceSnapshotV5(current)!;
    expect(snapshot.pendingQuestion).not.toBeNull();
    expect(snapshot.dialogueHistory.every(turn => Array.from(turn.content).length === 600)).toBe(true);
    expect(Array.from(snapshot.candidates[0].label).length).toBeLessThanOrEqual(300); expect(snapshot.candidates[0].label).not.toContain('\ufffd');
  });
  it('rejects changed identity, transcript, revisions, answered, accompanied and terminal questions', () => {
    const original = input(), frozen = createReplyReferenceSnapshotV5(original)!, changed = question(), accompanied = question();
    changed.lastQuestionContext!.actionId = 'new-action'; accompanied.lastQuestionContext!.presentation!.content.selfRepairNotice = true;
    const variants = [{ ...original, previousState: changed }, { ...original, inputStateRevision: 8 }, { ...original, previousState: undefined },
      { ...original, previousState: accompanied }, { ...original, messages: messages.map(message => ({ ...message, content: message.content + '改訂' })) },
      { ...original, messages: [...messages, { ...messages[0], id: 'c:turn:4:user' }] }, { ...original, graph: { ...original.graph, revision: 4 } }];
    for (const current of variants) expect(resolveReplyReferenceCandidateV5(frozen, frozen.candidates[0].key, current)).toBeNull();
    original.graph.factLifecycles.find(item => item.factId === 'work')!.status = 'superseded';
    expect(createReplyReferenceSnapshotV5(original)).toBeNull(); expect(createReplyReferenceSnapshotV5({ ...input(), conversationId: 'other' })).toBeNull();
  });
  it('copies only independently validated source offsets', () => {
    const text = '数学を📘で3分くらい';
    expect(extractReplyReferenceEvidenceV5(text, { start: text.indexOf('3分'), end: text.indexOf('3分') + 2 })).toBe('3分');
    for (const span of [{ start: -1, end: 2 }, { start: 4, end: 5 }, { start: 0, end: 0 }]) expect(extractReplyReferenceEvidenceV5(text, span)).toBeNull();
  });
});

type ChoiceRequest = Parameters<Parameters<typeof selectReplyReferenceHintV5>[0]['port']['choose']>[0];
function calibration(current: ReplyReferenceSourceV5): ReplyReferenceChoiceCalibrationV5 {
  return { maximumChildrenPerMenu: 64, policy: { id: 'test-only', calibrationEvidenceId: 'mock-only', rules: [{ menuKind: 'leaves',
    optionCount: createReplyReferenceSnapshotV5(current)!.candidates.length + 1, depth: 0, minimumTopProbability: 0.9, minimumMargin: 0.8 }] },
    semanticPolicy: { calibrationEvidenceId: 'mock-only', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 } };
}
function response(request: ChoiceRequest, key: string, sufficiency = 'only_candidate_meaning') {
  const selected = request.menu.options.find(option => option.kind === 'leaf' && option.candidate.id === key)!;
  return { requestId: request.requestId, nodeId: request.menu.nodeId, selectionEpoch: request.selectionEpoch, candidateSetHash: request.candidateSetHash,
    optionId: selected.id, semanticSufficiency: sufficiency,
    probabilities: request.menu.options.map(option => ({ optionId: option.id, probability: option.id === selected.id ? 0.99 : option.id === 'none' ? 0.01 : 0 })) };
}
function args(current = input()) { return { source: current, readCurrent: () => current, userText: '4分くらい', ownerId: 'owner', conversationId: 'c', requestId: 'next', calibration: calibration(current) }; }
describe('pending-question-only read-only acceptance', () => {
  it('passes user source and pending marker while excluding private identity values', async () => {
    const manifestSpy = vi.spyOn(manifestModule, 'createCandidateManifest');
    const current = input(); current.previousState!.lastQuestionContext!.actionId = 'private-action-marker';
    current.previousState!.lastQuestionContext!.presentation!.turnId = 'private-presentation-marker';
    const result = await selectReplyReferenceHintV5({ ...args(current), port: { choose: async (request, beforeDispatch) => {
      expect(request.menu.options[0]).toMatchObject({ candidate: { tuple: { messageOrdinal: 2 } } });
      expect(request.context.scope.pendingQuestion).toMatchObject({ messageOrdinal: 3, candidateKeys: ['reply-ref:0'] });
      for (const value of ['private-action-marker', 'private-presentation-marker', 'assistantMessageId', 'taskFactId']) expect(JSON.stringify(request)).not.toContain(value);
      beforeDispatch(); return response(request, 'reply-ref:0');
    } } });
    expect(result).toMatchObject({ sourceMessageId: 'c:turn:2:user', targetFactId: 'work', slot: 'duration_per_unit' });
    const revision = manifestSpy.mock.calls[0][0].binding.sources[0].revision;
    expect(revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(revision).not.toContain('private-action-marker');
  });
  it('rejects non-pending references even with mocked sufficient heads and a passing probability gate', async () => {
    const current = input(); current.graph.workloads[0].quantityRole = 'unknown'; current.compilation = compilation(current.graph);
    const key = createReplyReferenceSnapshotV5(current)!.candidates.find(item => item.slot === 'quantity_role')!.key;
    expect(await selectReplyReferenceHintV5({ ...args(current), port: { choose: async (request, beforeDispatch) => {
      beforeDispatch(); return response(request, key);
    } } })).toBeNull();
  });
  it('hashes canonical question identity and rejects in-flight changes', async () => {
    const hashes: string[] = [];
    for (const marker of ['action-a', 'action-b']) {
      const current = input(); current.previousState!.lastQuestionContext!.actionId = marker;
      await selectReplyReferenceHintV5({ ...args(current), port: { choose: async (request, beforeDispatch) => { hashes.push(request.candidateSetHash); beforeDispatch(); return null; } } });
    }
    expect(hashes).toHaveLength(2); expect(hashes[0]).not.toBe(hashes[1]);
    const current = input();
    expect(await selectReplyReferenceHintV5({ ...args(current), port: { choose: async (request, beforeDispatch) => {
      beforeDispatch(); current.previousState!.lastQuestionContext!.actionId = 'changed-after-send'; return response(request, 'reply-ref:0');
    } } })).toBeNull();
  });
  it('reports count-only disable reasons and never dispatches without calibration or compiler evidence', async () => {
    const current = input(), calls: unknown[] = [], diagnostics: unknown[] = [];
    const base = { ...args(current), onDiagnostic: (value: unknown) => diagnostics.push(value), port: { choose: async () => { calls.push(1); return null; } } };
    expect(await selectReplyReferenceHintV5({ ...base, calibration: null })).toBeNull(); current.compilation = undefined;
    expect(await selectReplyReferenceHintV5(base)).toBeNull(); expect(calls).toEqual([]);
    expect(diagnostics).toEqual([expect.objectContaining({ reason: 'missing_compilation', candidateCount: 0 })]);
  });
  it('reports an over-budget request without sending it or truncating the current utterance', async () => {
    const calls: unknown[] = [], diagnostics: unknown[] = [];
    expect(await selectReplyReferenceHintV5({ ...args(), userText: '長'.repeat(3000),
      onDiagnostic: value => diagnostics.push(value), port: { choose: async () => { calls.push(1); return null; } } })).toBeNull();
    expect(calls).toEqual([]); expect(diagnostics).toEqual([
      expect.objectContaining({ reason: 'eligible' }), expect.objectContaining({ reason: 'invalid_request' })]);
    expect(JSON.stringify(diagnostics)).not.toContain('長');
  });
  it('bounds provider labels by codepoints and retains the entire current user text', async () => {
    const current = input(); current.messages = messages.map(message => message.role === 'user' ? { ...message, content: '📚'.repeat(700) } : message);
    current.graph.tasks[0].title = '📘'.repeat(700); const whole = '4分くらい。' + '続き'.repeat(400);
    await selectReplyReferenceHintV5({ ...args(current), userText: whole, port: { choose: async (request, beforeDispatch) => {
      expect(request.wholeUtterance).toBe(whole);
      for (const option of request.menu.options) if (option.kind === 'leaf') { expect(option.candidate.label.length).toBeLessThanOrEqual(1000); expect(option.candidate.label).not.toContain('\ufffd'); }
      beforeDispatch(); return response(request, 'reply-ref:0', 'extra_or_uncertain_meaning');
    } } });
  });
});
it('keeps hints non-authoritative in the ordinary whole-turn Luna prompt', () => {
  const baseline = createWeeklyPlanningSemanticBaseMessagesV5({ userText: '4分くらい', publicStateSummary: {} });
  const hinted = createWeeklyPlanningSemanticBaseMessagesV5({ userText: '4分くらい', publicStateSummary: { replyReferenceHint: {
    targetFactId: 'work', slot: 'duration_per_unit', authority: 'non_authoritative_semantic_hint' } } });
  expect(baseline[0].content).not.toContain('replyReferenceHint'); expect(hinted[0].content).toContain('independently extract and validate'); expect(hinted[1].content).toContain('replyReferenceHint');
});
