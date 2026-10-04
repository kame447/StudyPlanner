import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage, createDeferred } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest, hydrateWeeklyPlanningStableV5RuntimeSession } from '../weeklyPlanningStableV5RuntimeSession';
import { loadWeeklyPlanningStableV5PersistedSession, getWeeklyPlanningStableV5SessionStorageKeyForTest } from '../weeklyPlanningStableV5SessionStorage';
import { weeklyPlanningReducer } from '../../weeklyPlanningReducer';
import { parseWeeklyPlanningStableV5PersistedSession } from '../weeklyPlanningStableV5SessionCodec';
import { cancelWeeklyPlanningControlledTurn, clearWeeklyPlanningControlledConversation, resetWeeklyPlanningControlledSession } from '../../weeklyPlanningTurnController';
import { readC5RuntimeGraph, recoverC5ControlledTurn, hasC5Recovery } from './controlledCommit';
import { c5ControllerHarness, resolution, OWNER, WEEK } from './controller.testUtils';
import { captureC5Question, narrowC5EffortBasis, serializeC5Value, serializeC5ApplicationState } from './basis';

let memory: ReturnType<typeof createMemoryStorageHarness>;
let restore: () => void;
beforeEach(() => { memory = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(memory.storage); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); });
afterEach(() => { restore(); vi.restoreAllMocks(); });
const reload = () => loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })!;

describe('C5 actual controller / reducer / runtime / acknowledged storage', () => {
  it('captures the full ordered question payload, resolves only its cohort, and reloads graph+consumption together', async () => {
    const h = c5ControllerHarness(); expect((await h.present()).accepted).toBe(true);
    const frozen = structuredClone(h.getState().intakeState!.lastQuestionContext!.c5!);
    expect(frozen.cohort).toEqual(['estimate-5', 'estimate-7']);
    expect(frozen.candidates[0].tuple).toMatchObject({ estimateId: 'estimate-5', measurement: 'duration_per_unit', minutes: 5, precision: 'exact' });
    expect(reload().planningState.intakeState!.lastQuestionContext!.c5).toEqual(frozen);
    const request = vi.spyOn(h.options, 'choose'); const luna = vi.fn();
    expect((await h.submit('教材aは1問7分です', { execute: luna })).accepted).toBe(true);
    expect(luna).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1);
    const provider = request.mock.calls[0][0];
    expect(provider.context.scope.reference).toBe('content_addressed_only');
    expect(provider.menu.options.filter((o) => o.kind === 'leaf').map((o) => o.kind === 'leaf' ? o.candidate : null)).toEqual(frozen.candidates);
    expect(JSON.stringify(provider)).not.toContain('private-source-');
    const next = readC5RuntimeGraph(OWNER, h.conversationId);
    expect(resolution(h.graph, 'work-a').ambiguous).toBe(true);
    expect(resolution(next, 'work-a')).toMatchObject({ ambiguous: false, estimatedMinutes: 70, sourceFactIds: ['estimate-7'] });
    expect(resolution(next, 'work-b')).toEqual(resolution(h.graph, 'work-b'));
    expect(next.tasks).toEqual(h.graph.tasks); expect(next.workloads).toEqual(h.graph.workloads); expect(next.effortEstimates).toEqual(h.graph.effortEstimates);
    expect(next.factLifecycles.find((f) => f.factId === 'estimate-5')).toMatchObject({ status: 'superseded', supersededByFactId: 'estimate-7' });
    expect(next.factLifecycles.filter((f) => f.factId !== 'estimate-5')).toEqual(h.graph.factLifecycles.filter((f) => f.factId !== 'estimate-5'));
    const saved = reload(); expect(saved.graph).toEqual(next);
    expect(saved.planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
    expect(saved.planningState.intakeState!.c5SelectionLedger!.consumed[0].candidateSetHash).toBe(provider.candidateSetHash);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, conversationId: h.conversationId, weekStartDate: WEEK, graph: saved.graph });
    h.replaceState(saved.planningState);
    await h.submit('教材aは1問7分です');
    expect(request).toHaveBeenCalledTimes(1); expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(next);
  });

  it.each(['none', 'mixed', 'low', 'malformed', 'ordinal', 'deictic'])('returns the complete utterance to the regular route on %s typed abstention (not language-accuracy evidence)', async (mode) => {
    const h = c5ControllerHarness(); await h.present();
    const original = h.options.choose;
    h.options.choose = async (req, before) => {
      const value = await original(req, before) as Record<string, unknown>;
      if (mode === 'malformed') return { ...value, unexpected: true };
      if (mode === 'mixed' || mode === 'ordinal' || mode === 'deictic') return { ...value, semanticSufficiency: 'unsupported_meaning' };
      const selectedId = req.menu.options.find((o) => o.kind === 'leaf' && o.candidate.id === 'estimate-7')!.id;
      const optionId = mode === 'none' ? 'none' : selectedId;
      return { ...value, optionId, probabilities: req.menu.options.map((o) => ({ optionId: o.id,
        probability: mode === 'none' ? (o.id === 'none' ? 0.96 : 0.02) : (o.id === selectedId ? 0.6 : 0.2) })) };
    };
    const text = '教材aは1問7分。ただし別の教材の量も変えたい。全文を保持する';
    const execute = vi.fn(async ({ snapshot }) => ({ state: snapshot.intakeState!, message: 'Luna', draftCandidates: [] }));
    expect((await h.submit(text, { execute })).accepted).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1); expect(execute.mock.calls[0][0].userText).toBe(text);
    expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(h.graph);
    expect(h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  });

  it('does not build a new candidate payload from live graph after reload/old session, and does not expose denied sources', async () => {
    const h = c5ControllerHarness(); await h.present();
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK);
    const raw = JSON.parse(memory.values.get(key)!); delete raw.requiredCapabilities;
    memory.values.set(key, JSON.stringify(raw)); const old = reload();
    expect(old.planningState.intakeState!.c5SelectionLedger).toBeUndefined();
    expect(old.planningState.intakeState!.lastQuestionContext!.c5).toBeUndefined();
    h.replaceState(old.planningState); const choose = vi.spyOn(h.options, 'choose'); await h.submit('7分'); expect(choose).not.toHaveBeenCalled();
    const denied = c5ControllerHarness(); await denied.present(); denied.controls.access = 'denied';
    const hidden = vi.spyOn(denied.options, 'choose'); await denied.submit('7分'); expect(hidden).not.toHaveBeenCalled();
  });

  it('rejects unknown capability and structurally corrupt fixed payload without silently dropping a ledger', async () => {
    const h = c5ControllerHarness(); await h.present(); const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK);
    const raw = JSON.parse(memory.values.get(key)!);
    const parse = (v: unknown) => parseWeeklyPlanningStableV5PersistedSession({ raw: JSON.stringify(v), ownerId: OWNER, weekStartDate: WEEK });
    expect(parse({ ...raw, requiredCapabilities: ['c5-local-selection-v2'] })).toBeNull();
    raw.planningState.intakeState.lastQuestionContext.c5.candidates.reverse(); expect(parse(raw)).toBeNull();
    // Pre-extension reader's strict top-level allowlist rejects requiredCapabilities: downgrade is fail-closed.
    expect(Object.keys(JSON.parse(memory.values.get(key)!)).some((key) => !['version','ownerId','weekStartDate','conversationId','graph','planningState','savedAt'].includes(key))).toBe(true);
  });

  it.each(['graph', 'question', 'permission'])('rechecks %s after selected continuation await and before actual commit', async (change) => {
    const h = c5ControllerHarness(); await h.present(); const ledger = structuredClone(h.getState().intakeState!.c5SelectionLedger);
    const continuing = createDeferred<void>(); const entered = createDeferred<void>(); const original = h.options.continueSelectedTurn;
    h.options.continueSelectedTurn = async (p) => { entered.resolve(); await continuing.promise; return original(p); };
    const pending = h.submit('教材aは1問7分'); await entered.promise;
    if (change === 'graph') hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, conversationId: h.conversationId,
      weekStartDate: WEEK, graph: { ...h.graph, revision: 4 } });
    if (change === 'question') h.replaceState({ ...h.getState(), intakeState: { ...h.getState().intakeState!,
      lastQuestionContext: { ...h.getState().intakeState!.lastQuestionContext!, actionId: 're-presented' } } });
    if (change === 'permission') h.controls.access = 'denied'; continuing.resolve();
    expect((await pending).accepted).toBe(false); expect(h.getState().intakeState!.c5SelectionLedger).toEqual(ledger);
    expect(readC5RuntimeGraph(OWNER, h.conversationId).effortEstimates).toEqual(h.graph.effortEstimates);
    expect(readC5RuntimeGraph(OWNER, h.conversationId).factLifecycles).toEqual(h.graph.factLifecycles);
  });

  it('rolls back graph, full state and ledger when the actual reducer refuses commit_turn', async () => {
    const h = c5ControllerHarness(); await h.present(); const before = structuredClone(h.getState()); const stored = [...memory.values];
    h.controls.beforeReducer = (action) => { if (action.type === 'commit_turn' && action.c5Commit) h.controls.access = 'denied'; };
    expect((await h.submit('教材aは1問7分')).accepted).toBe(false);
    expect(h.actions.some((a) => a.type === 'commit_turn' && a.c5Commit)).toBe(true);
    expect(h.getState()).toEqual(before); expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(h.graph); expect([...memory.values]).toEqual(stored);
  });

  it('rolls back known storage failure and retains consumption under quota reduction', async () => {
    const h = c5ControllerHarness(); await h.present(); const before = structuredClone(h.getState()); const stored = [...memory.values];
    const set = vi.spyOn(memory.storage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect((await h.submit('教材aは1問7分')).accepted).toBe(false); expect(h.getState()).toEqual(before);
    expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(h.graph); expect([...memory.values]).toEqual(stored);
    set.mockImplementation((key, value) => { if (JSON.parse(value).planningState.messages.length > 1) throw new Error('QuotaExceededError'); memory.values.set(key, value); });
    expect((await h.submit('教材aは1問7分')).accepted).toBe(true);
    expect(reload().planningState.messages.length).toBeLessThanOrEqual(1); expect(reload().planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
    expect(resolution(reload().graph, 'work-a').estimatedMinutes).toBe(70);
  });

  it('recognizes commit-then-throw from dispatch and storage without reapplying selection', async () => {
    const h = c5ControllerHarness(); await h.present();
    vi.spyOn(memory.storage, 'setItem').mockImplementation((key, value) => { memory.values.set(key, value); throw new Error('after write'); });
    const dispatch = (action: Parameters<typeof h.dispatch>[0]) => { const value = h.dispatch(action); if (action.type === 'commit_turn') throw new Error('after dispatch'); return value; };
    expect((await h.submit('教材aは1問7分', { dispatch })).accepted).toBe(true);
    expect(reload().planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1); expect(readC5RuntimeGraph(OWNER, h.conversationId).revision).toBe(4);
  });

  it('blocks new turns on unreadable outcome and recovers the exact envelope without a second provider dispatch', async () => {
    const h = c5ControllerHarness(); await h.present(); let unreadable = false;
    vi.spyOn(memory.storage, 'setItem').mockImplementation((key, value) => { memory.values.set(key, value); unreadable = true; throw new Error('after write'); });
    vi.spyOn(memory.storage, 'getItem').mockImplementation((key) => { if (unreadable) throw new Error('unreadable'); return memory.values.get(key) ?? null; });
    const choose = vi.spyOn(h.options, 'choose');
    expect(await h.submit('教材aは1問7分')).toMatchObject({ accepted: false, recoveryRequired: true });
    const state = serializeC5ApplicationState(h.getState()); const graph = serializeC5Value(readC5RuntimeGraph(OWNER, h.conversationId));
    expect(await h.submit('別の入力')).toMatchObject({ recoveryRequired: true });
    expect(cancelWeeklyPlanningControlledTurn({ getState: h.getState, dispatch: h.dispatch })).toBe(false);
    expect(clearWeeklyPlanningControlledConversation({ getState: h.getState, dispatch: h.dispatch })).toBe(false);
    expect(resetWeeklyPlanningControlledSession({ session: h.session, ownerId: OWNER, getState: h.getState, dispatch: h.dispatch })).toEqual(h.getState()); expect(choose).toHaveBeenCalledTimes(1);
    expect(recoverC5ControlledTurn(OWNER, h.conversationId)).toMatchObject({ recoveryRequired: true });
    expect(serializeC5ApplicationState(h.getState())).toBe(state); expect(serializeC5Value(readC5RuntimeGraph(OWNER, h.conversationId))).toBe(graph);
    unreadable = false; expect(recoverC5ControlledTurn(OWNER, h.conversationId).accepted).toBe(true); expect(hasC5Recovery(OWNER, h.conversationId)).toBe(false);
    expect(reload().planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1); expect(choose).toHaveBeenCalledTimes(1);
  });

  it.each(['add','delete','reorder','rename','new-id','source-revision'])('rejects live candidate drift %s without exposing a reconstructed population', async (change) => {
    const h = c5ControllerHarness(); await h.present(); const changed = structuredClone(h.graph);
    if (change === 'add') { const fact = { ...changed.effortEstimates[0], id: 'new-estimate', minutes: 9 }; changed.effortEstimates.push(fact);
      changed.factLifecycles.push({ factId: fact.id, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }); }
    if (change === 'delete') { changed.effortEstimates.shift(); changed.factLifecycles = changed.factLifecycles.filter((f) => f.factId !== 'estimate-5'); }
    if (change === 'reorder') changed.effortEstimates.reverse();
    if (change === 'rename') changed.tasks[0].title = 'changed title';
    if (change === 'new-id') { changed.effortEstimates[0].id = 'same-label-new-id'; changed.factLifecycles.find((f) => f.factId === 'estimate-5')!.factId = 'same-label-new-id'; }
    if (change === 'source-revision') changed.effortEstimates[0].source.sourceText = 'new private evidence';
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, conversationId: h.conversationId, weekStartDate: WEEK, graph: changed });
    const choose = vi.spyOn(h.options, 'choose'); const text = '教材aは1問7分';
    const execute = vi.fn(async ({ snapshot }) => ({ state: snapshot.intakeState!, message: 'Luna', draftCandidates: [] }));
    await h.submit(text, { execute }); expect(choose).not.toHaveBeenCalled(); expect(execute.mock.calls[0][0].userText).toBe(text);
    expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(changed); expect(h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]);
  });

  it('advances re-presentation epoch, preserves consumed history, and never captures superseded history as a candidate', async () => {
    const h = c5ControllerHarness(); await h.present(); const before = h.getState().intakeState!;
    const next = captureC5Question({ state: before, graph: h.graph, ownerId: OWNER, conversationId: h.conversationId });
    expect(next.c5SelectionLedger!.lastEpoch).toBe(2); expect(next.lastQuestionContext!.c5!.selectionEpoch).toBe(2);
    expect(next.c5SelectionLedger!.consumed).toEqual(before.c5SelectionLedger!.consumed);
    await h.submit('教材aは1問7分'); const saved = reload();
    const after = captureC5Question({ state: { ...before, c5SelectionLedger: saved.planningState.intakeState!.c5SelectionLedger },
      graph: saved.graph, ownerId: OWNER, conversationId: h.conversationId });
    expect(after.c5SelectionLedger).toEqual(saved.planningState.intakeState!.c5SelectionLedger);
    const spent = { ...before, c5SelectionLedger: saved.planningState.intakeState!.c5SelectionLedger };
    h.replaceState({ ...h.getState(), revision: before.lastQuestionContext!.presentation!.planningStateRevision,
      messages: h.getState().messages.slice(0, 2), intakeState: spent });
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, conversationId: h.conversationId, weekStartDate: WEEK, graph: h.graph });
    const choose = vi.spyOn(h.options, 'choose'); await h.submit('同じ回答'); expect(choose).not.toHaveBeenCalled();
    expect(h.getState().intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
  });

  it('recovers an unknown no-write outcome to a complete rollback before retry', async () => {
    const h = c5ControllerHarness(); await h.present(); const before = structuredClone(h.getState()); let unreadable = false;
    vi.spyOn(memory.storage, 'setItem').mockImplementation(() => { unreadable = true; throw new Error('no write'); });
    vi.spyOn(memory.storage, 'getItem').mockImplementation((key) => { if (unreadable) throw new Error('read failure'); return memory.values.get(key) ?? null; });
    expect(await h.submit('教材aは1問7分')).toMatchObject({ recoveryRequired: true });
    unreadable = false; expect(recoverC5ControlledTurn(OWNER, h.conversationId).accepted).toBe(false);
    expect(hasC5Recovery(OWNER, h.conversationId)).toBe(false); expect(h.getState()).toEqual(before); expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(h.graph);
  });

  it('rejects copied and already-used reducer capabilities even against the exact original begun state', async () => {
    const h = c5ControllerHarness(); await h.present(); const before = h.getState(); await h.submit('教材aは1問7分');
    const begin = h.actions.filter((a) => a.type === 'begin_turn').pop()!;
    const commit = h.actions.filter((a) => a.type === 'commit_turn').pop()!;
    if (commit.type !== 'commit_turn' || !commit.c5Commit) throw new Error('missing actual capability');
    const begun = weeklyPlanningReducer(before, begin);
    expect(weeklyPlanningReducer(begun, commit)).toBe(begun);
    expect(weeklyPlanningReducer(begun, { ...commit, c5Commit: structuredClone(commit.c5Commit) })).toBe(begun);
    expect(reload().planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1);
  });

  it('rechecks permission immediately after asynchronous provider preparation, with zero exposure on revocation', async () => {
    const h = c5ControllerHarness(); await h.present(); const prepared = createDeferred<void>(); const entered = createDeferred<void>(); let exposed = false;
    h.options.choose = async (_request, beforeDispatch) => { entered.resolve(); await prepared.promise; beforeDispatch(); exposed = true; return null; };
    const text = '教材aは1問7分。その全文'; const execute = vi.fn(async ({ snapshot }) => ({ state: snapshot.intakeState!, message: 'Luna', draftCandidates: [] }));
    const submit = h.submit(text, { execute }); await entered.promise; h.controls.access = 'denied'; prepared.resolve(); await submit;
    expect(exposed).toBe(false); expect(execute.mock.calls[0][0].userText).toBe(text); expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(h.graph);
  });

  it('keeps unknown recovery pending without overwriting intervening runtime work', async () => {
    const h = c5ControllerHarness(); await h.present(); let unreadable = false;
    vi.spyOn(memory.storage, 'setItem').mockImplementation((key, value) => { memory.values.set(key, value); unreadable = true; });
    vi.spyOn(memory.storage, 'getItem').mockImplementation((key) => { if (unreadable) throw new Error('unreadable'); return memory.values.get(key) ?? null; });
    expect(await h.submit('教材aは1問7分')).toMatchObject({ recoveryRequired: true });
    const selected = readC5RuntimeGraph(OWNER, h.conversationId); const intervening = { ...selected, revision: selected.revision + 1 };
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, conversationId: h.conversationId, weekStartDate: WEEK, graph: intervening });
    unreadable = false; expect(recoverC5ControlledTurn(OWNER, h.conversationId)).toMatchObject({ recoveryRequired: true });
    expect(readC5RuntimeGraph(OWNER, h.conversationId)).toEqual(intervening);
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, conversationId: h.conversationId, weekStartDate: WEEK, graph: selected });
    expect(recoverC5ControlledTurn(OWNER, h.conversationId).accepted).toBe(true);
  });

  it('retains the sibling ledger through ordinary Luna replacement and when the opt-in is removed', async () => {
    const h = c5ControllerHarness(); await h.present(); await h.submit('教材aは1問7分');
    const ledger = structuredClone(h.getState().intakeState!.c5SelectionLedger);
    const execute = vi.fn(async () => ({ state: { ...h.getState().intakeState!, c5SelectionLedger: undefined,
      lastQuestionContext: undefined, questions: ['次の質問'] }, message: 'Luna replaced question', draftCandidates: [] }));
    expect((await h.submit('別の質問です', { c5LocalSelection: undefined, execute })).accepted).toBe(true);
    expect(h.getState().intakeState!.c5SelectionLedger).toEqual(ledger);
  });

  it.each([false, true])('handles a three-candidate hierarchy with atomic whole-cohort application (revoke after parent=%s)', async (revoke) => {
    const h = c5ControllerHarness();
    h.graph.effortEstimates.push({ ...h.graph.effortEstimates[0], id: 'estimate-9', minutes: 9 });
    h.graph.factLifecycles.push({ factId: 'estimate-9', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, conversationId: h.conversationId, weekStartDate: WEEK, graph: h.graph });
    await h.present();
    const options = { ...h.options, maximumDecisions: 3, policy: { id: 'test-hierarchy', calibrationEvidenceId: 'synthetic-contract-only', rules: [
      { menuKind: 'groups' as const, optionCount: 3, depth: 0, minimumTopProbability: 0.9, minimumMargin: 0.8 },
      { menuKind: 'leaves' as const, optionCount: 3, depth: 1, minimumTopProbability: 0.9, minimumMargin: 0.8 },
    ] } };
    let calls = 0;
    options.choose = async (request, beforeDispatch) => {
      beforeDispatch(); calls++;
      const selected = request.menu.options.find((o) => o.kind === 'leaf' ? o.candidate.id === 'estimate-7'
        : o.kind === 'group' && o.candidates.some((c) => c.id === 'estimate-7'))!;
      if (request.menu.kind === 'groups' && revoke) h.controls.access = 'denied';
      return { nodeId: request.menu.nodeId, requestId: request.requestId, selectionEpoch: request.selectionEpoch,
        candidateSetHash: request.candidateSetHash, semanticSufficiency: 'only_candidate_meaning', optionId: selected.id,
        probabilities: request.menu.options.map((o) => ({ optionId: o.id, probability: o.id === selected.id ? 0.96 : 0.02 })) };
    };
    const result = await h.submit('教材aは1問7分', { c5LocalSelection: options });
    expect(result.accepted).toBe(true);
    const graph = readC5RuntimeGraph(OWNER, h.conversationId);
    if (revoke) { expect(calls).toBe(1); expect(graph).toEqual(h.graph); expect(h.getState().intakeState!.c5SelectionLedger!.consumed).toEqual([]); }
    else { expect(calls).toBe(2); expect(graph.revision).toBe(5); expect(resolution(graph, 'work-a').estimatedMinutes).toBe(70);
      expect(graph.factLifecycles.filter((f) => f.status === 'superseded').map((f) => f.factId)).toEqual(['estimate-5', 'estimate-9']);
      expect(resolution(graph, 'work-b')).toEqual(resolution(h.graph, 'work-b')); expect(reload().graph).toEqual(graph);
      expect(reload().planningState.intakeState!.c5SelectionLedger!.consumed).toHaveLength(1); }
  });

  it('holds broad targets, observed pace, completed scope, mixed measurements and planning-window questions', async () => {
    const h = c5ControllerHarness(); await h.present();
    expect(narrowC5EffortBasis(h.graph, 'completed-b')).toBeNull(); expect(narrowC5EffortBasis(h.graph, 'work-b')).toBeNull();
    const broad = structuredClone(h.graph); broad.effortEstimates.forEach((e) => { if (e.taskId === 'task-a') e.targetFactId = 'task-a'; });
    expect(narrowC5EffortBasis(broad, 'work-a')).toBeNull();
    const mixed = structuredClone(h.graph); mixed.effortEstimates[1].kind = 'total_duration'; mixed.effortEstimates[1].unitCode = null;
    expect(narrowC5EffortBasis(mixed, 'work-a')).toBeNull();
    h.replaceState({ ...h.getState(), intakeState: { ...h.getState().intakeState!, lastQuestionContext: {
      ...h.getState().intakeState!.lastQuestionContext!, targetSlot: 'stable_v5:ambiguous_planning_window', c5: undefined } } });
    const choose = vi.spyOn(h.options, 'choose'); await h.submit('来週'); expect(choose).not.toHaveBeenCalled();
  });
});
