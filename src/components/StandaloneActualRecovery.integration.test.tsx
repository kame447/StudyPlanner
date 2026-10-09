import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DayView } from './DayView';
import { DayTimeline } from './DayTimeline';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';
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
const actual: Actual = { id: 'actual-a', userId: 'owner-a', planId: null, occurrenceDate: DATE,
  actualStartTime: '18:00', actualEndTime: '18:30', title: '元の記録', subject: '英語', note: '元のメモ', updatedAt: '2026-08-14T09:30:00.000Z' };
const plan: Plan = { id: 'plan-a', seriesId: 'plan-a', userId: 'owner-a', title: '英語', subject: '英語', date: DATE,
  startTime: '18:00', endTime: '18:30', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
  createdAt: actual.updatedAt, updatedAt: actual.updatedAt };
let state: UsePlannerDataStateResult; let renderer: ReactTestRenderer | undefined;
const noop = () => undefined; const noopAsync = async () => undefined;
function Harness({ owner = 'owner-a', date = DATE }: { owner?: string; date?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice: noop });
  return <DayView userId={owner} selectedDate={date} plans={state.plans} actuals={state.actuals} monthEvents={[]}
    studySubjects={[]} studyMaterials={[]} scheduleTemplates={[]} timetableTermId="" onChangeDay={noop} onEditPlan={noop}
    onMovePlan={noopAsync} onDeletePlan={noopAsync} onDeleteMonthEvent={noopAsync} onSavePlan={noopAsync} onSaveActual={noopAsync}
    onSaveStandaloneActual={state.saveStandaloneActual} onLinkStandaloneActualToPlan={state.linkStandaloneActualToPlan}
    onDeleteActual={state.deleteActual} onOpenBookshelf={noop} onOpenAddMaterial={noop} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
function input() { return renderer!.root.findByProps({ placeholder: '例: 英語の復習' }); }
function button(label: string) { return renderer!.root.findAllByType('button').find(node => node.children.includes(label))!; }
async function mount() {
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner-a'); });
  await select('actual-a');
}
async function select(id: string) {
  await act(async () => { renderer!.root.findByType(DayTimeline).props.onSelectEntry({ kind: 'standalone-actual', id }); });
}
async function edit() {
  await act(async () => { input().props.onChange({ target: { value: '編集後の記録' } }); });
  await act(async () => { renderer!.root.findByProps({ placeholder: 'メモを追加' }).props.onChange({ target: { value: '失敗しても残すメモ' } }); });
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

it.each(['same-date', 'different-date', 'link', 'delete'] as const)('retains the real day editor after delayed %s failure and permits retry', async mode => {
  await mount(); await edit();
  if (mode === 'different-date') await act(async () => {
    renderer!.root.findByProps({ type: 'date' }).props.onChange({ target: { value: NEXT } });
  });
  const pending = deferred<Actual | void>();
  const persist = mode === 'link' ? repository.upsertActual : mode === 'delete' ? repository.deleteActual : repository.upsertActualWithMaterialProgress;
  persist.mockReturnValueOnce(pending.promise);
  const label = mode === 'link' ? 'この予定に紐づける' : mode === 'delete' ? '記録を削除' : '保存';
  await act(async () => { button(label).props.onClick(); button(label).props.onClick(); });
  expect(persist).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findAllByType(StandaloneActualEditorCard)).toHaveLength(1);
  expect(input().props.value).toBe('編集後の記録');
  expect(renderer!.root.findByType('fieldset').props.disabled).toBe(true);
  if (mode === 'different-date') expect(state.actuals[0].occurrenceDate).toBe(NEXT);
  if (mode === 'link') expect(state.actuals[0].planId).toBe(plan.id);
  if (mode === 'delete') expect(state.actuals).toEqual([]);
  const close = renderer!.root.findByProps({ className: 'schedule-action-close' });
  expect(close.props.disabled).toBe(true);
  await act(async () => {
    close.props.onClick();
    renderer!.root.findByProps({ className: 'overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay bottom-sheet-motion is-open' }).props.onClick();
  });
  expect(renderer!.root.findAllByType(StandaloneActualEditorCard)).toHaveLength(1);
  await act(async () => { pending.reject(new Error('offline')); await pending.promise.catch(noop); });
  expect(state.actuals).toEqual([actual]);
  expect(input().props.value).toBe('編集後の記録');
  expect(renderer!.root.findByProps({ placeholder: 'メモを追加' }).props.value).toBe('失敗しても残すメモ');
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('もう一度');
  expect(button(label).props.disabled).toBe(false);
  await act(async () => { button(label).props.onClick(); });
  expect(persist).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findAllByType(StandaloneActualEditorCard)).toHaveLength(0);
  if (mode === 'delete') expect(state.actuals).toEqual([]);
  else {
    expect(state.actuals).toEqual([expect.objectContaining({ id: actual.id, title: '編集後の記録', note: '失敗しても残すメモ',
      occurrenceDate: mode === 'different-date' ? NEXT : DATE, planId: mode === 'link' ? plan.id : null })]);
  }
});

it('does not let a stale completion close or reset a replacement owner, date or record session', async () => {
  for (const replacement of ['owner', 'date', 'record', 'unmount'] as const) {
    await mount(); await edit();
    const pending = deferred<Actual>(); repository.upsertActualWithMaterialProgress.mockReturnValueOnce(pending.promise);
    await act(async () => { button('保存').props.onClick(); });
    const owner = replacement === 'owner' ? 'owner-b' : 'owner-a';
    const date = replacement === 'date' ? NEXT : DATE;
    const second = { ...actual, id: 'actual-b', userId: owner, occurrenceDate: date, title: '別の記録' };
    repository.getActuals.mockResolvedValue([second]); repository.getPlans.mockResolvedValue([]);
    await act(async () => {
      if (replacement === 'unmount') {
        renderer!.unmount();
        renderer = create(<Harness owner={owner} date={date} />);
      } else renderer!.update(<Harness owner={owner} date={date} />);
    });
    await act(async () => { await state.loadPlannerData(owner); });
    await select(second.id); await edit();
    await act(async () => { pending.resolve({ ...actual, title: '古い保存結果' }); await pending.promise; });
    expect(renderer!.root.findAllByType(StandaloneActualEditorCard)).toHaveLength(1);
    expect(input().props.value).toBe('編集後の記録');
    expect(renderer!.root.findByType(StandaloneActualEditorCard).props.actual.id).toBe(second.id);
    act(() => renderer!.unmount()); renderer = undefined;
    repository.getActuals.mockResolvedValue([actual]); repository.getPlans.mockResolvedValue([plan]);
  }
});

it('keeps validation errors local and still allows intentional dismissal', async () => {
  await mount();
  await act(async () => { input().props.onChange({ target: { value: '' } }); });
  await act(async () => { button('保存').props.onClick(); });
  expect(repository.upsertActualWithMaterialProgress).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('タイトル');
  await act(async () => { renderer!.root.findByProps({ className: 'schedule-action-close' }).props.onClick(); });
  expect(renderer!.root.findAllByType(StandaloneActualEditorCard)).toHaveLength(0);
});
