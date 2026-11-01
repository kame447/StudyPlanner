import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication, type UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../application/weeklyPlanningApprovalMemoryRepository';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import { createInMemoryWeeklyPlanningTraceRepository } from '../../trace/weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../../trace/weeklyPlanningStableV5TraceRuntime';

// Rollback safety (#926): Pages goes back to the V5 build while users' localStorage already holds what VNext wrote.
// Everything here is produced by the real hooks over one real (in-memory) localStorage; nothing is hand-written JSON.
const OWNER = 'rollback-owner'; const WEEK = '2026-11-02'; const NOW = '2026-11-02T00:00:00.000Z';
const reading = (title: string): WeeklyPlanningVNextInterpretation => ({ status: 'interpreted', planningIntent: 'create_plan' as const, answer: null,
  delta: { add: [{ kind: 'task', localId: 'task', category: 'study', title },
    { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null,
      quantityRole: 'remaining', amount: 30, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null }], patch: [], remove: [], relate: [], defer: [] },
  metrics: { calls: 1, repairs: 0, latencyMs: 1 } });
const V5Harness = forwardRef<WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput>((props, ref) => {
  const app = useWeeklyPlanningApplication(props); useImperativeHandle(ref, () => app, [app]); return null;
});
const VNextHarness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services); useImperativeHandle(ref, () => app, [app]); return null;
});

describe('rolling Pages back to the V5 build after VNext wrote local data', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>;
  let restore: () => void;
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => { storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(createInMemoryWeeklyPlanningTraceRepository()); });
  afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined); vi.unstubAllEnvs(); restore(); });

  const input = (): UseWeeklyPlanningApplicationInput => {
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(createWeeklyPlanningApprovalMemoryState());
    return { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
      plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
      saveWeeklyApprovedPlan: repository.saveApprovedPlan, completeWeeklyApprovalOperation: repository.completeOperation };
  };
  const services = (title: string): WeeklyPlanningVNextLocalApplicationServices => ({ storage: storage.storage, client: () => ({} as never),
    interpret: () => async () => reading(title), now: () => NOW,
    createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '30分の計画案です。', rawResponse: '' }) }) });
  const mountV5 = async () => { const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<V5Harness ref={ref} {...input()} />); }); return ref; };
  const mountVNext = async (title = '数学') => { const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<VNextHarness ref={ref} input={input()} services={services(title)} />); }); return ref; };
  const unmount = async () => { await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest(); };
  const snapshot = (match: (key: string) => boolean) => new Map([...storage.values].filter(([key]) => match(key)));
  const isVNextKey = (key: string) => key.includes('.weeklyPlanning.vnext.');
  const isV5Key = (key: string) => key.includes('.chat.v1.') || key.includes('.weeklyPlanning.stableV5.');

  /** V5 writes a conversation (its own chat snapshot, weekly slot and index), then VNext opens, migrates and extends it. */
  async function seedV5ThenVNext() {
    const v5 = await mountV5();
    await act(async () => { v5.current!.appendMessage({ id: 'v5-user', role: 'user', content: 'V5で書いた相談', createdAt: NOW }); });
    await act(async () => { expect(v5.current!.chat.checkpoint().status).toBe('saved'); });
    const v5Chat = v5.current!.chat.index.activeChatId;
    const v5Messages = v5.current!.state.messages;
    await unmount();
    const v5Written = snapshot(isV5Key);
    const vnext = await mountVNext('数学');
    expect(vnext.current!.chat.index.activeChatId).toBe(v5Chat);
    await act(async () => { expect((await vnext.current!.submitTurn('数学を30分')).accepted).toBe(true); });
    await act(async () => { expect(vnext.current!.chat.create().status).toBe('saved'); });
    const vnextChat = vnext.current!.chat.index.activeChatId;
    await act(async () => { expect((await vnext.current!.submitTurn('数学を30分')).accepted).toBe(true); });
    await unmount();
    return { v5Chat, vnextChat, v5Messages, v5Written };
  }

  const v5ChatKey = (chatId: string) => `studyplanner.aiPlanning.chat.v1.${OWNER}.${chatId}`;

  it('opens VNext-written storage without a crash, offers the existing start path, keeps every VNext byte and restores the pre-VNext V5 chat', async () => {
    const { v5Chat, vnextChat, v5Messages, v5Written } = await seedV5ThenVNext();
    const vnextBefore = snapshot(isVNextKey);
    expect(vnextBefore.size).toBeGreaterThan(0);
    // VNext never wrote a V5 chat snapshot for its own chat, so the V5 build has nothing to restore there.
    expect(storage.storage.getItem(v5ChatKey(vnextChat))).toBeNull();

    const v5 = await mountV5();
    await act(async () => { v5.current!.chat.initialize(); });
    // Blocked with the existing, recoverable state: no crash, no blank screen, and the way out is offered.
    expect(v5.current!.chat.index.activeChatId).toBe(vnextChat);
    expect(v5.current!.chat.result).toEqual({ status: 'blocked', reason: 'initialization-unavailable' });
    expect(v5.current!.chat.requiresInitialization).toBe(true);
    expect(v5.current!.chat.canStartWithoutRestoring).toBe(true);
    expect(snapshot(isVNextKey)).toEqual(vnextBefore);

    // The user starts a conversation; VNext's chat stays in the list and its bytes untouched.
    await act(async () => { expect(v5.current!.chat.startWithoutRestoring().status).toBe('saved'); });
    expect(v5.current!.chat.requiresInitialization).toBe(false);
    expect(v5.current!.state.messages).toEqual([]);
    await act(async () => { v5.current!.appendMessage({ id: 'v5-after-rollback', role: 'user', content: 'ロールバック後の入力', createdAt: NOW }); });
    await act(async () => { expect(v5.current!.chat.checkpoint().status).toBe('saved'); });
    expect(v5.current!.chat.index.chats.map(chat => chat.id)).toContain(vnextChat);
    expect(snapshot(isVNextKey)).toEqual(vnextBefore);

    // The chat V5 wrote before VNext still restores exactly, from its own untouched snapshot.
    await act(async () => { expect(v5.current!.chat.select(v5Chat).status).toBe('saved'); });
    expect(v5.current!.state.messages).toEqual(v5Messages);
    expect(storage.storage.getItem(v5ChatKey(v5Chat))).toBe(v5Written.get(v5ChatKey(v5Chat)));
    expect(snapshot(isVNextKey)).toEqual(vnextBefore);
  });

  it('rolls forward again: the VNext conversations return unchanged after V5 wrote new data, and V5\'s bytes stay', async () => {
    const { v5Chat, vnextChat } = await seedV5ThenVNext();
    const vnextBefore = snapshot(isVNextKey);
    const v5 = await mountV5();
    await act(async () => { v5.current!.chat.initialize(); });
    await act(async () => { expect(v5.current!.chat.startWithoutRestoring().status).toBe('saved'); });
    const v5Started = v5.current!.chat.index.activeChatId;
    await act(async () => { v5.current!.appendMessage({ id: 'v5-new', role: 'user', content: 'V5で新しく書いた入力', createdAt: NOW }); });
    await act(async () => { expect(v5.current!.chat.checkpoint().status).toBe('saved'); });
    await act(async () => { expect(v5.current!.chat.select(v5Chat).status).toBe('saved'); });
    await act(async () => { v5.current!.appendMessage({ id: 'v5-extra', role: 'user', content: 'V5で追記', createdAt: NOW }); });
    await act(async () => { expect(v5.current!.chat.checkpoint().status).toBe('saved'); });
    await unmount();
    const v5Written = snapshot(isV5Key);

    const vnext = await mountVNext('数学');
    await act(async () => { vnext.current!.chat.initialize(); });
    // Opens without error on the chat V5 left active; its VNext conversation is exactly what VNext saved before.
    expect(vnext.current!.chat.index.activeChatId).toBe(v5Chat);
    expect(vnext.current!.chat.requiresInitialization).toBe(false);
    expect(vnext.current!.state.messages.some(message => message.content === '数学を30分')).toBe(true);
    // V5-only additions are retained in V5's bytes but are not part of the VNext view (a known limit of going back and forth).
    expect(vnext.current!.state.messages.some(message => message.content === 'V5で追記')).toBe(false);
    expect(snapshot(isV5Key)).toEqual(v5Written);
    await act(async () => { expect(vnext.current!.chat.select(vnextChat).status).toBe('saved'); });
    expect(vnext.current!.state.messages.some(message => message.content === '数学を30分')).toBe(true);
    // A chat V5 created while rolled back has only a V5 snapshot: VNext migrates it read-only and V5's bytes stay as written.
    await act(async () => { expect(vnext.current!.chat.select(v5Started).status).toBe('saved'); });
    expect(vnext.current!.state.messages.map(message => message.content)).toEqual(['V5で新しく書いた入力']);
    expect(snapshot(isV5Key)).toEqual(v5Written);
    await act(async () => { expect((await vnext.current!.submitTurn('数学を30分')).accepted).toBe(true); });
    expect(snapshot(isVNextKey).size).toBeGreaterThanOrEqual(vnextBefore.size);
    for (const [key, value] of vnextBefore) if (key.includes(vnextChat)) expect(storage.storage.getItem(key)).toBe(value);
  });
});
