// #974: an actual-save acknowledgement is withheld while the real weekly view receives the hook's data.
// Repository I/O is synthetic; optimistic state, the WeekView, and the local commit path are real.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { createLocalFixture, deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { DurationActualInput } from '../domain/durationActuals';
import type { DurationActual } from '../types/domain';
import { WeekView } from '../components/WeekView';
import { SAVING_ACTUAL_RECORDS_LABEL } from '../features/weeklyPlanning/application/weeklyPlanningActualRecords';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', async importOriginal => ({ ...await importOriginal<typeof import('../repositories')>(),
  plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }),
}));

const OWNER = 'owner';
const rows: DurationActualInput[] = [
  { occurrenceDate: '2026-10-26', subject: '数学', minutes: 60 },
  { occurrenceDate: '2026-10-27', subject: '英語', minutes: 45 },
  { occurrenceDate: '2026-10-28', subject: '現代文', minutes: 30 },
  { occurrenceDate: '2026-10-30', subject: '英語', minutes: 50 },
  { occurrenceDate: '2026-10-31', subject: '数学', minutes: 120 },
  { occurrenceDate: '2026-11-01', subject: '化学', minutes: 90 },
].map(row => ({ ...row, id: `wp-actual-${OWNER}-${row.occurrenceDate}-${row.subject}`, title: row.subject }));
const confirmedTotals = ['時刻なし 1時間（60分）', '時刻なし 45分', '時刻なし 30分',
  '時刻なし 50分', '時刻なし 2時間（120分）', '時刻なし 1時間30分（90分）'];
const textOf = (node: ReactTestInstance | string | number): string => typeof node === 'object'
  ? node.children.map(textOf).join('') : String(node);

it('distinguishes a pending actual save from confirmed weekly totals, rolls back a refusal, and keeps confirmed rows after acknowledgement', async () => {
  const fixture = createLocalFixture();
  const refused = deferred<DurationActual[]>();
  const acknowledge = deferred<void>();
  const committed = deferred<void>();
  const save = vi.fn<PlannerRepository['saveDurationActualsBatch']>()
    .mockImplementationOnce(() => refused.promise)
    .mockImplementationOnce(async (ownerId, records) => {
      const saved = await fixture.repository.saveDurationActualsBatch(ownerId, records);
      committed.resolve();
      await acknowledge.promise;
      return saved;
    });
  boundary.repository = { ...fixture.repository, saveDurationActualsBatch: save };
  const notice = vi.fn<ShowNotice>();
  let state: UsePlannerDataStateResult | undefined;
  let renderer: ReactTestRenderer | undefined;
  function Harness() {
    state = usePlannerDataState({ userId: OWNER, showNotice: notice });
    return <WeekView selectedDate="2026-10-26" userId={OWNER} plans={state.plans} actuals={state.actuals} onOpenDay={() => {}} />;
  }
  const totals = () => renderer!.root.findAllByProps({ className: 'week-duration-actual-total' }).map(textOf);
  const assertUnconfirmedPresentation = (phase: string) => {
    const visible = totals();
    const savingVisible = textOf(renderer!.root).includes(SAVING_ACTUAL_RECORDS_LABEL);
    // Either defer these totals, or visibly distinguish them from confirmed actuals on this screen.
    expect.soft(visible.length === 0 || savingVisible, JSON.stringify({ phase, visible, savingVisible })).toBe(true);
    expect(notice).not.toHaveBeenCalledWith('記録を保存しました。', 'success');
  };
  try {
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { await state!.loadPlannerData(OWNER); });
    const actualMode = renderer!.root.findAllByType('button').find(button => button.children.join('') === '記録');
    expect(actualMode).toBeDefined();
    act(() => actualMode!.props.onClick());
    expect(totals()).toEqual([]);
    notice.mockClear();

    let first!: Promise<void>;
    act(() => { first = state!.saveDurationActualsBatch(rows); });
    expect(save).toHaveBeenCalledOnce();
    expect(await fixture.repository.getActuals(OWNER)).toEqual([]);
    assertUnconfirmedPresentation('before commit response');

    await act(async () => {
      refused.reject(Object.assign(new Error('synthetic private rules refusal'), { code: 'permission-denied' }));
      await expect(first).rejects.toThrow('記録を保存できませんでした。');
    });
    expect(state!.actuals).toEqual([]);
    expect(totals()).toEqual([]);
    expect(await fixture.repository.getActuals(OWNER)).toEqual([]);
    expect(save).toHaveBeenCalledOnce();
    expect(notice).not.toHaveBeenCalledWith('記録を保存しました。', 'success');

    notice.mockClear();
    let second!: Promise<void>;
    await act(async () => { second = state!.saveDurationActualsBatch(rows); await committed.promise; });
    expect(save).toHaveBeenCalledTimes(2);
    const server = await fixture.repository.getActuals(OWNER);
    expect(server).toHaveLength(6);
    expect(server.reduce((sum, row) => sum + (row.actualDurationMinutes ?? 0), 0)).toBe(395);
    // The oracle can inspect the server fixture, but the UI has not received its acknowledgement.
    assertUnconfirmedPresentation('server committed, acknowledgement still withheld');

    await act(async () => { acknowledge.resolve(); await second; });
    expect(totals()).toEqual(confirmedTotals);
    expect(state!.actuals).toHaveLength(6);
    expect(new Set(state!.actuals.map(row => row.id)).size).toBe(6);
    expect(notice).toHaveBeenCalledWith('記録を保存しました。', 'success');
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    vi.restoreAllMocks();
  }
});
