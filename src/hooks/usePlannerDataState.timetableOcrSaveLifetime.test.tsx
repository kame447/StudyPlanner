import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { TimetableOcrImportDialog } from '../components/TimetableOcrImportDialog';
import { createLocalFixture, deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { TimetableOcrResult } from '../lib/timetableOcrImport';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const result: TimetableOcrResult = {
  periods: [{ periodNumber: 1, startTime: '09:00', endTime: '10:00' }],
  items: ['数学', '英語'].map((title, index) => ({ weekday: index === 0 ? 'mon' : 'tue', periodNumber: 1,
    startTime: '09:00', endTime: '10:00', title, subject: title, classroom: '', memo: '' })),
};
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer;
const closed = vi.fn();
function Harness({ mounted = true }: { mounted?: boolean }) {
  state = usePlannerDataState({ userId: 'owner', showNotice: () => undefined });
  const [open, setOpen] = useState(true);
  return mounted && open ? <TimetableOcrImportDialog userId="owner" termId="term" fileName="synthetic.png"
    result={result} existingPeriods={state.timetablePeriods} existingTemplates={state.scheduleTemplates}
    onSaveTimetablePeriod={state.saveTimetablePeriod} onSaveScheduleTemplate={state.saveScheduleTemplate}
    onClose={() => { closed(); setOpen(false); }} /> : null;
}
async function mount() {
  const fixture = createLocalFixture();
  boundary.repository = fixture.repository;
  await fixture.repository.upsertTimetableTerm({ id: 'term', userId: 'owner', year: 2026, kind: 'custom',
    label: 'Term', isActive: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' });
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}
const submit = () => renderer.root.findByProps({ className: 'primary-button timetable-ocr-save' });
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); closed.mockClear(); });

it.each([false, true])('persists exactly the confirmed OCR rows once, including a held response after persistence=%s', async afterPersist => {
  const fixture = await mount();
  const gate = deferred(), entered = deferred();
  const original = fixture.repository.upsertTimetablePeriod;
  const savePeriod = vi.fn(async (period: Parameters<typeof original>[0]) => {
    if (savePeriod.mock.calls.length === 1) {
      if (afterPersist) await original(period);
      entered.resolve(); await gate.promise;
      if (afterPersist) return period;
    }
    return original(period);
  });
  const saveTemplate = vi.fn(fixture.repository.upsertScheduleTemplate);
  boundary.repository = { ...fixture.repository, upsertTimetablePeriod: savePeriod, upsertScheduleTemplate: saveTemplate };
  const retained = submit().props.onClick;
  await act(async () => { retained(); retained(); await entered.promise; });
  expect(savePeriod).toHaveBeenCalledOnce();
  expect(submit().props.disabled).toBe(true);
  await act(async () => gate.resolve());
  expect(savePeriod).toHaveBeenCalledOnce();
  expect(saveTemplate).toHaveBeenCalledTimes(2);
  expect(closed).toHaveBeenCalledOnce();
  const durable = await fixture.repository.getScheduleTemplates('owner');
  expect(durable.map(row => row.title).sort()).toEqual(['数学', '英語'].sort());
  expect(new Set(durable.map(row => row.id)).size).toBe(2);
  expect(await fixture.repository.getTimetablePeriods('owner')).toHaveLength(1);
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.scheduleTemplates).toEqual(durable);
  expect(saveTemplate).toHaveBeenCalledTimes(2);
});

it('retains a partially failed draft and reuses confirmed IDs on retry instead of adding duplicate rows', async () => {
  const fixture = await mount();
  const gate = deferred(), entered = deferred();
  const original = fixture.repository.upsertScheduleTemplate;
  const save = vi.fn(async (template: Parameters<typeof original>[0]) => {
    if (save.mock.calls.length === 2) { entered.resolve(); await gate.promise; throw new Error('controlled failure before persistence'); }
    return original(template);
  });
  boundary.repository = { ...fixture.repository, upsertScheduleTemplate: save };
  await act(async () => { submit().props.onClick(); await entered.promise; });
  await act(async () => gate.resolve());
  expect(renderer.root.findAllByProps({ className: 'inline-error' })).toHaveLength(1);
  expect(renderer.root.findAllByProps({ placeholder: '授業名' }).map(input => input.props.value)).toEqual(['数学', '英語']);
  expect(closed).not.toHaveBeenCalled();
  const first = await fixture.repository.getScheduleTemplates('owner');
  expect(first.map(row => row.title)).toEqual(['数学']);
  await act(async () => submit().props.onClick());
  const durable = await fixture.repository.getScheduleTemplates('owner');
  expect(durable.map(row => row.title).sort()).toEqual(['数学', '英語'].sort());
  expect(durable.find(row => row.title === '数学')?.id).toBe(first[0].id);
  expect(await fixture.repository.getTimetablePeriods('owner')).toHaveLength(1);
  expect(closed).toHaveBeenCalledOnce();
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.scheduleTemplates).toEqual(durable);
});

it('retains an already-persisted period but starts no further writes after the OCR dialog unmounts', async () => {
  const fixture = await mount();
  const gate = deferred(), entered = deferred();
  const save = vi.fn(async (period: Parameters<PlannerRepository['upsertTimetablePeriod']>[0]) => {
    await fixture.repository.upsertTimetablePeriod(period); entered.resolve(); await gate.promise; return period;
  });
  const saveTemplate = vi.fn(fixture.repository.upsertScheduleTemplate);
  boundary.repository = { ...fixture.repository, upsertTimetablePeriod: save, upsertScheduleTemplate: saveTemplate };
  await act(async () => { submit().props.onClick(); await entered.promise; });
  act(() => renderer.update(<Harness mounted={false} />));
  await act(async () => gate.resolve());
  expect(await fixture.repository.getTimetablePeriods('owner')).toHaveLength(1);
  expect(await fixture.repository.getScheduleTemplates('owner')).toEqual([]);
  expect(saveTemplate).not.toHaveBeenCalled();
  expect(closed).not.toHaveBeenCalled();
});

it('preserves an acknowledged class while preventing the next class and late dismissal after unmount', async () => {
  const fixture = await mount();
  const gate = deferred(), entered = deferred();
  const save = vi.fn(async (template: Parameters<PlannerRepository['upsertScheduleTemplate']>[0]) => {
    await fixture.repository.upsertScheduleTemplate(template); entered.resolve(); await gate.promise; return template;
  });
  boundary.repository = { ...fixture.repository, upsertScheduleTemplate: save };
  await act(async () => { submit().props.onClick(); await entered.promise; });
  act(() => renderer.update(<Harness mounted={false} />));
  await act(async () => gate.resolve());
  expect(await fixture.repository.getTimetablePeriods('owner')).toHaveLength(1);
  expect((await fixture.repository.getScheduleTemplates('owner')).map(row => row.title)).toEqual(['数学']);
  expect(save).toHaveBeenCalledOnce();
  expect(closed).not.toHaveBeenCalled();
});
