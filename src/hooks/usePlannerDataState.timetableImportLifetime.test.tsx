import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { DayTimetableImportDialog } from '../components/DayTimetableImportDialog';
import { createLocalFixture, deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { buildTimetableImportCandidates } from '../lib/timetableImport';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import type { ScheduleTemplate } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }) }));
const DATE = '2026-10-07';
const templates: ScheduleTemplate[] = ['one', 'two'].map((id, index) => ({
  id, userId: 'owner', title: id, subject: '', type: 'study', weekday: 'wed',
  termId: 'term', startTime: `${9 + index}:00`.padStart(5, '0'), endTime: `${10 + index}:00`,
  memo: '', active: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
}));
let state: UsePlannerDataStateResult; let renderer: ReactTestRenderer;
let showDialog: (open: boolean) => void;
const closed = vi.fn();
function Harness({ owner = 'owner', mounted = true }: { owner?: string; mounted?: boolean }) {
  state = usePlannerDataState({ userId: owner, showNotice: () => undefined });
  const [open, setOpen] = useState(true); showDialog = setOpen;
  const imported = new Set(state.plans.filter(plan => plan.userId === owner && plan.date === state.selectedDate)
    .map(plan => plan.sourceId).filter((id): id is string => Boolean(id)));
  const candidates = buildTimetableImportCandidates({ templates: state.scheduleTemplates, date: state.selectedDate,
    weekday: 'wed', termId: 'term', term: state.timetableTerms[0] });
  return mounted ? <DayTimetableImportDialog open={open} dateLabel={state.selectedDate} selectedDate={state.selectedDate}
    userId={owner} candidates={candidates} importedSourceIds={imported} onSavePlan={state.savePlanDraft}
    onClose={() => { closed(); setOpen(false); }} /> : null;
}
async function mount() {
  const fixture = createLocalFixture(); boundary.repository = fixture.repository;
  await fixture.repository.upsertTimetableTerm({ id: 'term', userId: 'owner', year: 2026, kind: 'custom',
    label: 'Term', isActive: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' });
  for (const template of templates) await fixture.repository.upsertScheduleTemplate(template);
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); state.openDay(DATE); });
  return fixture;
}
const submit = () => renderer.root.findByProps({ className: 'primary-button' });
const inputs = () => renderer.root.findAllByType('input');
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); closed.mockClear(); });

it.each([false, true])('imports exactly once through the real hook/repository across reopen, afterPersist=%s', async afterPersist => {
  const fixture = await mount(); const gate = deferred(); const entered = deferred();
  const original = fixture.repository.upsertPlan;
  const save = vi.fn(async (plan: Parameters<typeof original>[0]) => {
    if (save.mock.calls.length === 1) {
      if (afterPersist) await original(plan);
      entered.resolve(); await gate.promise;
      if (afterPersist) return plan;
    }
    return original(plan);
  });
  boundary.repository = { ...fixture.repository, upsertPlan: save };
  const retained = submit().props.onClick;
  await act(async () => { retained(); await entered.promise; });
  act(() => renderer.root.findAllByType('button').find(button => button.children.includes('閉じる'))!.props.onClick());
  act(() => showDialog(true));
  expect(submit().props.disabled).toBe(true);
  act(() => submit().props.onClick());
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => gate.resolve());
  expect((await fixture.repository.getPlans('owner')).map(plan => plan.sourceId).sort()).toEqual(['one', 'two']);
  expect(state.plans.map(plan => plan.sourceId).sort()).toEqual(['one', 'two']);
  expect(save).toHaveBeenCalledTimes(2); expect(closed).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByType('input')).toHaveLength(2);
});

it.each([false, true])('retains the failed optimistic row for retry, reopened=%s', async reopen => {
  const fixture = await mount(); const original = fixture.repository.upsertPlan;
  const gate = deferred(); const entered = deferred();
  const save = vi.fn(async (plan: Parameters<typeof original>[0]) => {
    if (save.mock.calls.length === 2) { entered.resolve(); await gate.promise; throw new Error('write failed'); }
    return original(plan);
  });
  boundary.repository = { ...fixture.repository, upsertPlan: save };
  await act(async () => { submit().props.onClick(); await entered.promise; });
  if (reopen) { act(() => showDialog(false)); act(() => showDialog(true)); }
  await act(async () => gate.resolve());
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  expect(inputs().map(input => [input.props.checked, input.props.disabled])).toEqual([[false, true], [true, false]]);
  expect(submit().props.disabled).toBe(false);
  await act(async () => submit().props.onClick());
  expect(save.mock.calls.map(([plan]) => plan.sourceId)).toEqual(['one', 'two', 'two']);
  expect((await fixture.repository.getPlans('owner')).map(plan => plan.sourceId).sort()).toEqual(['one', 'two']);
});

it.each(['date', 'owner', 'unmount'] as const)('preserves dispatched persistence but stops undispatched work after %s', async change => {
  const fixture = await mount(); const gate = deferred(); const entered = deferred();
  const save = vi.fn(async (plan: Parameters<PlannerRepository['upsertPlan']>[0]) => {
    await fixture.repository.upsertPlan(plan); entered.resolve(); await gate.promise; return plan;
  });
  boundary.repository = { ...fixture.repository, upsertPlan: save };
  await act(async () => { submit().props.onClick(); await entered.promise; });
  if (change === 'date') act(() => state.openDay('2026-10-08'));
  else if (change === 'owner') await act(async () => { renderer.update(<Harness owner="other" />); });
  else act(() => renderer.update(<Harness mounted={false} />));
  await act(async () => gate.resolve());
  expect(save).toHaveBeenCalledTimes(1);
  expect((await fixture.repository.getPlans('owner')).map(plan => plan.sourceId)).toEqual(['one']);
  expect(await fixture.repository.getPlans('other')).toEqual([]);
  expect(closed).not.toHaveBeenCalled();
  if (change === 'date') expect(state.selectedDate).toBe('2026-10-08');
});

it('does not revive a canceled undispatched class from a closed batch', async () => {
  const fixture = await mount(); const gate = deferred(), entered = deferred();
  const put = fixture.repository.upsertPlan;
  const save = vi.fn(async (plan: Parameters<typeof put>[0]) => {
    if (plan.sourceId === 'one') { entered.resolve(); await gate.promise; }
    return put(plan);
  });
  boundary.repository = { ...fixture.repository, upsertPlan: save };
  await act(async () => { submit().props.onClick(); await entered.promise; });
  act(() => renderer.root.findAllByType('button').find(button => button.children.includes('閉じる'))!.props.onClick());
  const projection = () => createScheduleOccurrenceProjection({ ownerId: 'owner', plans: state.plans, monthEvents: state.monthEvents,
    scheduleTemplates: state.scheduleTemplates, timetableTerms: state.timetableTerms, startDate: DATE, endDate: DATE }).occurrences;
  const second = projection().find(row => row.source.backingKind === 'timetable-template' && row.title === 'two')!;
  await act(async () => { await state.deleteDayOccurrence(second); });
  expect(projection().some(row => row.title === 'two')).toBe(false);
  await act(async () => gate.resolve());
  expect(save.mock.calls.map(([plan]) => plan.sourceId)).toEqual(['one']);
  expect((await fixture.repository.getPlans('owner')).map(plan => plan.sourceId)).toEqual(['one']);
  expect(projection().some(row => row.title === 'two')).toBe(false);
  act(() => showDialog(true));
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  expect(inputs()).toHaveLength(1);
});
