import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Firestore } from 'firebase/firestore';
import type { PlannerRepository } from './repositoryContracts';
import type { ScheduleTemplate, TimetableTerm } from '../types/domain';
import { normalizePlannerTimetableData } from '../domain/plannerDataTransforms';
import { createTimetableTermId } from '../domain/timetableDataNormalization';
import { createLocalFixture } from './localPersistenceConcurrency.testUtils';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
import { TimetableOcrImportDialog } from '../components/TimetableOcrImportDialog';
import { buildTimetableImportCandidates } from '../lib/timetableImport';

const sdk = vi.hoisted(() => ({
  rows: new Map<string, Map<string, any>>(),
  batches: [] as { collectionName: string; id: string; deleted: boolean }[][],
  failNextCommit: false,
}));
const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
vi.mock('firebase/firestore', () => {
  function apply(operations: any[], uid: string) {
    // Models the existing owner-only Firestore rules, including whole-batch rejection.
    for (const { ref, value } of operations) {
      const previous = sdk.rows.get(ref.collectionName)?.get(ref.id);
      if ((previous && previous.userId !== uid) || (value && value.userId !== uid)) {
        throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      }
    }
    if (sdk.failNextCommit) {
      sdk.failNextCommit = false;
      throw new Error('synthetic commit failure');
    }
    for (const { ref, value } of operations) {
      let rows = sdk.rows.get(ref.collectionName);
      if (!rows) sdk.rows.set(ref.collectionName, rows = new Map());
      if (value) rows.set(ref.id, structuredClone(value)); else rows.delete(ref.id);
    }
  }
  return {
    collection: (_db: any, name: string) => ({ name }),
    doc: (db: any, collectionName: string, id: string) => ({ collectionName, id, uid: db.uid }),
    where: (field: string, _op: string, value: any) => ({ field, value }),
    query: (collection: any, ...conditions: any[]) => ({ ...collection, conditions }),
    deleteField: () => null,
    getDocs: async (query: any) => ({ docs: [...(sdk.rows.get(query.name)?.values() ?? [])]
      .filter(row => query.conditions.every((condition: any) => row[condition.field] === condition.value))
      .map(row => ({ id: row.id, data: () => structuredClone(row) })) }),
    deleteDoc: async (ref: any) => apply([{ ref }], ref.uid),
    setDoc: async (ref: any, value: any) => apply([{ ref, value }], ref.uid),
    writeBatch: (db: any) => {
      const operations: any[] = [];
      return {
        set: (ref: any, value: any) => operations.push({ ref, value }),
        delete: (ref: any) => operations.push({ ref }),
        commit: async () => {
          sdk.batches.push(operations.map(({ ref, value }) => ({ collectionName: ref.collectionName,
            id: ref.id, deleted: !value })));
          apply(operations, db.uid);
        },
      };
    },
  };
});
import { createFirebasePlannerRepository } from './firebasePlannerRepository';

const owner = 'affected-owner';
const foreignOwner = 'other-owner';
const stamp = '2026-10-05T00:00:00.000Z';
const empty = { scheduleTemplates: [], timetableTerms: [], timetablePeriods: [] };
const notice = vi.fn();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: owner, showNotice: notice }); return null; }
function legacyTerm(userId = foreignOwner): TimetableTerm {
  return { id: '2026-full-year', userId, year: 2026, kind: 'fullYear', label: '2026年 通年',
    isActive: true, createdAt: stamp, updatedAt: stamp };
}
function templates(): ScheduleTemplate[] {
  return Array.from({ length: 6 }, (_, index) => ({ id: `template-${index}`, userId: owner,
    title: `Synthetic course ${index}`, subject: 'Study', type: 'school-event', weekday: 'mon',
    startTime: '09:00', endTime: '10:00', termId: '2026-full-year', memo: '', active: true,
    createdAt: stamp, updatedAt: stamp }));
}
function seedObservedShape() {
  sdk.rows.set('timetable_terms', new Map([['2026-full-year', legacyTerm()]]));
  sdk.rows.set('schedule_templates', new Map(templates().map(row => [row.id, row])));
}
async function mountAndLoad() {
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData(owner); });
}
beforeEach(() => {
  sdk.rows.clear(); sdk.batches.length = 0; sdk.failNextCommit = false; notice.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(stamp));
  boundary.repository = createFirebasePlannerRepository({ uid: owner } as unknown as Firestore);
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });

it('loads a synthetic missing-term fixture with seven owned writes and no foreign change', async () => {
  seedObservedShape();
  const foreignSnapshot = structuredClone(sdk.rows.get('timetable_terms')?.get('2026-full-year'));
  await mountAndLoad();
  expect(notice.mock.calls.some(([message]) => String(message).includes('整合化できませんでした'))).toBe(false);
  expect(state.plannerDataAvailability.status).toBe('ready');
  expect(state.timetableTerms).toHaveLength(1);
  const id = 'timetable-term:YWZmZWN0ZWQtb3duZXI:2026-full-year';
  expect(state.timetableTerms[0].id).toBe(id);
  expect(state.scheduleTemplates.map(row => row.termId)).toEqual(Array(6).fill(id));
  expect(sdk.batches[0]).toHaveLength(7);
  expect(sdk.batches[0].every(operation => !operation.deleted)).toBe(true);
  expect(sdk.batches[0].some(operation => operation.id === '2026-full-year')).toBe(false);
  expect(sdk.rows.get('timetable_terms')?.get('2026-full-year')).toEqual(foreignSnapshot);
  await act(async () => { await state.loadPlannerData(owner); });
  expect(sdk.batches[sdk.batches.length - 1]).toEqual([]);
  expect(await boundary.repository.getScheduleTemplates(owner)).toEqual(state.scheduleTemplates);
});

it('keeps the original owned projection and all foreign rows if atomic migration fails', async () => {
  seedObservedShape(); sdk.failNextCommit = true;
  const snapshot = structuredClone(sdk.rows);
  await mountAndLoad();
  expect(notice).toHaveBeenCalledWith('時間割データを整合化できませんでした。再読み込みしてください。', 'error');
  expect(sdk.rows).toEqual(snapshot);
  expect(state.timetableTerms).toEqual([]);
  expect(state.scheduleTemplates.map(row => row.termId)).toEqual(Array(6).fill('2026-full-year'));
});

it('atomically replaces an owned legacy term and its references without changing the other account', async () => {
  const own = legacyTerm(owner);
  sdk.rows.set('timetable_terms', new Map([[own.id, own], ['foreign-custom', { ...legacyTerm(), id: 'foreign-custom', kind: 'custom' }]]));
  sdk.rows.set('schedule_templates', new Map(templates().map(row => [row.id, row])));
  const foreignSnapshot = structuredClone(sdk.rows.get('timetable_terms')?.get('foreign-custom'));
  await mountAndLoad();
  expect(sdk.batches[0]).toHaveLength(8);
  expect(sdk.batches[0].filter(operation => operation.deleted)).toEqual([{ collectionName: 'timetable_terms', id: '2026-full-year', deleted: true }]);
  expect(sdk.rows.get('timetable_terms')?.has('2026-full-year')).toBe(false);
  expect(sdk.rows.get('timetable_terms')?.get('foreign-custom')).toEqual(foreignSnapshot);
});

it('keeps same-year terms independent in the real local adapter, including orphan template references', async () => {
  const { repository, gateway } = createLocalFixture();
  await gateway.writeTimetableTerms([legacyTerm()]);
  await gateway.writeScheduleTemplates(templates());
  const result = normalizePlannerTimetableData(owner, { ...empty, scheduleTemplates: templates() }, stamp);
  await repository.applyTimetableMutation(result.mutation);
  expect(await repository.getTimetableTerms(foreignOwner)).toEqual([legacyTerm()]);
  expect(await repository.getTimetableTerms(owner)).toEqual(result.timetableTerms);
  expect((await repository.getScheduleTemplates(owner)).map(row => row.termId)).toEqual(Array(6).fill(result.timetableTerms[0].id));
  await repository.applyTimetableMutation(normalizePlannerTimetableData(foreignOwner, {
    ...empty, timetableTerms: [legacyTerm()],
  }, stamp).mutation);
  expect((await repository.getTimetableTerms(owner))[0].id).not.toBe((await repository.getTimetableTerms(foreignOwner))[0].id);
});

it('uses owner-scoped manual activation, preserves OCR period/template references, and deletes only that term', async () => {
  seedObservedShape(); await mountAndLoad();
  let first!: TimetableTerm;
  await act(async () => { first = await state.activateTimetableTerm({ userId: owner, year: 2026, kind: 'firstHalf', label: '' }); });
  expect(first.id).toBe(createTimetableTermId(owner, 2026, 'firstHalf'));
  const close = vi.fn();
  const dialog = create(<TimetableOcrImportDialog userId={owner} termId={first.id} fileName="synthetic.png"
    result={{ periods: [{ periodNumber: 1, startTime: '09:00', endTime: '10:00' }], items: [{ weekday: 'mon', periodNumber: 1,
      startTime: '09:00', endTime: '10:00', title: 'Synthetic import', subject: 'Study', classroom: '', memo: '' }] }}
    existingPeriods={state.timetablePeriods} existingTemplates={state.scheduleTemplates} onClose={close}
    onSaveTimetablePeriod={state.saveTimetablePeriod} onSaveScheduleTemplate={state.saveScheduleTemplate} />);
  try {
    const save = dialog.root.findAllByType('button').find(button => button.children.includes('時間割に反映'));
    expect(save).toBeDefined();
    await act(async () => { await save!.props.onClick(); });
    expect(close).toHaveBeenCalledOnce();
  } finally { act(() => dialog.unmount()); }
  const imported = state.scheduleTemplates.filter(row => row.termId === first.id);
  expect(imported).toHaveLength(1);
  expect(state.timetablePeriods.map(row => row.termId)).toEqual([first.id]);
  expect(buildTimetableImportCandidates({ templates: imported, date: '2026-10-05', weekday: 'mon', termId: first.id, term: first })).toHaveLength(1);
  await act(async () => { await state.deleteTimetableTerm(first); });
  expect(state.scheduleTemplates).toHaveLength(6);
  expect(state.timetablePeriods).toEqual([]);
  expect(sdk.rows.get('timetable_terms')?.get('2026-full-year')).toEqual(legacyTerm());
});
