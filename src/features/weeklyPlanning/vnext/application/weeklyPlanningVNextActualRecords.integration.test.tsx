// #973 I3: the VNext application offers the conversation's pending study records for confirmation and saves
// them only through approveActualRecords(). The records are seeded by a real session turn (scripted typed
// reading, no model call), so the checkpoint the hook reads is the one I2 writes. Expected values come from the
// fixed ARGON-FIRST week (2026-10-26..11-01, 395 minutes; Thursday is a rest day) and from no output.
import { forwardRef, createRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, createWeeklyPlanningTestDraftBlock, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { DurationActual } from '../../../../types/domain';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { formatActualRecordRow, formatActualRecordsTotal, formatAlreadySavedActualRecordsReply, sumActualRecordMinutes,
  type PendingWeeklyPlanningActualRecord } from '../../application/weeklyPlanningActualRecords';
import { VNEXT_STUDY_RECORD_SAVE_GUIDE, VNEXT_STUDY_RECORD_UNCHANGED } from '../weeklyPlanningVNextStudyRecords';
import { readAndClassifyActualSave } from '../weeklyPlanningVNextActualSaveReadback';
import { ActualSaveReadbackUnknownError } from '../../../../domain/actualSaveReadback';

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
  async function mount(input: UseWeeklyPlanningApplicationInput, overrides: Partial<WeeklyPlanningVNextLocalApplicationServices> = {}) {
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={ref} input={input} services={{ ...services(), ...overrides }} />); });
    return ref;
  }
  // The chat owns its own checkpoint slot (the seeded week slot is copied into it on first load).
  const storedStatuses = (ref: { current: WeeklyPlanningApplication | null }) =>
    createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: ref.current!.chat.index.activeChatId })
      .readCheckpoint()!.vnext.actualRecords!.map(record => record.status);

  async function reloadUnansweredSave(save: NonNullable<UseWeeklyPlanningApplicationInput['saveWeeklyActualRecords']> =
    vi.fn(() => new Promise<void>(() => undefined))) {
    await seedRecords(storage.storage);
    const first = await mount(inputWith(save));
    const records = first.current!.pendingActualRecords!;
    act(() => { void first.current!.approveActualRecords!(); });
    const chatId = first.current!.chat.index.activeChatId;
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    return { records, save, chatId };
  }
  const attemptInUi = (chatId: string) => JSON.parse(storage.storage.getItem(
    `studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.ui`)!).actualSaveAttempt;


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
    const savedUi = storage.storage.getItem(`studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${ref.current!.chat.index.activeChatId}.ui`)!;
    expect(JSON.parse(savedUi)).not.toHaveProperty('actualSaveAttempt');
    await act(async () => renderer!.unmount()); renderer = undefined;
    const reloaded = await mount(inputWith(save));
    expect(reloaded.current!.pendingActualRecords).toEqual([]);
    await act(async () => { await reloaded.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledOnce();
  });

  it('offers a changed minute value for replacement in the same mount and saves it under the same document id', async () => {
    await seedRecords(storage.storage);
    const documents = new Map<string, PendingWeeklyPlanningActualRecord>();
    const save = vi.fn(async (_ownerId: string, records: PendingWeeklyPlanningActualRecord[]) => {
      for (const record of records) documents.set(record.id, record);
    });
    const sharedServices: WeeklyPlanningVNextLocalApplicationServices = { ...services(), interpret: () => async () => ({
      status: 'interpreted' as const, planningIntent: 'discuss' as const, answer: null, conversationActs: [],
      studyRecords: [rec('2026-10-27', '英語', 50)], studyRecordQuestion: null,
      delta: { add: [], patch: [], remove: [], relate: [], defer: [] }, metrics: { calls: 1, repairs: 0, latencyMs: 1 },
    }) };
    const ref = createRef<WeeklyPlanningApplication>();
    const initial = inputWith(save);
    await act(async () => { renderer = create(<Harness ref={ref} input={initial} services={sharedServices} />); });
    const firstIds = ref.current!.pendingActualRecords!.map(record => record.id);
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(documents.size).toBe(6);
    expect(ref.current!.pendingActualRecords).toEqual([]);

    // The planner publishes the saved documents without remounting the conversation.
    const loaded = { ...initial, actuals: [...documents.values()].map(record =>
      savedDoc(record.id, record.subject, record.occurrenceDate, record.minutes)) };
    await act(async () => { renderer!.update(<Harness ref={ref} input={loaded} services={sharedServices} />); });
    await act(async () => { await ref.current!.submitTurn('火曜の英語は50分でした。'); });
    const correction = ref.current!.pendingActualRecords!;
    expect(correction).toHaveLength(1);
    expect(correction[0]).toMatchObject({ id: firstIds[1], minutes: 50, replacesMinutes: 45 });
    expect(formatActualRecordRow(correction[0])).toBe('火 10/27 英語 50分 ※保存済みの45分を置き換えます');
    expect(storedStatuses(ref)[1]).toBe('pending');

    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toEqual([{ id: firstIds[1], occurrenceDate: '2026-10-27', subject: '英語', minutes: 50 }]);
    expect(documents.size).toBe(6);
    expect(documents.get(firstIds[1])?.minutes).toBe(50);
    expect(ref.current!.pendingActualRecords).toEqual([]);
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

  it.each([
    { result: 'saved', reply: '保存を確認しました', pending: 0 },
    { result: 'not_saved', reply: 'サーバー上に保存されていません', pending: 6 },
    { result: 'partial', reply: '未保存の記録', pending: 3 },
    { result: 'unknown', reply: 'サーバーに接続できないため', pending: 6 },
    { result: 'permission_denied', reply: '読取権限がないため', pending: 6 },
  ] as const)('retains a post-commit rejection for server readback ($result)', async ({ result, reply, pending }) => {
    await seedRecords(storage.storage);
    const server = new Map<string, PendingWeeklyPlanningActualRecord>();
    let writes = 0;
    const save = vi.fn(async (_owner: string, records: readonly PendingWeeklyPlanningActualRecord[]) => {
      writes += 1;
      for (const record of records) server.set(record.id, record);
      if (writes === 1) throw new Error('client scope expired after server commit');
    });
    const first = await mount(inputWith(save));
    const original = first.current!.pendingActualRecords!;
    const originalIds = original.map(record => record.id);
    await act(async () => { await expect(first.current!.approveActualRecords!()).rejects.toThrow('client scope expired'); });
    expect(server.size).toBe(6);
    const chatId = first.current!.chat.index.activeChatId;
    expect(attemptInUi(chatId), 'a rejected client promise does not prove the server write failed').toEqual({
      attemptedAt: NOW, records: original.map(({ id, minutes }) => ({ id, minutes })),
    });

    if (result === 'not_saved') server.clear();
    if (result === 'partial') for (const id of originalIds.slice(3)) server.delete(id);
    const readActualSave = vi.fn((ownerId: string, attempted: Parameters<typeof readAndClassifyActualSave>[0]['attempted']) => {
      if (result === 'unknown' || result === 'permission_denied') return Promise.reject(new ActualSaveReadbackUnknownError(result === 'unknown'
        ? 'unavailable' : 'permission_denied'));
      return readAndClassifyActualSave({ ownerId, attempted, readConfirmed: async () => ({
        fromCache: false, hasPendingWrites: false,
        records: [...server.values()].map(record => savedDoc(record.id, record.subject, record.occurrenceDate, record.minutes)),
      }) });
    });
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    const reloaded = await mount(inputWith(save), { readActualSave });
    await act(async () => { await vi.waitFor(() => expect(reloaded.current!.state.messages.some(message =>
      message.content.includes(reply))).toBe(true)); });
    expect(readActualSave).toHaveBeenCalledOnce();
    expect(reloaded.current!.pendingActualRecords).toHaveLength(pending);
    expect(writes, 'server readback never resends by itself').toBe(1);
    if (result === 'saved') {
      expect(storedStatuses(reloaded)).toEqual(Array(6).fill('saved'));
      expect(attemptInUi(chatId)).toBeUndefined();
      expect([...server.keys()].sort()).toEqual([...originalIds].sort());
    } else {
      expect(attemptInUi(chatId)).toBeDefined();
      await act(async () => { await reloaded.current!.approveActualRecords!(); });
      expect(writes).toBe(result === 'not_saved' ? 2 : 1);
      if (result === 'not_saved') {
        expect([...server.keys()].sort()).toEqual([...originalIds].sort());
        expect(storedStatuses(reloaded)).toEqual(Array(6).fill('saved'));
      } else {
        expect(reloaded.current!.pendingActualRecords).toHaveLength(pending);
      }
    }
  });

  it('keeps an optimistic batch unconfirmed through a resend, then marks it saved only when the port resolves', async () => {
    await seedRecords(storage.storage);
    let resolveSave!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { resolveSave = resolve; }));
    const resend: WeeklyPlanningVNextLocalApplicationServices = { ...services(), interpret: () => async () => ({ status: 'interpreted' as const,
      planningIntent: 'discuss' as const, answer: null, conversationActs: [], studyRecords: WEEK_RECORDS, studyRecordQuestion: null,
      delta: { add: [], patch: [], remove: [], relate: [], defer: [] }, metrics: { calls: 1, repairs: 0, latencyMs: 1 } }) };
    const ref = createRef<WeeklyPlanningApplication>();
    const initial = inputWith(save);
    await act(async () => { renderer = create(<Harness ref={ref} input={initial} services={resend} />); });
    const original = ref.current!.pendingActualRecords!;
    const ids = original.map(record => record.id);
    let saving!: Promise<void>;
    act(() => { saving = ref.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledOnce();
    expect(storedStatuses(ref)).toEqual(Array(6).fill('pending'));

    // usePlannerDataState has already published its optimistic rows, while its save port still waits.
    const optimistic = { ...initial, actuals: original.map(record => savedDoc(record.id, record.subject, record.occurrenceDate, record.minutes)) };
    await act(async () => { renderer!.update(<Harness ref={ref} input={optimistic} services={resend} />); });
    expect(ref.current!.pendingActualRecords!.map(record => record.id)).toEqual(ids);
    await act(async () => { await ref.current!.submitTurn('先週の同じ勉強を記録しました。'); });
    const inFlightReply = ref.current!.state.messages[ref.current!.state.messages.length - 1]?.content;
    expect(inFlightReply).toBe(`${VNEXT_STUDY_RECORD_UNCHANGED}ここまでの合計は6時間35分（395分）です。${VNEXT_STUDY_RECORD_SAVE_GUIDE}`);
    expect(inFlightReply).not.toContain('すでに保存されています');
    expect(ref.current!.pendingActualRecords!.map(record => record.id)).toEqual(ids);
    expect(storedStatuses(ref)).toEqual(Array(6).fill('pending'));

    await act(async () => { resolveSave(); await saving; });
    expect(ref.current!.pendingActualRecords).toEqual([]);
    expect(storedStatuses(ref)).toEqual(Array(6).fill('saved'));
    await act(async () => { await ref.current!.submitTurn('先週の同じ勉強を記録しました。'); });
    expect(ref.current!.state.messages[ref.current!.state.messages.length - 1]?.content).toBe(formatAlreadySavedActualRecordsReply(original));
    expect(storedStatuses(ref)).toEqual(Array(6).fill('saved'));
    const finalRecords = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage,
      chatId: ref.current!.chat.index.activeChatId }).readCheckpoint()!.vnext.actualRecords!;
    expect(finalRecords.map(record => record.id)).toEqual(ids);
    expect(new Set(finalRecords.map(record => record.id)).size).toBe(6);
    expect(save).toHaveBeenCalledOnce();
  });

  it('remembers an unanswered save across reload and explains that its result still needs checking', async () => {
    await seedRecords(storage.storage);
    const save = vi.fn(() => new Promise<void>(() => undefined));
    const first = await mount(inputWith(save));
    const ids = first.current!.pendingActualRecords!.map(record => record.id);
    act(() => { void first.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledOnce();
    expect(storedStatuses(first)).toEqual(Array(6).fill('pending'));
    const chatId = first.current!.chat.index.activeChatId;
    const uiKey = `studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.ui`;
    const coreKey = `studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.core`;
    const ui = JSON.parse(storage.storage.getItem(uiKey)!);
    const sent = (save.mock.calls[0] as unknown as [string, Array<{ id: string; minutes: number }>])[1];
    expect(ui.actualSaveAttempt).toEqual({ attemptedAt: NOW,
      records: sent.map(({ id, minutes }) => ({ id, minutes })) });
    expect(storage.storage.getItem(coreKey)).not.toContain('"actualSaveAttempt"');

    // Reload while the SDK save promise has neither resolved nor rejected. No saved documents are loaded.
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    const reloaded = await mount(inputWith(save));
    expect(reloaded.current!.pendingActualRecords!.map(record => record.id)).toEqual(ids);
    expect(save).toHaveBeenCalledOnce();
    const lastingReplies = reloaded.current!.state.messages.filter(message => message.role === 'assistant').map(message => message.content);
    expect(lastingReplies.some(reply => reply.includes('保存結果を確認できていません'))).toBe(true);
  });

  it.each([
    { kind: 'saved', expected: '保存を確認しました', statuses: ['saved', 'saved', 'saved', 'saved', 'saved', 'saved'] },
    { kind: 'not_saved', expected: 'サーバー上に保存されていません', statuses: ['pending', 'pending', 'pending', 'pending', 'pending', 'pending'] },
    { kind: 'partial', expected: '未保存の記録', statuses: ['saved', 'saved', 'saved', 'pending', 'pending', 'pending'] },
    { kind: 'conflicting', expected: '保存済みの値が異なる記録', statuses: ['saved', 'saved', 'saved', 'saved', 'saved', 'pending'] },
  ])('reads an unanswered $kind batch once after reload without saving it again', async ({ kind, expected, statuses }) => {
    const { records, save, chatId } = await reloadUnansweredSave();
    const matching = records.map(record => savedDoc(record.id, record.subject, record.occurrenceDate, record.minutes));
    const rows = kind === 'saved' ? matching : kind === 'not_saved' ? [] : kind === 'partial' ? matching.slice(0, 3)
      : matching.map((row, index) => index === 5 ? { ...row, actualDurationMinutes: row.actualDurationMinutes + 1 } : row);
    const readConfirmed = vi.fn(async () => ({ fromCache: false, hasPendingWrites: false, records: rows }));
    const readActualSave = vi.fn((ownerId: string, attempted: Parameters<typeof readAndClassifyActualSave>[0]['attempted']) =>
      readAndClassifyActualSave({ ownerId, attempted, readConfirmed }));
    const reloaded = await mount(inputWith(save), { readActualSave });
    await act(async () => { await vi.waitFor(() => expect(reloaded.current!.state.messages.some(message => message.content.includes(expected))).toBe(true)); });
    expect(readActualSave).toHaveBeenCalledOnce();
    expect(readConfirmed).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(storedStatuses(reloaded)).toEqual(statuses);
    expect(reloaded.current!.pendingActualRecords).toHaveLength(statuses.filter(status => status === 'pending').length);
    expect(attemptInUi(chatId) === undefined).toBe(kind === 'saved');
    const lastingUi = JSON.parse(storage.storage.getItem(`studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.ui`)!);
    expect(lastingUi.payload.state.messages.some((message: { content: string }) => message.content.includes(expected))).toBe(true);
    expect(storage.storage.getItem(`studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.core`)).not.toContain('actualSaveAttempt');
  });

  it.each([
    { reason: 'unavailable', text: 'サーバーに接続できないため' },
    { reason: 'permission_denied', text: '読取権限がないため' },
    { reason: 'auth_mismatch', text: '認証された利用者が一致しないため' },
    { reason: 'unconfirmed_snapshot', text: '保存結果を確認できていません' },
  ] as const)('keeps $reason unknown after reload, including optimistic planner rows', async ({ reason, text }) => {
    const { records, save, chatId } = await reloadUnansweredSave();
    const readActualSave = vi.fn(async () => { throw new ActualSaveReadbackUnknownError(reason); });
    const optimistic = { ...inputWith(save), actuals: records.map(record =>
      savedDoc(record.id, record.subject, record.occurrenceDate, record.minutes)) };
    const reloaded = await mount(optimistic, { readActualSave });
    await act(async () => { await vi.waitFor(() => expect(reloaded.current!.state.messages.some(message => message.content.includes(text))).toBe(true)); });
    expect(readActualSave).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(storedStatuses(reloaded)).toEqual(Array(6).fill('pending'));
    expect(reloaded.current!.pendingActualRecords).toHaveLength(6);
    expect(attemptInUi(chatId)).toBeDefined();
    const lastingUi = JSON.parse(storage.storage.getItem(`studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.ui`)!);
    expect(lastingUi.payload.state.messages.some((message: { content: string }) => message.content.includes(text))).toBe(true);
  });

  it('keeps the later permission reason in history when a second reload follows an offline read', async () => {
    const { save, chatId } = await reloadUnansweredSave();
    const firstRead = vi.fn(async () => { throw new ActualSaveReadbackUnknownError('unavailable'); });
    const offline = await mount(inputWith(save), { readActualSave: firstRead });
    await act(async () => { await vi.waitFor(() => expect(offline.current!.state.messages.some(message =>
      message.content.includes('サーバーに接続できないため'))).toBe(true)); });
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    const secondRead = vi.fn(async () => { throw new ActualSaveReadbackUnknownError('permission_denied'); });
    const denied = await mount(inputWith(save), { readActualSave: secondRead });
    await act(async () => { await vi.waitFor(() => expect(denied.current!.state.messages.some(message =>
      message.content.includes('読取権限がないため'))).toBe(true)); });
    expect(firstRead).toHaveBeenCalledOnce();
    expect(secondRead).toHaveBeenCalledOnce();
    expect(denied.current!.state.messages.some(message => message.content.includes('サーバーに接続できないため'))).toBe(true);
    expect(attemptInUi(chatId)).toBeDefined();
    expect(save).toHaveBeenCalledOnce();
  });

  it('does not turn an unapproved planning draft into a saved plan during actual readback', async () => {
    const { save, chatId } = await reloadUnansweredSave();
    const uiKey = `studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.ui`;
    const ui = JSON.parse(storage.storage.getItem(uiKey)!);
    ui.payload.state.draftBlocks = [createWeeklyPlanningTestDraftBlock({ id: 'unapproved-plan', userId: OWNER,
      overrides: { date: TODAY } })];
    storage.storage.setItem(uiKey, JSON.stringify(ui));
    const input = inputWith(save);
    const readActualSave: NonNullable<WeeklyPlanningVNextLocalApplicationServices['readActualSave']> = async (_owner, attempted) => ({
      status: 'saved', confirmedIds: attempted.map(record => record.id), unconfirmedRecords: [], conflictingIds: [],
    });
    const reloaded = await mount(input, { readActualSave });
    await act(async () => { await vi.waitFor(() => expect(reloaded.current!.state.messages.some(message =>
      message.content.includes('保存を確認しました'))).toBe(true)); });
    expect(reloaded.current!.pendingDraftBlocks).toMatchObject([{ id: 'unapproved-plan', status: 'draft' }]);
    expect(input.saveWeeklyApprovedPlan).not.toHaveBeenCalled();
  });

  it('never reads an old owner’s attempt after the signed-in owner changes', async () => {
    const { save } = await reloadUnansweredSave();
    const readActualSave = vi.fn(async () => { throw new Error('wrong owner was read'); });
    const foreign = await mount(inputWith(save, 'other-owner'), { readActualSave });
    await act(async () => { await foreign.current!.approveActualRecords!(); });
    expect(readActualSave).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
  });

  it('retries a server-confirmed absent batch only after the user clicks, with the same six IDs and one write', async () => {
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(() => undefined)).mockResolvedValue(undefined);
    const { records, chatId } = await reloadUnansweredSave(save);
    const readActualSave: NonNullable<WeeklyPlanningVNextLocalApplicationServices['readActualSave']> = (ownerId, attempted) =>
      readAndClassifyActualSave({ ownerId, attempted, readConfirmed: async () => ({
        fromCache: false, hasPendingWrites: false, records: [],
      }) });
    const reloaded = await mount(inputWith(save), { readActualSave });
    await act(async () => { await vi.waitFor(() => expect(reloaded.current!.state.messages.some(message =>
      message.content.includes('サーバー上に保存されていません'))).toBe(true)); });
    expect(save).toHaveBeenCalledOnce();
    expect(storedStatuses(reloaded)).toEqual(Array(6).fill('pending'));
    await act(async () => { await Promise.all([reloaded.current!.approveActualRecords!(), reloaded.current!.approveActualRecords!()]); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1]);
    expect((save.mock.calls[1][1] as PendingWeeklyPlanningActualRecord[]).map(record => record.id)).toEqual(records.map(record => record.id));
    expect(reloaded.current!.pendingActualRecords).toEqual([]);
    expect(attemptInUi(chatId)).toBeUndefined();
    expect(reloaded.current!.state.messages.some(message => message.content.includes('保存しました'))).toBe(true);
    await act(async () => { await reloaded.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it.each([
    { kind: 'saved', expected: '保存を確認しました' },
    { kind: 'partial', expected: '未保存の記録' },
    { kind: 'conflicting', expected: '保存済みの値が異なる記録' },
    { kind: 'unknown', expected: 'サーバーに接続できないため' },
    { kind: 'permission', expected: '読取権限がないため' },
    { kind: 'auth', expected: '認証された利用者が一致しないため' },
  ])('never retries $kind when the user clicks the remaining records', async ({ kind, expected }) => {
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(() => undefined)).mockResolvedValue(undefined);
    const { records } = await reloadUnansweredSave(save);
    const matching = records.map(record => savedDoc(record.id, record.subject, record.occurrenceDate, record.minutes));
    const rows = kind === 'saved' ? matching : kind === 'partial' ? matching.slice(0, 3)
      : matching.map((row, index) => index === 5 ? { ...row, actualDurationMinutes: row.actualDurationMinutes + 1 } : row);
    const readActualSave: NonNullable<WeeklyPlanningVNextLocalApplicationServices['readActualSave']> = (ownerId, attempted) => {
      if (kind === 'unknown' || kind === 'permission' || kind === 'auth') return Promise.reject(new ActualSaveReadbackUnknownError(
        kind === 'unknown' ? 'unavailable' : kind === 'permission' ? 'permission_denied' : 'auth_mismatch'));
      return readAndClassifyActualSave({ ownerId, attempted, readConfirmed: async () => ({
        fromCache: false, hasPendingWrites: false, records: rows,
      }) });
    };
    const reloaded = await mount(inputWith(save), { readActualSave });
    await act(async () => { await vi.waitFor(() => expect(reloaded.current!.state.messages.some(message =>
      message.content.includes(expected))).toBe(true)); });
    await act(async () => { await reloaded.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledOnce();
  });

  it('records a rejected retry without claiming a server commit outcome and leaves every row pending', async () => {
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockRejectedValueOnce(new Error('write rejected'));
    await reloadUnansweredSave(save);
    const readActualSave: NonNullable<WeeklyPlanningVNextLocalApplicationServices['readActualSave']> = (ownerId, attempted) =>
      readAndClassifyActualSave({ ownerId, attempted, readConfirmed: async () => ({
        fromCache: false, hasPendingWrites: false, records: [],
      }) });
    const reloaded = await mount(inputWith(save), { readActualSave });
    await act(async () => { await vi.waitFor(() => expect(reloaded.current!.state.messages.some(message =>
      message.content.includes('サーバー上に保存されていません'))).toBe(true)); });
    await act(async () => { await expect(reloaded.current!.approveActualRecords!()).rejects.toThrow('write rejected'); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(storedStatuses(reloaded)).toEqual(Array(6).fill('pending'));
    expect(reloaded.current!.state.messages.some(message => message.content.includes('保存処理が失敗しました。保存結果を確認できていません'))).toBe(true);
  });

  it('keeps a second unanswered attempt unknown through another reload without a third write', async () => {
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockImplementationOnce(() => new Promise<void>(() => undefined));
    const { chatId } = await reloadUnansweredSave(save);
    const readActualSave: NonNullable<WeeklyPlanningVNextLocalApplicationServices['readActualSave']> = (ownerId, attempted) =>
      readAndClassifyActualSave({ ownerId, attempted, readConfirmed: async () => ({
        fromCache: false, hasPendingWrites: false, records: [],
      }) });
    const reloaded = await mount(inputWith(save), { readActualSave });
    await act(async () => { await vi.waitFor(() => expect(reloaded.current!.state.messages.some(message =>
      message.content.includes('サーバー上に保存されていません'))).toBe(true)); });
    act(() => { void reloaded.current!.approveActualRecords!(); });
    await act(async () => { await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2)); });
    expect(attemptInUi(chatId)).toBeDefined();
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    const again = await mount(inputWith(save));
    expect(again.current!.state.messages.some(message => message.content.includes('保存結果を確認できていません'))).toBe(true);
    expect(storedStatuses(again)).toEqual(Array(6).fill('pending'));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it.each(['partial', 'auth_mismatch'] as const)('stops a retry if the server or auth changes to $0 before the click writes', async change => {
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(() => undefined)).mockResolvedValue(undefined);
    const { records } = await reloadUnansweredSave(save);
    const readActualSave = vi.fn(async (ownerId: string, attempted: Parameters<typeof readAndClassifyActualSave>[0]['attempted']) => {
      if (readActualSave.mock.calls.length > 1) {
        if (change === 'auth_mismatch') throw new ActualSaveReadbackUnknownError('auth_mismatch');
        const record = records[0];
        return readAndClassifyActualSave({ ownerId, attempted, readConfirmed: async () => ({ fromCache: false,
          hasPendingWrites: false, records: [savedDoc(record.id, record.subject, record.occurrenceDate, record.minutes)] }) });
      }
      return readAndClassifyActualSave({ ownerId, attempted, readConfirmed: async () => ({
        fromCache: false, hasPendingWrites: false, records: [],
      }) });
    });
    const reloaded = await mount(inputWith(save), { readActualSave });
    await act(async () => { await vi.waitFor(() => expect(reloaded.current!.state.messages.some(message =>
      message.content.includes('サーバー上に保存されていません'))).toBe(true)); });
    await act(async () => { await reloaded.current!.approveActualRecords!(); });
    expect(readActualSave).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledOnce();
    expect(reloaded.current!.state.messages.some(message => message.content.includes(change === 'partial'
      ? '再送していません' : '認証された利用者が一致しないため'))).toBe(true);
  });

  it('keeps the same pending batch when an in-flight save rejects after optimistic rows appeared', async () => {
    await seedRecords(storage.storage);
    let rejectSave!: (error: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; })).mockResolvedValue(undefined);
    const sharedServices = services();
    const ref = createRef<WeeklyPlanningApplication>();
    const initial = inputWith(save);
    await act(async () => { renderer = create(<Harness ref={ref} input={initial} services={sharedServices} />); });
    const original = ref.current!.pendingActualRecords!;
    let saving!: Promise<void>;
    act(() => { saving = ref.current!.approveActualRecords!(); });
    const optimistic = { ...initial, actuals: original.map(record => savedDoc(record.id, record.subject, record.occurrenceDate, record.minutes)) };
    await act(async () => { renderer!.update(<Harness ref={ref} input={optimistic} services={sharedServices} />); });
    expect(ref.current!.pendingActualRecords!.map(record => record.id)).toEqual(original.map(record => record.id));
    await act(async () => { rejectSave(new Error('保存はされていません')); await expect(saving).rejects.toThrow('保存はされていません'); });
    const rejectedUi = storage.storage.getItem(`studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${ref.current!.chat.index.activeChatId}.ui`)!;
    expect(JSON.parse(rejectedUi)).not.toHaveProperty('actualSaveAttempt');
    await act(async () => { renderer!.update(<Harness ref={ref} input={initial} services={sharedServices} />); });
    expect(storedStatuses(ref)).toEqual(Array(6).fill('pending'));
    expect(ref.current!.pendingActualRecords!.map(record => record.id)).toEqual(original.map(record => record.id));
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1]);
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
  // The same statement sent again after the records were saved and the page reloaded.
  it('a reload and the same statement again keep the saved records saved (same ids, nothing new to confirm)', async () => {
    await seedRecords(storage.storage);
    const save = vi.fn(() => Promise.resolve());
    const resend: WeeklyPlanningVNextLocalApplicationServices = { ...services(), interpret: () => async () => ({ status: 'interpreted' as const,
      planningIntent: 'discuss' as const, answer: null, conversationActs: [], studyRecords: WEEK_RECORDS, studyRecordQuestion: null,
      delta: { add: [], patch: [], remove: [], relate: [], defer: [] }, metrics: { calls: 1, repairs: 0, latencyMs: 1 } }) };
    const first = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={first} input={inputWith(save)} services={resend} />); });
    const before = first.current!.pendingActualRecords!.map(record => record.id);
    await act(async () => { await first.current!.approveActualRecords!(); });
    await act(async () => renderer!.unmount()); renderer = undefined;
    const second = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={second} input={inputWith(save)} services={resend} />); });
    await act(async () => { await second.current!.submitTurn('月曜は数学60分、火曜は英語45分、…でした。'); });
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: second.current!.chat.index.activeChatId });
    const stored = local.readCheckpoint()!;
    expect(second.current!.pendingActualRecords).toEqual([]);
    expect(stored.vnext.actualRecords!.map(record => record.id)).toEqual(before);
    expect(stored.vnext.actualRecords!.map(record => record.status)).toEqual(Array(6).fill('saved'));
    // fix-03: records saved before the reload are said to be saved (not "not saved yet" and not "already in the list").
    const reply = second.current!.state.messages[second.current!.state.messages.length - 1]?.content;
    expect(reply).toBe(formatAlreadySavedActualRecordsReply(stored.vnext.actualRecords!));
    expect(reply).not.toContain('まだ保存していません');
  });
  // What is already saved decides, by document id, whether a record is new, a no-op or a replacement (#973 fix-02).
  const savedDoc = (id: string, subject: string, occurrenceDate: string, minutes: number): DurationActual => ({
    id, userId: OWNER, planId: null, occurrenceDate, subject, title: subject, note: '', updatedAt: NOW, actualDurationMinutes: minutes });

  it('does not offer a record again when the same minutes are already saved under its id', async () => {
    await seedRecords(storage.storage);
    const save = vi.fn(() => Promise.resolve());
    const probe = await mount(inputWith(save));
    const pending = probe.current!.pendingActualRecords!;
    await act(async () => renderer!.unmount()); renderer = undefined;
    const input = { ...inputWith(save), actuals: pending.map(record => savedDoc(record.id, record.subject, record.occurrenceDate, record.minutes)) };
    const ref = await mount(input);
    expect(ref.current!.pendingActualRecords).toEqual([]);
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(save).not.toHaveBeenCalled();
  });

  it('shows a different saved value as a replacement, saves nothing before the click, and sends no note to the save port', async () => {
    await seedRecords(storage.storage);
    const save = vi.fn(() => Promise.resolve());
    const probe = await mount(inputWith(save));
    const pending = probe.current!.pendingActualRecords!;
    await act(async () => renderer!.unmount()); renderer = undefined;
    const tuesday = pending.find(record => record.occurrenceDate === '2026-10-27')!;
    const ref = await mount({ ...inputWith(save), actuals: [savedDoc(tuesday.id, tuesday.subject, tuesday.occurrenceDate, 30)] });
    const rows = ref.current!.pendingActualRecords!.map(formatActualRecordRow);
    expect(rows).toHaveLength(6);
    expect(rows[1]).toBe('火 10/27 英語 45分 ※保存済みの30分を置き換えます');
    expect(rows.filter(row => row.includes('置き換えます'))).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await ref.current!.approveActualRecords!(); });
    const sent = (save.mock.calls[0] as unknown as [string, Array<Record<string, unknown>>])[1];
    expect(sent).toHaveLength(6);
    expect(sent.every(record => !('replacesMinutes' in record))).toBe(true);
  });
  // Another week's conversation (a reload opens today's week) sends the same statement: same ids, so never a second document.
  it('the same statement from another conversation yields the same ids: saved minutes are a no-op, changed minutes an announced replacement', async () => {
    await seedRecords(storage.storage);
    const save = vi.fn(() => Promise.resolve());
    const first = await mount(inputWith(save));
    const originalIds = first.current!.pendingActualRecords!.map(record => record.id);
    await act(async () => renderer!.unmount()); renderer = undefined;
    const resend: WeeklyPlanningVNextLocalApplicationServices = { ...services(), interpret: () => async () => ({ status: 'interpreted' as const,
      planningIntent: 'discuss' as const, answer: null, conversationActs: [], studyRecords: WEEK_RECORDS, studyRecordQuestion: null,
      delta: { add: [], patch: [], remove: [], relate: [], defer: [] }, metrics: { calls: 1, repairs: 0, latencyMs: 1 } }) };
    const otherWeek = (actuals: DurationActual[]) => ({ ...inputWith(save), selectedDate: '2026-11-09', actuals });
    const mountOther = async (actuals: DurationActual[]) => {
      const ref = createRef<WeeklyPlanningApplication>();
      await act(async () => { renderer = create(<Harness ref={ref} input={otherWeek(actuals)} services={resend} />); });
      await act(async () => { await ref.current!.submitTurn('月曜は数学60分、火曜は英語45分、…でした。'); });
      return ref;
    };
    const rowsOf = (records: typeof WEEK_RECORDS) => records.map(record => `${record.dateExpression}|${record.subject}|${record.minutes}`);
    const saved = (minutesByIndex: (index: number) => number) => originalIds.map((id, index) =>
      savedDoc(id, WEEK_RECORDS[index].subject, WEEK_RECORDS[index].dateExpression, minutesByIndex(index)));
    expect(rowsOf(WEEK_RECORDS)).toHaveLength(6);

    // Nothing saved yet: a different conversation proposes the very same ids (not new documents).
    const fresh = await mountOther([]);
    expect(fresh.current!.pendingActualRecords!.map(record => record.id)).toEqual(originalIds);
    await act(async () => renderer!.unmount()); renderer = undefined;
    // Everything already saved with the same minutes: nothing to confirm and nothing to save.
    const same = await mountOther(saved(index => WEEK_RECORDS[index].minutes));
    expect(same.current!.pendingActualRecords).toEqual([]);
    await act(async () => { await same.current!.approveActualRecords!(); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => renderer!.unmount()); renderer = undefined;
    // One saved value differs: that row says it replaces the saved minutes; no write before the click.
    const changed = await mountOther(saved(index => (index === 1 ? 30 : WEEK_RECORDS[index].minutes)));
    expect(changed.current!.pendingActualRecords!.map(formatActualRecordRow).filter(row => row.includes('置き換えます')))
      .toEqual(['火 10/27 英語 45分 ※保存済みの30分を置き換えます']);
    expect(changed.current!.pendingActualRecords).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });
});
