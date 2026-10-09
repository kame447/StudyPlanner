import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DayView } from './DayView';
import { DayTimeline } from './DayTimeline';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
import type { Actual, Plan } from '../types/domain';

const repository = vi.hoisted(() => ({
  getScheduleSnapshot: vi.fn(), getPlans: vi.fn(), getActuals: vi.fn(), getDayNotes: vi.fn(), getMonthEvents: vi.fn(), getTodos: vi.fn(),
  getStudySubjects: vi.fn(), getStudyMaterials: vi.fn(), getScheduleTemplates: vi.fn(), getTimetableTerms: vi.fn(), getTimetablePeriods: vi.fn(),
  applyTimetableMutation: vi.fn(), deletePlanWithDependents: vi.fn(), applyRecurringPlanMutation: vi.fn(),
  upsertActualWithMaterialProgress: vi.fn(), upsertActual: vi.fn(), deleteActual: vi.fn(),
}));
vi.mock('../repositories', () => ({ plannerRepository: repository }));
const DATE = '2026-08-14'; const NEXT = '2026-08-15';
const actual: Actual = { id: 'actual-a', userId: 'owner-a', planId: 'plan-a', occurrenceDate: DATE,
  actualStartTime: '18:00', actualEndTime: '18:30', title: '英語', subject: '英語', note: '元のメモ', updatedAt: '2026-08-14T09:30:00.000Z' };
const plan: Plan = { id: 'plan-a', seriesId: 'plan-a', userId: 'owner-a', title: '英語', subject: '英語', date: DATE,
  startTime: '18:00', endTime: '18:30', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
  createdAt: actual.updatedAt, updatedAt: actual.updatedAt };
let state: UsePlannerDataStateResult; let renderer: ReactTestRenderer | undefined;
const showNotice = vi.fn(); const noop = () => undefined; const noopAsync = async () => undefined;
function Harness({ owner = 'owner-a', date = DATE }: { owner?: string; date?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice });
  return <DayView userId={owner} selectedDate={date} plans={state.plans} actuals={state.actuals} monthEvents={[]}
    studySubjects={[]} studyMaterials={[]} scheduleTemplates={[]} timetableTermId="" onChangeDay={noop} onEditPlan={noop}
    onMovePlan={noopAsync} onDeletePlan={state.deletePlan} onDeleteMonthEvent={noopAsync} onSavePlan={noopAsync} onSaveActual={state.saveActual}
    onSaveStandaloneActual={state.saveStandaloneActual} onLinkStandaloneActualToPlan={state.linkStandaloneActualToPlan}
    onDeleteActual={state.deleteActual} onOpenBookshelf={noop} onOpenAddMaterial={noop} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
async function mount() {
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner-a'); });
  await select(plan.id);
}
async function select(id: string) {
  await act(async () => { renderer!.root.findByType(DayTimeline).props.onSelectEntry({ kind: 'plan', id }); });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', { addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout,
    matchMedia: () => ({ matches: true }), confirm: vi.fn(() => true) });
  for (const [name, fn] of Object.entries(repository)) if (name.startsWith('get')) fn.mockReset().mockResolvedValue([]);
  repository.getScheduleSnapshot.mockImplementation(async (ownerId: string) => {
    const [plans, monthEvents] = await Promise.all([repository.getPlans(ownerId), repository.getMonthEvents(ownerId)]);
    return { plans, monthEvents };
  });
  repository.getActuals.mockResolvedValue([actual]); repository.getPlans.mockResolvedValue([plan]);
  repository.upsertActualWithMaterialProgress.mockReset().mockImplementation(async ({ actual: next }: { actual: Actual }) => next);
  repository.upsertActual.mockReset().mockImplementation(async (next: Actual) => next);
  repository.deleteActual.mockReset().mockResolvedValue(undefined);
  repository.applyTimetableMutation.mockReset().mockResolvedValue(undefined);
  repository.deletePlanWithDependents.mockReset().mockResolvedValue(undefined);
  repository.applyRecurringPlanMutation.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });


function deleteButton() { return renderer!.root.findAllByType('button').find(b => b.findAllByType('strong').some(label => label.children.join('') === '削除'))!; }
function dialogs() { return renderer!.root.findAllByProps({ role: 'dialog' }); }
it.each(['same-day', 'overnight', 'yearly'] as const)('retains a %s deletion menu through failure and retry', async mode => {
  const source = mode === 'overnight' ? { ...plan, date: '2026-08-13', startTime: '23:00', endTime: '01:00' }
    : mode === 'yearly' ? { ...plan, date: '2025-08-14', repeat: 'yearly' as const } : plan;
  repository.getPlans.mockResolvedValue([source]);
  await mount();
  const pending = deferred<void>(); repository.deletePlanWithDependents.mockReturnValueOnce(pending.promise);
  const remove = deleteButton().props.onClick;
  await act(async () => { remove(); remove(); });
  expect(repository.deletePlanWithDependents).toHaveBeenCalledTimes(1);
  expect(state.plans).toEqual([]); expect(state.actuals).toEqual([]);
  expect(dialogs()).toHaveLength(1);
  for (const control of dialogs()[0].findAllByType('button')) expect(control.props.disabled).toBe(true);
  await act(async () => {
    renderer!.root.findByProps({ 'aria-label': '閉じる' }).props.onClick();
    renderer!.root.findByProps({ className: 'overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay bottom-sheet-motion is-open' }).props.onClick();
  });
  expect(dialogs()).toHaveLength(1);
  await act(async () => { pending.reject(new Error('offline')); });
  expect(state.plans).toEqual([source]); expect(state.actuals).toEqual([actual]);
  expect(repository.deletePlanWithDependents.mock.calls[0][0].plan.date).toBe(source.date);
  expect(dialogs()).toHaveLength(1);
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('もう一度');
  expect(deleteButton().props.disabled).toBe(false);
  await act(async () => { deleteButton().props.onClick(); });
  expect(repository.deletePlanWithDependents).toHaveBeenCalledTimes(2);
  expect(state.plans).toEqual([]); expect(state.actuals).toEqual([]); expect(dialogs()).toHaveLength(0);
});

it('isolates old success and failure after plan, owner, date or mounted-view replacement', async () => {
  for (const replacement of ['plan', 'owner', 'date', 'unmount'] as const) {
    for (const outcome of ['success', 'failure'] as const) {
      await mount();
      const first = deferred<void>(); repository.deletePlanWithDependents.mockReturnValueOnce(first.promise);
      await act(async () => { deleteButton().props.onClick(); });
      const owner = replacement === 'owner' ? 'owner-b' : 'owner-a';
      const date = replacement === 'date' ? NEXT : DATE;
      const second = { ...plan, id: 'plan-b', seriesId: 'plan-b', userId: owner, date, title: '別の予定' };
      repository.getPlans.mockResolvedValue([second]); repository.getActuals.mockResolvedValue([]);
      await act(async () => {
        if (replacement === 'unmount') { renderer!.unmount(); renderer = create(<Harness owner={owner} date={date} />); }
        else renderer!.update(<Harness owner={owner} date={date} />);
      });
      await act(async () => { await state.loadPlannerData(owner); });
      await select(second.id);
      const later = deferred<void>(); repository.deletePlanWithDependents.mockReturnValueOnce(later.promise);
      await act(async () => { deleteButton().props.onClick(); });
      await act(async () => { if (outcome === 'success') first.resolve(); else first.reject(new Error('old failure')); });
      expect(dialogs()).toHaveLength(1);
      expect(dialogs()[0].props['aria-label']).toBe('別の予定の操作');
      expect(deleteButton().props.disabled).toBe(true);
      expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
      await act(async () => { later.resolve(); });
      expect(dialogs()).toHaveLength(0);
      act(() => renderer!.unmount()); renderer = undefined;
      repository.getPlans.mockResolvedValue([plan]); repository.getActuals.mockResolvedValue([actual]);
    }
  }
});

it('preserves recurring scope selection and its existing failed-mutation retry boundary', async () => {
  const recurring = { ...plan, repeat: 'weekly' as const, repeatUntil: '2026-09-30' };
  repository.getPlans.mockResolvedValue([recurring]); await mount();
  await act(async () => { deleteButton().props.onClick(); });
  expect(repository.deletePlanWithDependents).not.toHaveBeenCalled();
  expect(state.pendingRecurringPlanAction).toMatchObject({ kind: 'delete', plan: { id: plan.id } });
  expect(dialogs()).toHaveLength(0);
  const pending = deferred<void>(); repository.applyRecurringPlanMutation.mockReturnValueOnce(pending.promise);
  let operation!: Promise<void>; await act(async () => { operation = state.confirmRecurringPlanScope('single'); });
  await act(async () => { pending.reject(new Error('scope-offline')); await operation; });
  expect(state.pendingRecurringPlanAction).toMatchObject({ kind: 'delete', plan: { id: plan.id } });
  await act(async () => { await state.confirmRecurringPlanScope('single'); });
  expect(state.pendingRecurringPlanAction).toBeNull(); expect(repository.applyRecurringPlanMutation).toHaveBeenCalledTimes(2);
});

it('does not start deletion after dismissal begins and still closes externally removed idle targets', async () => {
  await mount();
  vi.useFakeTimers(); vi.stubGlobal('window', { ...window, matchMedia: () => ({ matches: false }) });
  try {
    const remove = deleteButton().props.onClick;
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '閉じる' }).props.onClick();
      remove();
    });
    expect(repository.deletePlanWithDependents).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(280); });
    expect(dialogs()).toHaveLength(0);
  } finally { vi.useRealTimers(); }
  await select(plan.id);
  repository.getPlans.mockResolvedValue([]);
  await act(async () => { await state.loadPlannerData('owner-a'); });
  expect(dialogs()).toHaveLength(0);
});
