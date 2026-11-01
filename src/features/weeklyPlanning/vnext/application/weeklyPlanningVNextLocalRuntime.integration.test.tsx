import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, createDeferred, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication, type UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { resolveWeeklyPlanningConversationCore } from './weeklyPlanningVNextCoreSwitch';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../weeklyPlanningVNextV5Boundary';
import { getWeeklyPlanningStableV5StorageSnapshot, saveWeeklyPlanningStableV5PersistedSession } from '../../application/weeklyPlanningStableV5SessionStorage';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../../preview/weeklyPlanningPreviewBlocks';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../application/weeklyPlanningApprovalMemoryRepository';
import { loadWeeklyPlanningApprovalOperations } from '../../application/weeklyPlanningApprovalLedgerStorage';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import { createInMemoryWeeklyPlanningTraceRepository } from '../../trace/weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../../trace/weeklyPlanningStableV5TraceRuntime';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiPlanningView as PlanningView } from '../../../../components/AiPlanningViewLegacy';
import { createAiPlanningChat, loadAiPlanningChatIndex, saveAiPlanningChatIndex, saveAiPlanningChatSnapshot, updateAiPlanningChatRecord, searchAiPlanningChats } from '../../chat/aiPlanningChatStore';
import { buildAiPlanningStarterPromptOptions } from '../../ui/aiPlanningStarterPrompts';

const OWNER = 'local-vnext-owner'; const WEEK = '2026-11-02'; const NOW = '2026-11-02T00:00:00.000Z';
const seed: WeeklyPlanningVNextInterpretation = { status: 'interpreted', planningIntent: 'create_plan' as const, answer: null,
  delta: { add: [{ kind: 'task', localId: 'task', category: 'study', title: '数学' },
    { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null,
      quantityRole: 'remaining', amount: 30, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null }], patch: [], remove: [], relate: [], defer: [] },
  metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
const LocalHarness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services); useImperativeHandle(ref, () => app, [app]); return null;
});
const V5Harness = forwardRef<WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput>((props, ref) => {
  const app = useWeeklyPlanningApplication(props); useImperativeHandle(ref, () => app, [app]); return null;
});

describe('explicit local VNext runtime and shared V5 approval', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>;
  let restore: () => void;
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => { storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(createInMemoryWeeklyPlanningTraceRepository()); });
  afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined); vi.unstubAllEnvs(); restore(); });

  it.each([
    { configuredCore: undefined, hostname: 'localhost', expected: 'vnext' },
    { configuredCore: undefined, hostname: 'laplance.com', expected: 'vnext' },
    { configuredCore: 'vnext', hostname: 'localhost', expected: 'vnext' },
    { configuredCore: 'stable_v5', hostname: 'localhost', expected: 'stable_v5' },
    { configuredCore: 'stable_v5', hostname: '127.0.0.1', expected: 'stable_v5' },
    { configuredCore: 'stable_v5', hostname: '192.168.1.3', expected: 'stable_v5' },
    { configuredCore: 'stable_v5', hostname: 'laplance.com', expected: 'vnext' },
    { configuredCore: 'stable_v5', hostname: '', expected: 'vnext' },
    { configuredCore: 'unknown', hostname: 'localhost', expected: 'vnext' },
  ])('resolves $hostname, core=$configuredCore to $expected', ({ expected, ...params }) => {
    expect(resolveWeeklyPlanningConversationCore(params)).toBe(expected);
  });

  it.each([
    { configuredCore: undefined, hostname: 'localhost', expected: 'vnext' },
    { configuredCore: undefined, hostname: 'laplance.com', expected: 'vnext' },
    { configuredCore: 'stable_v5', hostname: 'localhost', expected: 'stable_v5' },
    { configuredCore: 'stable_v5', hostname: 'laplance.com', expected: 'vnext' },
  ])('production-build composition on $hostname, core=$configuredCore chooses $expected', async ({ configuredCore, hostname, expected }) => {
    vi.stubEnv('DEV', false); vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_WEEKLY_PLANNING_CORE', configuredCore ?? '');
    // Old query values have no selection authority.
    Object.defineProperty(window, 'location', { configurable: true, value: { hostname, search: '?weeklyPlanningCore=stable_v5' } });
    vi.resetModules();
    const [entry, vnext, stable] = await Promise.all([
      import('../../application/useWeeklyPlanningConversationApplication'),
      import('./useWeeklyPlanningVNextApplication'), import('../../application/useWeeklyPlanningApplication'),
    ]);
    expect(entry.useWeeklyPlanningConversationApplication).toBe(expected === 'vnext'
      ? vnext.useWeeklyPlanningVNextApplication : stable.useWeeklyPlanningApplication);
  });

  function fixture(interpret: WeeklyPlanningVNextLocalApplicationServices['interpret'] = () => async () => seed) {
    const memory = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(memory);
    const save = vi.fn(repository.saveApprovedPlan);
    const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
      plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
      saveWeeklyApprovedPlan: save, completeWeeklyApprovalOperation: repository.completeOperation };
    const services: WeeklyPlanningVNextLocalApplicationServices = { storage: storage.storage,
      client: () => ({} as never), interpret, now: () => NOW,
      createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '30分の計画案です。', rawResponse: '' }) }) };
    return { memory, repository, save, input, services };
  }

  it('turns on locally, previews V5 candidates, reloads, saves through V5 and rolls back to untouched V5 state', async () => {
    const v5State = createInitialPlanningState(WEEK);
    v5State.messages = [{ id: 'v5-message', role: 'assistant', content: '旧版の会話', createdAt: NOW }];
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId: 'existing-v5',
      graph: createEmptyWeeklyPlanningFactGraphV5(), planningState: v5State })).toBe(true);
    const v5Key = getWeeklyPlanningStableV5StorageSnapshot(OWNER, WEEK).key;
    const v5Bytes = storage.storage.getItem(v5Key);
    const { memory, input, services, save } = fixture();
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    expect(ref.current!.plannerDataReady).toBe(true);
    await act(async () => { expect((await ref.current!.submitTurn('数学を30分')).accepted).toBe(true); });
    const candidates = ref.current!.state.previewCandidates!;
    expect(candidates).toHaveLength(1);
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: ref.current!.chat.index.activeChatId });
    const core = local.readCheckpoint()!;
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: OWNER, createdAt: NOW });
    expect(blocks[0].behaviorMetadata?.previewMetadata).toEqual(core.vnext.preview!.blocks[0].behaviorMetadata?.previewMetadata);
    expect(core.vnext.state.graph.revision).toBeGreaterThan(0);
    expect(ref.current!.state.intakeState?.sourceTurns).toEqual([]);
    expect(storage.storage.getItem(v5Key)).toBe(v5Bytes);

    await act(async () => renderer!.unmount()); renderer = undefined;
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    expect(ref.current!.state.previewCandidates).toEqual(candidates);
    expect(local.readCheckpoint()!.conversationId).toBe(core.conversationId);
    await act(async () => {
      expect(ref.current!.createDraftBlocks(blocks)).toBe(true);
      candidates.forEach(candidate => ref.current!.removePreviewCandidate(candidate.stableKey));
    });
    expect(ref.current!.approvalAvailability.kind).toBe('eligible');
    await act(async () => ref.current!.approveDraftBlocks());
    expect(save).toHaveBeenCalledTimes(1);
    expect(memory.plans.size).toBe(1);
    expect(loadWeeklyPlanningApprovalOperations(OWNER)).toEqual([expect.objectContaining({ status: 'completed', conversationId: core.conversationId })]);
    expect(storage.storage.getItem(v5Key)).toBe(v5Bytes);

    await act(async () => renderer!.unmount()); renderer = undefined;
    expect(resolveWeeklyPlanningConversationCore({ configuredCore: 'stable_v5', hostname: 'localhost' })).toBe('stable_v5');
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    await act(async () => { renderer = create(<V5Harness ref={ref} {...input} />); });
    expect(ref.current!.state.messages).toEqual(v5State.messages);
    // V5 refreshes its own savedAt on mount; its conversation/graph/UI payload stay its own.
    const resumed = JSON.parse(storage.storage.getItem(v5Key)!);
    const original = JSON.parse(v5Bytes!);
    expect(resumed.planningState).toEqual(original.planningState);
    expect(resumed.graph).toEqual(original.graph);
    expect(resumed.conversationId).toBe(original.conversationId);
    expect(memory.plans.size).toBe(1);
    await act(async () => renderer!.unmount()); renderer = undefined;
    expect(resolveWeeklyPlanningConversationCore({ configuredCore: undefined, hostname: 'localhost' })).toBe('vnext');
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    expect(local.readCheckpoint()!.vnext.state).toEqual(core.vnext.state);
    expect(ref.current!.state.messages.some(message => message.content === '数学を30分')).toBe(true);
    expect(ref.current!.state.messages.some(message => message.content === '旧版の会話')).toBe(true);
    expect(memory.plans.size).toBe(1);
  });

  it('does not publish accepted facts or previews after the existing controller cancels a reading', async () => {
    const reading = createDeferred<WeeklyPlanningVNextInterpretation>();
    const started = createDeferred<void>();
    const { input, services } = fixture(() => async () => { started.resolve(); return reading.promise; });
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    let pending: ReturnType<WeeklyPlanningApplication['submitTurn']>;
    await act(async () => { pending = ref.current!.submitTurn('数学を30分'); await started.promise; });
    await act(async () => { expect(ref.current!.cancelTurn()).toBe(true); reading.resolve(seed); await pending!; });
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: ref.current!.chat.index.activeChatId });
    expect(local.checkpoint.read()).toBeNull();
    expect(ref.current!.state.previewCandidates).toEqual([]);
  });

  it('passes attachment evidence to the native provider on its supplemental channel without changing the user source', async () => {
    const { input, services } = fixture(() => createWeeklyPlanningVNextProviderInterpreter());
    let providerInput: Record<string, unknown> | undefined;
    services.client = () => ({ createChatCompletion: vi.fn(async request => {
      providerInput = JSON.parse(request.messages[1].content);
      return JSON.stringify({ planningIntent: seed.planningIntent, conversationActs: [], delta: seed.delta, answer: null });
    }) });
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    const userText = '画像の内容を使って計画してください';
    const supplementalContext = '合成OCR: 数学 30分';
    await act(async () => { expect((await ref.current!.submitTurn(userText, supplementalContext)).accepted).toBe(true); });
    expect(providerInput).toMatchObject({ userText, supplementalContext });
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: ref.current!.chat.index.activeChatId });
    const graph = local.readCheckpoint()!.vnext.state.graph;
    expect([...graph.tasks, ...graph.workloads].map(fact => fact.source.sourceText)).toEqual([userText, userText]);
    expect(ref.current!.state.messages.find(message => message.role === 'user')?.content).toBe(userText);
  });

  it('rolls back the staged core when UI persistence fails at commit, then accepts a fresh retry', async () => {
    const { input, services } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    const write = storage.storage.setItem.bind(storage.storage);
    let failed = false;
    storage.storage.setItem = (key, raw) => {
      if (!failed && key.endsWith('.ui') && JSON.parse(raw).payload.state.messages
        .some((message: { content: string }) => message.content === '30分の計画案です。')) {
        failed = true; throw new Error('synthetic storage quota failure');
      }
      write(key, raw);
    };
    await act(async () => { await expect(ref.current!.submitTurn('数学を30分')).rejects.toThrow('synthetic storage quota failure'); });
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: ref.current!.chat.index.activeChatId });
    expect(failed).toBe(true);
    expect(local.checkpoint.read()).toBeNull();
    expect(ref.current!.state.previewCandidates).toEqual([]);
    await act(async () => { expect((await ref.current!.submitTurn('もう一度、数学を30分')).accepted).toBe(true); });
    expect(local.readCheckpoint()!.vnext.state.graph.tasks).toHaveLength(1);
  });

  it('migrates the active V5 multi-chat conversation on open without changing legacy bytes', async () => {
    const initial = loadAiPlanningChatIndex(OWNER);
    const created = createAiPlanningChat(initial);
    const conversationId = 'existing-active-v5';
    const state = createInitialPlanningState(WEEK);
    state.messages = [{ id: 'legacy-user', role: 'user', content: '既存の数学の相談', createdAt: NOW }];
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.revision = 1;
    graph.tasks = [{ id: 'legacy-task', category: 'study', title: '既存の数学', createdRevision: 1,
      source: { conversationId, turnId: 'legacy-turn', semanticLocalId: 'task', sourceText: '既存の数学', origin: 'user' } }];
    graph.factLifecycles = [{ factId: 'legacy-task', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }];
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId, graph, planningState: state })).toBe(true);
    const saved = JSON.parse(storage.storage.getItem(getWeeklyPlanningStableV5StorageSnapshot(OWNER, WEEK).key)!);
    expect(saveAiPlanningChatSnapshot(OWNER, created.chat.id, saved)).toBe(true);
    expect(saveAiPlanningChatIndex(OWNER, updateAiPlanningChatRecord(created.index, created.chat.id, { weekStartDate: WEEK }))).toBe(true);
    const originals = new Map([...storage.values].filter(([key]) => !key.includes('chats.v1')));
    const { input, services } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    expect(ref.current!.plannerDataReady).toBe(true);
    expect(ref.current!.chat.index.activeChatId).toBe(created.chat.id);
    expect(ref.current!.state.messages).toEqual(state.messages);
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: created.chat.id });
    expect(local.readCheckpoint()).toMatchObject({ conversationId, vnext: { state: { graph: { revision: 2, tasks: [{ title: '既存の数学' }] } } } });
    for (const [key, value] of originals) expect(storage.storage.getItem(key)).toBe(value);
  });

  it.each(['{malformed', JSON.stringify({ conversationId: 'invalid-v5' })])('retains unreadable V5 bytes and starts an interactive conversation: %s', async raw => {
    const key = getWeeklyPlanningStableV5StorageSnapshot(OWNER, WEEK).key;
    storage.storage.setItem(key, raw);
    const { input, services } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    expect(ref.current!.plannerDataReady).toBe(true);
    expect(ref.current!.chat.requiresInitialization).toBe(false);
    await act(async () => { expect((await ref.current!.submitTurn('数学を30分')).accepted).toBe(true); });
    expect(ref.current!.state.previewCandidates).toHaveLength(1);
    expect(storage.storage.getItem(key)).toBe(raw);
  });

  it('creates, searches, switches, reloads and removes independent VNext chats; week reset keeps history and saved plans', async () => {
    const { input, services, memory } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    const firstId = ref.current!.chat.index.activeChatId;
    await act(async () => { await ref.current!.submitTurn('数学を30分'); });
    const firstState = ref.current!.state;
    const firstCore = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: firstId }).checkpoint.read();
    expect(firstCore).not.toBeNull();
    await act(async () => { expect(ref.current!.chat.create().status).toBe('saved'); });
    const secondId = ref.current!.chat.index.activeChatId;
    expect(secondId).not.toBe(firstId);
    expect(ref.current!.state.messages).toEqual([]);
    await act(async () => { await ref.current!.submitTurn('英語を30分'); });
    expect(searchAiPlanningChats(OWNER, ref.current!.chat.index.chats, '数学').map(chat => chat.id)).toEqual([firstId]);
    await act(async () => { expect(ref.current!.chat.select(firstId).status).toBe('saved'); });
    expect(ref.current!.state).toEqual(firstState);
    expect(createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: firstId }).checkpoint.read()).toBe(firstCore);
    await act(async () => renderer!.unmount()); renderer = undefined;
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    expect(ref.current!.chat.index.activeChatId).toBe(firstId);
    expect(ref.current!.state.messages).toEqual(firstState.messages);
    await act(async () => { expect(ref.current!.chat.remove(secondId).status).toBe('saved'); });
    expect(ref.current!.chat.index.chats.map(chat => chat.id)).toEqual([firstId]);
    await act(async () => { ref.current!.resetSession(); });
    expect(ref.current!.state.messages).toEqual([]);
    expect(ref.current!.state.draftBlocks).toEqual([]);
    expect(ref.current!.chat.index.chats).toHaveLength(2);
    expect(memory.plans.size).toBe(0);
    await act(async () => { expect(ref.current!.chat.select(firstId).status).toBe('saved'); });
    expect(ref.current!.state.messages).toEqual(firstState.messages);
    await act(async () => { expect(ref.current!.clearConversation()).toBe(true); });
    expect(ref.current!.state.messages).toEqual([]);
    expect(ref.current!.state.previewCandidates).toEqual(firstState.previewCandidates);
  });

  it('keeps the chat history and each week\'s conversation across week changes and reload', async () => {
    const NEXT = '2026-11-09';
    const { input, services } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    const view = (selectedDate: string) => <LocalHarness ref={ref} input={{ ...input, selectedDate }} services={services} />;
    await act(async () => { renderer = create(view(WEEK)); });
    await act(async () => { await ref.current!.submitTurn('数学を30分'); });
    const weekState = ref.current!.state;
    await act(async () => { renderer!.update(view(NEXT)); });
    expect(ref.current!.state.weekStartDate).toBe(NEXT);
    expect(ref.current!.state.messages).toEqual([]);
    expect(ref.current!.chat.requiresInitialization).toBe(false);
    await act(async () => { renderer!.update(view(WEEK)); });
    expect(ref.current!.state.weekStartDate).toBe(WEEK);
    expect(ref.current!.state.messages).toEqual(weekState.messages);
    expect(ref.current!.chat.index.chats.length).toBeGreaterThan(0);
  });

  it.each([
    { name: 'broken ui bytes', ui: '{broken', core: null },
    // The browser spec seeds the same shape: parseable JSON in a format this build does not know, in both slots.
    { name: 'unknown-format ui and core bytes', ui: JSON.stringify({ version: 'future-vnext-ui-format', opaque: 'ui-sentinel' }),
      core: JSON.stringify({ version: 'future-vnext-core-format', opaque: 'core-sentinel' }) },
  ])('does not block the chat UI on unreadable VNext bytes ($name) and keeps them for the user', async ({ ui, core }) => {
    const { input, services } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    await act(async () => { await ref.current!.submitTurn('数学を30分'); });
    const chatId = ref.current!.chat.index.activeChatId;
    const uiKey = `studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.ui`;
    const coreKey = `studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.core`;
    storage.storage.setItem(uiKey, ui);
    if (core !== null) storage.storage.setItem(coreKey, core);
    await act(async () => renderer!.unmount()); renderer = undefined;
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    expect(ref.current!.chat.canStartWithoutRestoring).toBe(true);
    await act(async () => { expect(ref.current!.chat.startWithoutRestoring().status).toBe('saved'); });
    await act(async () => { expect((await ref.current!.submitTurn('英語を30分')).accepted).toBe(true); });
    expect(storage.storage.getItem(uiKey)).toBe(ui);
    if (core !== null) expect(storage.storage.getItem(coreKey)).toBe(core);
    expect(ref.current!.chat.index.chats).toHaveLength(2);
  });

  it.each(['absent', 'throwing'] as const)('mounts with production services when localStorage is %s and reports the chat as unavailable', async mode => {
    const { input } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    const fail = () => { throw new Error('storage blocked'); };
    const unavailable = mode === 'absent' ? undefined
      : { getItem: fail, setItem: fail, removeItem: fail, key: fail, length: 0 } as unknown as Storage;
    restore(); restore = installWeeklyPlanningTestStorage(unavailable as unknown as Storage);
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={undefined as never} />); });
    expect(ref.current!.chat.requiresInitialization).toBe(true);
    expect(ref.current!.plannerDataReady).toBe(false);
    expect(await ref.current!.submitTurn('数学を30分')).toMatchObject({ accepted: false });
    await act(async () => renderer!.unmount()); renderer = undefined;
    // The afterEach test-only resets need a readable storage again.
    restore(); restore = installWeeklyPlanningTestStorage(storage.storage);
  });

  it('offers registered-target starter controls exactly as the Stable V5 composition does', async () => {
    const { input, services } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    const material = { id: 'm', userId: OWNER, name: '合成教材', subjectId: 's', subjectName: '数学', status: 'active' as const,
      totalUnits: 100, currentUnit: 20, targetDate: '2026-11-08', createdAt: NOW, updatedAt: NOW };
    const catalog = { ready: true, todos: [], materials: [material] };
    const option = buildAiPlanningStarterPromptOptions({ referenceDate: WEEK, plans: [], ...catalog }).find(item => item.target)!;
    const props = { application: ref.current!, userId: OWNER, selectedDate: WEEK, plans: [], starterCatalog: catalog };
    const vnextHtml = renderToStaticMarkup(<PlanningView {...props} />);
    const v5Html = renderToStaticMarkup(<PlanningView {...props} application={{ ...ref.current!, registeredTargetsAvailable: undefined }} />);
    const openingButton = (html: string) => html.slice(html.lastIndexOf('<button', html.indexOf(option.displayText)), html.indexOf(option.displayText));
    expect(ref.current!.registeredTargetsAvailable).toBe(true);
    expect(openingButton(vnextHtml)).toBe(openingButton(v5Html));
    expect(openingButton(vnextHtml)).not.toContain('disabled=""');
    expect(vnextHtml).not.toContain('この実験モードでは未対応');
  });
});
