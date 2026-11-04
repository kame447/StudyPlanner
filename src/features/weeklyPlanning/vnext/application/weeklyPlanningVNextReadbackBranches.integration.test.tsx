// #973 / A2: exact readback reasons and explicit retry outcomes through the real application,
// Firebase read adapter and classifier. Only the SDK I/O boundary is replaced; no API is contacted.
import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { ACTUAL_SAVE_RETRY_BLOCKED_REPLY, ACTUAL_SAVE_RETRY_FAILED_REPLY, formatActualSaveReadbackReply,
  formatUnknownActualSaveReadbackReply, sumActualRecordMinutes, type PendingWeeklyPlanningActualRecord } from '../../application/weeklyPlanningActualRecords';
import { PlannerMutationScopeExpiredError } from '../../../../lib/plannerMutationScopeExpiredError';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import { readAndClassifyActualSaveFromServer } from '../weeklyPlanningVNextActualSaveServerReadback';
import type { ConfirmedActual } from '../../../../domain/actualSaveReadback';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';

const sdk = vi.hoisted(() => ({ getDocsFromServer: vi.fn(), getDocs: vi.fn() }));
vi.mock('firebase/firestore', async importOriginal => ({ ...await importOriginal<typeof import('firebase/firestore')>(), ...sdk,
  collection: (_db: unknown, name: string) => ({ name }), documentId: () => '__name__',
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
}));

const OWNER = 'readback-owner';
const WEEK = '2026-11-02';
const NOW = '2026-11-03T00:00:00.000Z';
const weekRecords = [
  { dateExpression: '2026-10-26', subject: '数学', minutes: 60 },
  { dateExpression: '2026-10-27', subject: '英語', minutes: 45 },
  { dateExpression: '2026-10-28', subject: '現代文', minutes: 30 },
  { dateExpression: '2026-10-30', subject: '英語', minutes: 50 },
  { dateExpression: '2026-10-31', subject: '数学', minutes: 120 },
  { dateExpression: '2026-11-01', subject: '化学', minutes: 90 },
];
type Save = NonNullable<UseWeeklyPlanningApplicationInput['saveWeeklyActualRecords']>;
type Read = NonNullable<WeeklyPlanningVNextLocalApplicationServices['readActualSave']>;
type Query = { source: { name: string }; constraints: Array<{ field: string; op: string; value: string }> };
const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services);
  useImperativeHandle(ref, () => app, [app]);
  return null;
});

describe('VNext A2 readback reasons and retry refusals on the server-read boundary', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>;
  let restore: () => void;
  let renderer: ReactTestRenderer | undefined;
  let auth: { currentUser: { uid: string } | null };
  let server: Map<string, ConfirmedActual>;
  let productWrites: PendingWeeklyPlanningActualRecord[][];
  let transport: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    auth = { currentUser: { uid: OWNER } }; server = new Map(); productWrites = [];
    vi.clearAllMocks();
    transport = vi.fn(() => { throw new Error('No real API is permitted.'); });
    vi.stubGlobal('fetch', transport);
    sdk.getDocsFromServer.mockImplementation(async (request: Query) => {
      expect(request.source.name).toBe('actuals');
      const [owner, lower, upper] = request.constraints;
      expect(request.constraints).toHaveLength(3);
      expect(owner).toEqual({ field: 'userId', op: '==', value: OWNER });
      expect(lower).toEqual({ field: '__name__', op: '>=', value: upper.value });
      expect(upper).toEqual({ field: '__name__', op: '<=', value: lower.value });
      const row = server.get(lower.value);
      return { docs: row ? [{ id: row.id, data: () => row }] : [], metadata: { fromCache: false, hasPendingWrites: false } };
    });
  });
  afterEach(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest(); restore();
    expect(transport).not.toHaveBeenCalled();
    expect(sdk.getDocs).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  const saved = (record: PendingWeeklyPlanningActualRecord): ConfirmedActual => ({ id: record.id, userId: OWNER,
    occurrenceDate: record.occurrenceDate, subject: record.subject, actualDurationMinutes: record.minutes });
  const savePort = () => vi.fn<Save>(async (_ownerId, records) => {
    productWrites.push([...records]);
    for (const record of records) server.set(record.id, saved(record));
  }).mockRejectedValueOnce(new PlannerMutationScopeExpiredError());
  const readPort = () => vi.fn<Read>((ownerId, attempted) => readAndClassifyActualSaveFromServer({ ownerId, attempted,
    firestoreDb: {} as Firestore, firebaseAuth: auth as unknown as Auth }));
  const inputFor = (save: Save, userId: string = OWNER): UseWeeklyPlanningApplicationInput => ({ userId, selectedDate: WEEK,
    plans: [], scheduleTemplates: [], plannerDataAvailability: createReadyPlannerDataAvailability(userId),
    isPlannerDataSnapshotCurrent: () => true, saveWeeklyApprovedPlan: vi.fn(), saveWeeklyActualRecords: save });
  async function mount(save: Save, readActualSave?: Read) {
    const ref = createRef<WeeklyPlanningApplication>();
    const input = inputFor(save);
    const services: WeeklyPlanningVNextLocalApplicationServices = { storage: storage.storage,
      client: () => ({} as never), interpret: () => async () => { throw new Error('No provider turn is expected.'); },
      createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '', rawResponse: '' }) }),
      readActualSave, now: () => NOW };
    await act(async () => { renderer = create(<Harness ref={ref} input={input} services={services} />); });
    return { ref, input, services };
  }
  async function unresolved(save: ReturnType<typeof savePort>) {
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage });
    const ports: WeeklyPlanningVNextExperimentalPorts = { checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => null },
      interpret: createWeeklyPlanningVNextProviderInterpreter(), client: { async createChatCompletion() { return JSON.stringify({
        planningIntent: 'discuss', conversationActs: [], delta: { add: [], patch: [], remove: [], relate: [], defer: [] },
        studyRecords: weekRecords, studyRecordQuestion: null, answer: null,
      }); } }, approvalLedger: { read: () => null, write: () => { throw new Error('No approval.'); } },
      plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('No plan save.'); } },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => NOW,
      createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '合成の返信', rawResponse: '' }) }) };
    const seeded = await submitWeeklyPlanningVNextExperimentalTurn({ scope: { ownerId: OWNER, weekStartDate: WEEK,
      conversationId: 'readback-conversation', notBeforeTime: '09:00', clock: { currentDate: '2026-11-03', weekStartsOn: 'monday',
        timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' } }, ports,
      userText: '先週の勉強を記録したい', turnId: 'seed', shownRevision: null });
    expect(seeded.actualRecords).toHaveLength(6);
    const first = await mount(save);
    const records = first.ref.current!.pendingActualRecords!;
    expect(sumActualRecordMinutes(records)).toBe(395);
    await act(async () => { await expect(first.ref.current!.approveActualRecords!()).rejects.toBeInstanceOf(PlannerMutationScopeExpiredError); });
    expect(save).toHaveBeenCalledOnce();
    expect(productWrites).toEqual([]);
    const chatId = first.ref.current!.chat.index.activeChatId;
    const attempt = uiAttempt(chatId);
    expect(attempt.records).toEqual(records.map(({ id, minutes }) => ({ id, minutes })));
    await act(async () => renderer!.unmount()); renderer = undefined;
    return { records, chatId, attempt };
  }
  const uiAttempt = (chatId: string) => JSON.parse(storage.storage.getItem(
    `studyplanner.weeklyPlanning.vnext.${OWNER}.${WEEK}.${chatId}.ui`)!).actualSaveAttempt;
  const lastReply = (ref: { current: WeeklyPlanningApplication | null }) => {
    const replies = ref.current!.state.messages.filter(message => message.role === 'assistant');
    return replies[replies.length - 1]?.content;
  };
  async function replyIs(ref: { current: WeeklyPlanningApplication | null }, expected: string) {
    await act(async () => { await vi.waitFor(() => expect(lastReply(ref)).toBe(expected)); });
  }
  function stillPending(ref: { current: WeeklyPlanningApplication | null }, original: Awaited<ReturnType<typeof unresolved>>) {
    expect(ref.current!.pendingActualRecords).toEqual(original.records);
    expect(sumActualRecordMinutes(ref.current!.pendingActualRecords!)).toBe(395);
    const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId: original.chatId });
    expect(local.readCheckpoint()!.vnext.actualRecords!.map(record => record.status)).toEqual(Array(6).fill('pending'));
    expect(uiAttempt(original.chatId)).toEqual(original.attempt);
    expect(productWrites).toEqual([]);
  }

  it.each(['permission_denied', 'auth_mismatch'] as const)('shows the complete %s reason, keeps the attempt and does not route around the refusal', async reason => {
    const save = savePort();
    const original = await unresolved(save);
    if (reason === 'permission_denied') sdk.getDocsFromServer.mockRejectedValue({ code: 'permission-denied', message: 'private SDK detail' });
    else {
      const read = sdk.getDocsFromServer.getMockImplementation()!;
      sdk.getDocsFromServer.mockImplementation(async (query: Query) => {
        const result = await read(query);
        // Auth changes during the read, before the React owner transition has committed.
        auth.currentUser = { uid: 'other-owner' };
        return result;
      });
    }
    const read = readPort();
    const { ref } = await mount(save, read);
    await replyIs(ref, formatUnknownActualSaveReadbackReply(reason));
    expect(read).toHaveBeenCalledExactlyOnceWith(OWNER, original.records.map(({ id, occurrenceDate, subject, minutes }) => ({ id, occurrenceDate, subject, minutes })));
    expect(sdk.getDocsFromServer).toHaveBeenCalledTimes(6);
    stillPending(ref, original);
    await act(async () => { await ref.current!.approveActualRecords!(); await ref.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    expect(server.size).toBe(0);
    stillPending(ref, original);
    expect(lastReply(ref)).toBe(formatUnknownActualSaveReadbackReply(reason));
  });

  it('suppresses the old auth readback after the screen owner changes, without reading or writing the old attempt again', async () => {
    const save = savePort();
    const original = await unresolved(save);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const readSdk = sdk.getDocsFromServer.getMockImplementation()!;
    sdk.getDocsFromServer.mockImplementation(async (query: Query) => { await gate; return readSdk(query); });
    const read = readPort();
    const { ref, services } = await mount(save, read);
    expect(read).toHaveBeenCalledOnce();
    await act(async () => { auth.currentUser = { uid: 'other-owner' };
      renderer!.update(<Harness ref={ref} input={inputFor(save, 'other-owner')} services={services} />); });
    await act(async () => { release(); });
    expect(ref.current!.pendingActualRecords).toEqual([]);
    expect(ref.current!.state.messages.map(message => message.content)).not.toContain(formatUnknownActualSaveReadbackReply('auth_mismatch'));
    expect(uiAttempt(original.chatId)).toEqual(original.attempt);
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(read).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(productWrites).toEqual([]);
  });

  it('reports the exact retry failure after one explicit write attempt, retaining all pending records with no automatic resend', async () => {
    const denial = Object.assign(new Error('private write refusal'), { code: 'permission-denied' });
    const save = savePort().mockRejectedValueOnce(denial);
    const original = await unresolved(save);
    const read = readPort();
    const { ref } = await mount(save, read);
    await replyIs(ref, formatActualSaveReadbackReply(original.records, [], []));
    expect(save).toHaveBeenCalledOnce();
    await act(async () => { await expect(ref.current!.approveActualRecords!()).rejects.toBe(denial); });
    expect(lastReply(ref)).toBe(ACTUAL_SAVE_RETRY_FAILED_REPLY);
    expect(read).toHaveBeenCalledTimes(2);
    expect(sdk.getDocsFromServer).toHaveBeenCalledTimes(12);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(server.size).toBe(0);
    stillPending(ref, original);
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(lastReply(ref)).toBe(ACTUAL_SAVE_RETRY_FAILED_REPLY);
  });

  it.each(['saved', 'partial', 'conflicting'] as const)('blocks a retry when an independent server change becomes %s, without a product write', async status => {
    const save = savePort();
    const original = await unresolved(save);
    const read = readPort();
    const { ref } = await mount(save, read);
    await replyIs(ref, formatActualSaveReadbackReply(original.records, [], []));
    expect(read).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    // This is an independent device/late commit, not a write by the operation under test.
    const external = (status === 'saved' ? original.records : original.records.slice(0, 1)).map(saved);
    if (status === 'conflicting') external[0] = { ...external[0], actualDurationMinutes: external[0].actualDurationMinutes + 1 };
    for (const record of external) server.set(record.id, record);
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(lastReply(ref)).toBe(ACTUAL_SAVE_RETRY_BLOCKED_REPLY);
    expect(read).toHaveBeenCalledTimes(2);
    expect(sdk.getDocsFromServer).toHaveBeenCalledTimes(12);
    expect(await read.mock.results[1].value).toMatchObject({ status: status === 'saved' ? 'saved' : 'partial',
      conflictingIds: status === 'conflicting' ? [external[0].id] : [] });
    expect(save).toHaveBeenCalledOnce();
    expect([...server.values()]).toEqual(external);
    stillPending(ref, original);
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledOnce();
    expect(lastReply(ref)).toBe(ACTUAL_SAVE_RETRY_BLOCKED_REPLY);
  });
});
