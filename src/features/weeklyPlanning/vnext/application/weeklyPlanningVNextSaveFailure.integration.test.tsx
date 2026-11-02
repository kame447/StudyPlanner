import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../application/weeklyPlanningApprovalMemoryRepository';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../../preview/weeklyPlanningPreviewBlocks';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import { createInMemoryWeeklyPlanningTraceRepository } from '../../trace/weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../../trace/weeklyPlanningStableV5TraceRuntime';

// V5's contract for a failed checkpoint write: the change the user made stays live, the chat becomes dirty with a
// blocked result (the existing retry banner and unload warning), and a later successful retry persists the live
// state. VNext used to save before assigning state, so a throwing write lost the change.
const OWNER = 'save-failure-owner'; const WEEK = '2026-11-02'; const NOW = '2026-11-02T00:00:00.000Z';
const seed: WeeklyPlanningVNextInterpretation = { status: 'interpreted', planningIntent: 'create_plan' as const, answer: null,
  delta: { add: [{ kind: 'task', localId: 'task', category: 'study', title: '数学' },
    { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining', amount: 30, unitCode: 'minute',
      unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }], patch: [], remove: [], relate: [], defer: [] },
  metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services); useImperativeHandle(ref, () => app, [app]); return null;
});

describe('a failed checkpoint write after a user change', () => {
  let memory: ReturnType<typeof createMemoryStorageHarness>; let restore: () => void; let renderer: ReactTestRenderer | undefined;
  const failing = { on: false };
  /** Storage whose writes to chat or VNext keys throw while `failing.on`, like a full or blocked store. */
  const flaky = (): Storage => new Proxy(memory.storage, { get(target, key) {
    if (key === 'setItem') return (name: string, value: string) => {
      if (failing.on && (name.includes('.vnext.') || name.includes('.chat.v1.') || name.includes('.chats.v1.'))) throw new Error('injected write failure');
      target.setItem(name, value);
    };
    const value = Reflect.get(target, key) as unknown; return typeof value === 'function' ? value.bind(target) : value;
  } });
  beforeEach(() => { failing.on = false; memory = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(flaky());
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(createInMemoryWeeklyPlanningTraceRepository()); });
  afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined); vi.unstubAllEnvs(); restore(); });

  async function mount() {
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(createWeeklyPlanningApprovalMemoryState());
    const services: WeeklyPlanningVNextLocalApplicationServices = { storage: flaky(), client: () => ({} as never), interpret: () => async () => seed, now: () => NOW,
      createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '30分の計画案です。', rawResponse: '' }) }) };
    const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
      plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
      saveWeeklyApprovedPlan: repository.saveApprovedPlan, completeWeeklyApprovalOperation: repository.completeOperation };
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={ref} input={input} services={services} />); });
    await act(async () => { expect((await ref.current!.submitTurn('数学を30分')).accepted).toBe(true); });
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: ref.current!.state.previewCandidates!, userId: OWNER, createdAt: NOW });
    return { ref, blocks };
  }
  /** The draft blocks of the UI state the next reload would restore. */
  const storedDrafts = (ref: { current: WeeklyPlanningApplication | null }) => {
    const raw = memory.storage.getItem(`studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${ref.current!.chat.index.activeChatId}.ui`);
    return (JSON.parse(raw!) as { payload: { state: { draftBlocks: unknown[] } } }).payload.state.draftBlocks.length;
  };

  it.each([
    ['adding draft blocks', async (app: () => WeeklyPlanningApplication, blocks: ReturnType<typeof createWeeklyDraftBlocksFromPreviewCandidates>) => {
      expect(app().createDraftBlocks(blocks)).toBe(true); return { live: 1, before: 0 }; }, false],
    ['removing a draft block', async (app: () => WeeklyPlanningApplication, blocks: ReturnType<typeof createWeeklyDraftBlocksFromPreviewCandidates>) => {
      app().removeDraftBlock(blocks[0].id); return { live: 0, before: 1 }; }, true],
    ['clearing the draft blocks', async (app: () => WeeklyPlanningApplication) => {
      app().clearDraftBlocks(); return { live: 0, before: 1 }; }, true],
  ] as const)('%s keeps the live change, reports it through the chat session and persists it on retry', async (_name, change, startWithDrafts) => {
    const { ref, blocks } = await mount();
    if (startWithDrafts) await act(async () => { expect(ref.current!.createDraftBlocks(blocks)).toBe(true); });
    expect(ref.current!.chat.dirty).toBe(false);
    let expected!: { live: number; before: number };
    failing.on = true;
    await act(async () => { expected = await change(() => ref.current!, blocks); });
    // The user's change is the live state, even though nothing could be written.
    expect(ref.current!.state.draftBlocks.filter(block => block.status === 'draft')).toHaveLength(expected.live);
    expect(ref.current!.chat.dirty).toBe(true);
    expect(ref.current!.chat.result).toEqual({ status: 'blocked', reason: 'snapshot-write-failed' });
    expect(storedDrafts(ref)).toBe(expected.before);
    // The existing retry persists the live state once storage works again.
    failing.on = false;
    await act(async () => { expect(ref.current!.chat.retry().status).toBe('saved'); });
    expect(ref.current!.chat.dirty).toBe(false);
    expect(storedDrafts(ref)).toBe(expected.live);
    await act(async () => renderer!.unmount()); renderer = undefined;
    const again = createRef<WeeklyPlanningApplication>();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(createWeeklyPlanningApprovalMemoryState());
    await act(async () => { renderer = create(<Harness ref={again} services={{ storage: flaky(), client: () => ({} as never), interpret: () => async () => seed, now: () => NOW,
      createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '', rawResponse: '' }) }) }}
      input={{ userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [], plannerDataAvailability: createReadyPlannerDataAvailability(OWNER),
        isPlannerDataSnapshotCurrent: () => true, saveWeeklyApprovedPlan: repository.saveApprovedPlan, completeWeeklyApprovalOperation: repository.completeOperation }} />); });
    expect(again.current!.state.draftBlocks.filter(block => block.status === 'draft')).toHaveLength(expected.live);
  });

  it('negative control: a normal write persists at once and leaves the chat clean', async () => {
    const { ref, blocks } = await mount();
    await act(async () => { expect(ref.current!.createDraftBlocks(blocks)).toBe(true); });
    expect(storedDrafts(ref)).toBe(1);
    await act(async () => { ref.current!.removeDraftBlock(blocks[0].id); });
    expect(storedDrafts(ref)).toBe(0);
    expect(ref.current!.chat.dirty).toBe(false);
    expect(ref.current!.chat.result === null || ref.current!.chat.result.status === 'saved').toBe(true);
  });
});
