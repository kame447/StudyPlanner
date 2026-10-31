import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, createDeferred, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication, type UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { resolveLocalWeeklyPlanningConversationCore, WEEKLY_PLANNING_VNEXT_SWITCH_PARTS } from './weeklyPlanningVNextCoreSwitch';
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
import { buildAiPlanningStarterPromptOptions } from '../../ui/aiPlanningStarterPrompts';

const OWNER = 'local-vnext-owner'; const WEEK = '2026-11-02'; const NOW = '2026-11-02T00:00:00.000Z';
const readyParts = new Set(WEEKLY_PLANNING_VNEXT_SWITCH_PARTS);
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
    { allowance: 'true', hostname: 'localhost', search: '?weeklyPlanningCore=vnext', expected: 'vnext' },
    { allowance: 'true', hostname: 'localhost', search: '', expected: 'stable_v5' },
    { allowance: undefined, hostname: 'localhost', search: '?weeklyPlanningCore=vnext', expected: 'stable_v5' },
    { allowance: 'true', hostname: 'studyplanner.example', search: '?weeklyPlanningCore=vnext', expected: 'stable_v5' },
    { allowance: 'false', hostname: 'localhost', search: '?weeklyPlanningCore=vnext', expected: 'stable_v5' },
    { allowance: 'true', hostname: 'localhost', search: '?weeklyPlanningCore=v5', expected: 'stable_v5' },
  ])('resolves $hostname, allowance=$allowance, $search to $expected', ({ expected, ...params }) => {
    expect(resolveLocalWeeklyPlanningConversationCore({ ...params, readyParts }).core).toBe(expected);
    expect(resolveLocalWeeklyPlanningConversationCore({ ...params, readyParts: new Set() }).core).toBe('stable_v5');
  });

  it.each([
    { allowance: 'true', hostname: 'localhost', expected: 'vnext' },
    { allowance: undefined, hostname: 'localhost', expected: 'stable_v5' },
    { allowance: 'true', hostname: 'laplance.com', expected: 'stable_v5' },
  ])('production-build composition on $hostname, allowance=$allowance chooses $expected', async ({ allowance, hostname, expected }) => {
    vi.stubEnv('DEV', false); vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_ENABLE_WEEKLY_PLANNING_VNEXT', allowance ?? '');
    Object.defineProperty(window, 'location', { configurable: true, value: { hostname, search: '?weeklyPlanningCore=vnext' } });
    // The composition chooses once per page load; reload its real entry under these build inputs.
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
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage });
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
    expect(resolveLocalWeeklyPlanningConversationCore({ allowance: 'true', hostname: 'localhost', search: '', readyParts }).core).toBe('stable_v5');
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
    expect(resolveLocalWeeklyPlanningConversationCore({ allowance: 'true', hostname: 'localhost',
      search: '?weeklyPlanningCore=vnext', readyParts }).core).toBe('vnext');
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    expect(local.readCheckpoint()!.vnext.state).toEqual(core.vnext.state);
    expect(ref.current!.state.messages.some(message => message.content === '数学を30分')).toBe(true);
    expect(ref.current!.state.messages.some(message => message.content === '旧版の会話')).toBe(false);
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
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage });
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
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage });
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
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage });
    expect(failed).toBe(true);
    expect(local.checkpoint.read()).toBeNull();
    expect(ref.current!.state.previewCandidates).toEqual([]);
    await act(async () => { expect((await ref.current!.submitTurn('もう一度、数学を30分')).accepted).toBe(true); });
    expect(local.readCheckpoint()!.vnext.state.graph.tasks).toHaveLength(1);
  });

  it('visibly disables registered-target controls only for the local composition and rejects programmatic target input', async () => {
    const { input, services } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<LocalHarness ref={ref} input={input} services={services} />); });
    const material = { id: 'm', userId: OWNER, name: '合成教材', subjectId: 's', subjectName: '数学', status: 'active' as const,
      totalUnits: 100, currentUnit: 20, targetDate: '2026-11-08', createdAt: NOW, updatedAt: NOW };
    const catalog = { ready: true, todos: [], materials: [material] };
    const option = buildAiPlanningStarterPromptOptions({ referenceDate: WEEK, plans: [], ...catalog }).find(item => item.target)!;
    const props = { application: ref.current!, userId: OWNER, selectedDate: WEEK, plans: [], starterCatalog: catalog };
    const localHtml = renderToStaticMarkup(<PlanningView {...props} />);
    const normalHtml = renderToStaticMarkup(<PlanningView {...props} application={{ ...ref.current!, registeredTargetsAvailable: undefined }} />);
    const openingButton = (html: string) => html.slice(html.lastIndexOf('<button', html.indexOf(option.displayText)), html.indexOf(option.displayText));
    expect(openingButton(localHtml)).toContain('disabled=""');
    expect(openingButton(normalHtml)).not.toContain('disabled=""');
    expect(localHtml).toContain('この実験モードでは未対応');
    await expect(ref.current!.submitTurn(option.requestText, undefined, option.target!)).rejects.toThrow('この実験モードでは未対応');
    expect(ref.current!.state.messages).toEqual([]);
  });
});
