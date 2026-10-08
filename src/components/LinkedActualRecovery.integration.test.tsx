import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DayView } from './DayView';
import { DayTimeline } from './DayTimeline';
import { ActualEditorCard } from './ActualEditorCard';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
import type { Actual, Plan } from '../types/domain';

const repository = vi.hoisted(() => ({
  getScheduleSnapshot: vi.fn(), getPlans: vi.fn(), getActuals: vi.fn(), getDayNotes: vi.fn(), getMonthEvents: vi.fn(), getTodos: vi.fn(),
  getStudySubjects: vi.fn(), getStudyMaterials: vi.fn(), getScheduleTemplates: vi.fn(), getTimetableTerms: vi.fn(), getTimetablePeriods: vi.fn(),
  applyTimetableMutation: vi.fn(),
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
const noop = () => undefined; const noopAsync = async () => undefined;
function Harness({ owner = 'owner-a', date = DATE }: { owner?: string; date?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice: noop });
  return <DayView userId={owner} selectedDate={date} plans={state.plans} actuals={state.actuals} monthEvents={[]}
    studySubjects={[]} studyMaterials={[]} scheduleTemplates={[]} timetableTermId="" onChangeDay={noop} onEditPlan={noop}
    onMovePlan={noopAsync} onDeletePlan={noopAsync} onDeleteMonthEvent={noopAsync} onSavePlan={noopAsync} onSaveActual={state.saveActual}
    onSaveStandaloneActual={state.saveStandaloneActual} onLinkStandaloneActualToPlan={state.linkStandaloneActualToPlan}
    onDeleteActual={state.deleteActual} onOpenBookshelf={noop} onOpenAddMaterial={noop} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
function note() { return renderer!.root.findByType('textarea'); }
function button(label: string) { return renderer!.root.findAllByType('button').find(node => node.children.includes(label))!; }
async function mount() {
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner-a'); });
  await select(plan.id);
}
async function select(id: string) {
  await act(async () => { renderer!.root.findByType(DayTimeline).props.onSelectEntry({ kind: 'plan', id }); });
  await act(async () => {
    renderer!.root.findAllByType('button').find(b => b.findAllByType('strong')
      .some(label => ['記録を保存', '記録を編集'].includes(label.children.join(''))))!.props.onClick();
  });
}
async function edit() {
  await act(async () => { note().props.onChange({ target: { value: '失敗しても残すメモ' } }); });
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
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it.each(['new', 'same-date', 'different-date', 'relink', 'delete'] as const)(
  'preserves %s input through optimistic updates, failure and retry', async mode => {
    repository.getActuals.mockResolvedValue(mode === 'new' ? [] : [actual]);
    const nextPlan = { ...plan, id: 'plan-next', seriesId: 'plan-next', date: NEXT };
    repository.getPlans.mockResolvedValue([plan, nextPlan]);
    await mount(); await edit();
    const moved = mode === 'different-date' || mode === 'relink';
    if (moved) await act(async () => {
      renderer!.root.findByProps({ type: 'date' }).props.onChange({ target: { value: NEXT } });
    });
    if (mode === 'relink') await act(async () => { button('この予定に紐づける').props.onClick(); });
    const pending = deferred<Actual | void>();
    const persist = mode === 'delete' ? repository.deleteActual : repository.upsertActualWithMaterialProgress;
    persist.mockReturnValueOnce(pending.promise);
    const label = mode === 'delete' ? '記録削除' : '記録保存';
    const action = button(label).props.onClick;
    await act(async () => { action(); action(); });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(note().props.value).toBe('失敗しても残すメモ');
    expect(renderer!.root.findByType('fieldset').props.disabled).toBe(true);
    if (moved) expect(state.actuals[0].occurrenceDate).toBe(NEXT);
    if (mode === 'delete') expect(state.actuals).toEqual([]);
    for (const name of ['戻る', '閉じる']) {
      const control = renderer!.root.findByProps({ 'aria-label': name });
      expect(control.props.disabled).toBe(true);
      await act(async () => { control.props.onClick(); });
    }
    await act(async () => { renderer!.root.findByProps({ className: 'overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay bottom-sheet-motion is-open' }).props.onClick(); });
    expect(renderer!.root.findAllByType(ActualEditorCard)).toHaveLength(1);
    await act(async () => { pending.reject(new Error('offline')); });
    expect(state.actuals).toEqual(mode === 'new' ? [] : [actual]);
    expect(note().props.value).toBe('失敗しても残すメモ');
    expect(renderer!.root.findByProps({ type: 'date' }).props.value).toBe(moved ? NEXT : DATE);
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('もう一度');
    expect(renderer!.root.findByType('fieldset').props.disabled).toBe(false);
    await act(async () => { button(label).props.onClick(); });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findAllByType(ActualEditorCard)).toHaveLength(0);
    if (mode === 'delete') expect(state.actuals).toEqual([]);
    else {
      expect(state.actuals).toEqual([expect.objectContaining({ note: '失敗しても残すメモ',
        occurrenceDate: moved ? NEXT : DATE,
        planId: mode === 'relink' ? nextPlan.id : mode === 'different-date' ? null : plan.id })]);
      if (mode !== 'new') expect(state.actuals[0].id).toBe(actual.id);
    }
  },
);

it('ignores late completion after owner, day, plan or mounted view replacement', async () => {
  for (const replacement of ['owner', 'date', 'plan', 'unmount'] as const) {
    await mount(); await edit();
    const pending = deferred<Actual>(); repository.upsertActualWithMaterialProgress.mockReturnValueOnce(pending.promise);
    await act(async () => { button('記録保存').props.onClick(); });
    const owner = replacement === 'owner' ? 'owner-b' : 'owner-a';
    const date = replacement === 'date' ? NEXT : DATE;
    const second = { ...plan, id: 'plan-b', seriesId: 'plan-b', userId: owner, date, title: '別の予定' };
    repository.getPlans.mockResolvedValue([second]); repository.getActuals.mockResolvedValue([]);
    await act(async () => {
      if (replacement === 'unmount') { renderer!.unmount(); renderer = create(<Harness owner={owner} date={date} />); }
      else renderer!.update(<Harness owner={owner} date={date} />);
    });
    await act(async () => { await state.loadPlannerData(owner); });
    await select(second.id); await edit();
    await act(async () => { pending.resolve({ ...actual, note: '古い結果' }); });
    expect(renderer!.root.findAllByType(ActualEditorCard)).toHaveLength(1);
    expect(renderer!.root.findByType(ActualEditorCard).props.plan.id).toBe(second.id);
    expect(note().props.value).toBe('失敗しても残すメモ');
    act(() => renderer!.unmount()); renderer = undefined;
    repository.getPlans.mockResolvedValue([plan]); repository.getActuals.mockResolvedValue([actual]);
  }
});

it('allows an intentional back and reopen with fresh saved data after validation failure', async () => {
  await mount(); await edit();
  await act(async () => { renderer!.root.findByProps({ type: 'time', value: actual.actualEndTime }).props.onChange({ target: { value: '18:00' } }); });
  await act(async () => { button('記録保存').props.onClick(); });
  expect(repository.upsertActualWithMaterialProgress).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('終了時刻');
  await act(async () => { renderer!.root.findByProps({ 'aria-label': '戻る' }).props.onClick(); });
  expect(renderer!.root.findAllByType(ActualEditorCard)).toHaveLength(0);
  await select(plan.id);
  expect(note().props.value).toBe(actual.note);
  vi.useFakeTimers();
  vi.stubGlobal('window', { ...window, matchMedia: () => ({ matches: false }) });
  try {
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '閉じる' }).props.onClick(); });
    expect(renderer!.root.findByType('fieldset').props.disabled).toBe(true);
    await act(async () => { button('記録保存').props.onClick(); });
    expect(repository.upsertActualWithMaterialProgress).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(280); });
    expect(renderer!.root.findAllByType(ActualEditorCard)).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});
