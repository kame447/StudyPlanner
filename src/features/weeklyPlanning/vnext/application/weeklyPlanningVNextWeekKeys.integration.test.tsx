// @ts-expect-error The e2e support module is plain ESM without declarations.
import { chooseTargetDay, keyForWeek, onlyWeek, weeksOf } from '../../../../../tests/e2e/support/vnext-planner-week.mjs';
import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../application/weeklyPlanningApprovalMemoryRepository';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import { createInMemoryWeeklyPlanningTraceRepository } from '../../trace/weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../../trace/weeklyPlanningStableV5TraceRuntime';

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
describe('the planner week follows the selected date; one chat then has several week keys', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>; let restore: () => void; let renderer: ReactTestRenderer | undefined;
  beforeEach(() => { storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(createInMemoryWeeklyPlanningTraceRepository()); });
  afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; restore(); });
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


  const names = () => Array.from({ length: storage.storage.length }, (_, index) => storage.storage.key(index)!);

  it('keeps one .ui per (week, chat): the reader picks the requested week and refuses an ambiguous read', async () => {
    const { input, services } = fixture(); const ref = createRef<WeeklyPlanningApplication>();
    const view = (selectedDate: string) => <LocalHarness ref={ref} input={{ ...input, selectedDate }} services={services} />;
    await act(async () => { renderer = create(view('2026-11-03')); });
    const chat = ref.current!.chat.index.activeChatId;
    // Positive (single key, before any week change): unambiguous.
    expect(onlyWeek(weeksOf(names(), chat, 'ui'), '.ui')).toBe('2026-11-02');
    await act(async () => { renderer!.update(view('2026-10-27')); });
    expect(ref.current!.state.weekStartDate).toBe('2026-10-26');
    await act(async () => { renderer!.update(view('2026-11-04')); });
    expect(ref.current!.state.weekStartDate).toBe('2026-11-02');
    // Two week keys for one chat: naming the week finds exactly that key...
    expect(weeksOf(names(), chat, 'ui')).toEqual(['2026-10-26', '2026-11-02']);
    expect(keyForWeek(names(), chat, '2026-10-26', 'ui')).toContain('.2026-10-26.');
    expect(() => keyForWeek(names(), chat, '2026-11-09', 'ui')).toThrow(/found 0/u);
    // ...and an unnamed read fails loudly instead of returning whichever key is first.
    expect(() => onlyWeek(weeksOf(names(), chat, 'ui'), '.ui')).toThrow(/Ambiguous planner week/u);
    // The signed-out owner's keys are not the signed-in chat's.
    expect(weeksOf([...names(), `studyplanner.weeklyPlanning.vnext.anonymous.2026-12-07.${chat}.ui`], chat, 'ui')).toEqual(['2026-10-26', '2026-11-02']);
    // An accepted turn writes .core for the week the planner is on, and for no other.
    await act(async () => { await ref.current!.submitTurn('数学を30分'); });
    expect(weeksOf(names(), chat, 'core')).toEqual(['2026-11-02']);
  });

  it.each([
    { name: 'tomorrow inside the planner week', week: '2026-11-02', now: '2026-11-03T10:00:00+09:00', date: '2026-11-04', weekStart: '2026-11-02', switchWeek: false },
    { name: 'last day of the week: next week, third day', week: '2026-11-02', now: '2026-11-08T10:00:00+09:00', date: '2026-11-11', weekStart: '2026-11-09', switchWeek: true },
    { name: 'planner a week behind, early in the week: third day', week: '2026-10-26', now: '2026-11-03T10:00:00+09:00', date: '2026-11-04', weekStart: '2026-11-02', switchWeek: true },
    { name: 'planner a week behind, late in the week: tomorrow, never the past', week: '2026-10-26', now: '2026-11-05T10:00:00+09:00', date: '2026-11-06', weekStart: '2026-11-02', switchWeek: true },
    { name: 'tomorrow is Monday: planner on the week of today', week: '2026-11-02', now: '2026-11-08T23:30:00+09:00', date: '2026-11-11', weekStart: '2026-11-09', switchWeek: true },
  ])('chooses the target day: $name', ({ week, now, name: _name, ...expected }) => {
    const target = chooseTargetDay(week, new Date(now).getTime());
    expect({ date: target.date.toISOString().slice(0, 10), weekStart: target.weekStart, switchWeek: target.switchWeek }).toEqual(expected);
  });
});
