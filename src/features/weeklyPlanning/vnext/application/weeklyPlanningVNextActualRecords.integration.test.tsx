// #973 I3: the VNext application offers the conversation's pending study records for confirmation and saves
// them only through approveActualRecords(). The records are seeded by a real session turn (scripted typed
// reading, no model call), so the checkpoint the hook reads is the one I2 writes. Expected values come from the
// fixed ARGON-FIRST week (2026-10-26..11-01, 395 minutes; Thursday is a rest day) and from no output.
import { forwardRef, createRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { formatActualRecordRow, formatActualRecordsTotal, sumActualRecordMinutes } from '../../application/weeklyPlanningActualRecords';

const OWNER = 'exam-owner'; const WEEK = '2026-11-02'; const TODAY = '2026-11-03'; const NOW = `${TODAY}T00:00:00.000Z`;
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: OWNER, weekStartDate: WEEK, conversationId: 'exam-conversation',
  notBeforeTime: '09:00', clock: { currentDate: TODAY, weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' } };
const rec = (dateExpression: string, subject: string, minutes: number) => ({ dateExpression, subject, minutes });
const WEEK_RECORDS = [rec('2026-10-26', '数学', 60), rec('2026-10-27', '英語', 45), rec('2026-10-28', '現代文', 30),
  rec('2026-10-30', '英語', 50), rec('2026-10-31', '数学', 120), rec('2026-11-01', '化学', 90)];
const reading = ({ add: [], patch: [], remove: [], relate: [], defer: [] });

/** Writes the conversation's checkpoint by one real turn, as the chat would before the confirmation. */
async function seedRecords(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage });
  const responses = [{ planningIntent: 'discuss', conversationActs: [], delta: reading, studyRecords: WEEK_RECORDS, studyRecordQuestion: null, answer: null }];
  const ports: WeeklyPlanningVNextExperimentalPorts = { checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => null },
    interpret: createWeeklyPlanningVNextProviderInterpreter(), client: { async createChatCompletion() { return JSON.stringify(responses.shift()); } },
    approvalLedger: { read: () => null, write: () => undefined },
    plans: { findExistingPlanId: async () => undefined, async saveBlock(block) { return { planId: `plan:${block.id}` }; } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => NOW,
    createRenderer: () => ({ async render() { return { status: 'rendered', text: '合成の返信', rawResponse: '' }; } }) };
  const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText: '先週の勉強を記録したい', turnId: 'seed-1', shownRevision: null });
  expect(result.actualRecords).toHaveLength(6);
  return local;
}

const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services);
  useImperativeHandle(ref, () => app, [app]);
  return null;
});

describe('VNext application: study records waiting for confirmation (#973)', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>;
  let restore: () => void;
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => {
    storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });
  afterEach(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest(); restore();
  });

  const services = (): WeeklyPlanningVNextLocalApplicationServices => ({ storage: storage.storage, client: () => ({} as never),
    interpret: () => async () => { throw new Error('no provider turn in this test'); }, now: () => NOW,
    createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '', rawResponse: '' }) }) });
  const inputWith = (saveWeeklyActualRecords?: UseWeeklyPlanningApplicationInput['saveWeeklyActualRecords'], userId: string | null = OWNER): UseWeeklyPlanningApplicationInput =>
    ({ userId, selectedDate: WEEK, plans: [], scheduleTemplates: [], plannerDataAvailability: createReadyPlannerDataAvailability(OWNER),
      isPlannerDataSnapshotCurrent: () => true, saveWeeklyApprovedPlan: vi.fn(), saveWeeklyActualRecords });
  async function mount(input: UseWeeklyPlanningApplicationInput) {
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={ref} input={input} services={services()} />); });
    return ref;
  }
  // The chat owns its own checkpoint slot (the seeded week slot is copied into it on first load).
  const storedStatuses = (ref: { current: WeeklyPlanningApplication | null }) =>
    createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: ref.current!.chat.index.activeChatId })
      .readCheckpoint()!.vnext.actualRecords!.map(record => record.status);


  it('offers no records and never calls the save port when the conversation proposed none', async () => {
    const save = vi.fn(() => Promise.resolve());
    const ref = await mount(inputWith(save));
    expect(ref.current!.pendingActualRecords).toEqual([]);
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(save).not.toHaveBeenCalled();
  });

  it('lists the six pending records with the 395-minute total and saves nothing before approval', async () => {
    await seedRecords(storage.storage);
    const save = vi.fn(() => Promise.resolve());
    const ref = await mount(inputWith(save));
    const pending = ref.current!.pendingActualRecords!;
    expect(pending.map(formatActualRecordRow)).toEqual(['月 10/26 数学 60分（1時間）', '火 10/27 英語 45分', '水 10/28 現代文 30分',
      '金 10/30 英語 50分', '土 10/31 数学 120分（2時間）', '日 11/1 化学 90分（1時間30分）']);
    expect(formatActualRecordsTotal(sumActualRecordMinutes(pending))).toBe('6時間35分（395分）');
    expect(save).not.toHaveBeenCalled();
  });

  it('saves the whole batch once for the owner, marks it saved and does not offer it again after a reload', async () => {
    await seedRecords(storage.storage);
    const save = vi.fn(() => Promise.resolve());
    const ref = await mount(inputWith(save));
    await act(async () => { await Promise.all([ref.current!.approveActualRecords!(), ref.current!.approveActualRecords!()]); });
    expect(save).toHaveBeenCalledOnce();
    const [userId, records] = save.mock.calls[0] as unknown as [string, Array<Record<string, unknown>>];
    expect(userId).toBe(OWNER);
    expect(records).toHaveLength(6);
    // A record is exactly an id, a date, a subject and minutes: no clock time and no status leaves the application.
    expect(records.map(record => Object.keys(record).sort())).toEqual(Array(6).fill(['id', 'minutes', 'occurrenceDate', 'subject']));
    expect(ref.current!.pendingActualRecords).toEqual([]);
    expect(storedStatuses(ref)).toEqual(Array(6).fill('saved'));
    await act(async () => renderer!.unmount()); renderer = undefined;
    const reloaded = await mount(inputWith(save));
    expect(reloaded.current!.pendingActualRecords).toEqual([]);
    await act(async () => { await reloaded.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledOnce();
  });

  it('keeps every record pending after a failed save and a retry saves the same batch', async () => {
    await seedRecords(storage.storage);
    const save = vi.fn().mockRejectedValueOnce(new Error('学習実績を保存できませんでした。保存はされていません。')).mockResolvedValue(undefined);
    const ref = await mount(inputWith(save));
    await act(async () => { await expect(ref.current!.approveActualRecords!()).rejects.toThrow('保存はされていません'); });
    expect(ref.current!.pendingActualRecords).toHaveLength(6);
    expect(storedStatuses(ref)).toEqual(Array(6).fill('pending'));
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1]);
    expect(ref.current!.pendingActualRecords).toEqual([]);
  });

  it('writes nothing without a signed-in owner or without a save port', async () => {
    await seedRecords(storage.storage);
    const save = vi.fn(() => Promise.resolve());
    const signedOut = await mount(inputWith(save, null));
    await act(async () => { await signedOut.current!.approveActualRecords!(); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => renderer!.unmount()); renderer = undefined;
    const noPort = await mount(inputWith(undefined));
    await act(async () => { await noPort.current!.approveActualRecords!(); });
    expect(storedStatuses(noPort)).toEqual(Array(6).fill('pending'));
  });
});
