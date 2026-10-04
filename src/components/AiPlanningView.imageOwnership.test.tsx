import { createWeeklyDraftApprovalOperation } from '../features/weeklyPlanning/planning/weeklyPlanningApproval';
import { createWeeklyPlanningTestDraftBlock } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiPlanningView } from './AiPlanningView';
import { AiPlanningChatSidebar } from './AiPlanningChatSidebar';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { createDeferred, createMemoryStorageHarness } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { createInitialPlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import { loadAiPlanningChatIndex } from '../features/weeklyPlanning/chat/aiPlanningChatStore';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import { setWeeklyPlanningTraceRepositoryForTests } from '../features/weeklyPlanning/trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../features/weeklyPlanning/trace/weeklyPlanningStableV5DebugTrace';
import { clearWeeklyPlanningSessionRuntime } from '../features/weeklyPlanning/planning/weeklyPlanningSessionRuntime';
import type { WeeklyPlanningTurnExecutionInput } from '../features/weeklyPlanning/weeklyPlanningTurnExecutor';
const mocks = vi.hoisted(() => ({ ocr: vi.fn(), execute: vi.fn() }));
vi.mock('../lib/planningImageAttachment', () => ({ extractPlanningImageAttachment: mocks.ocr }));
vi.mock('../repositories', () => ({ plannerRepository: { getTodos: async () => [], getStudyMaterials: async () => [] } }));
// This regression targets view ownership across OCR/turn awaits, not semantic planning.
// Keep the public view, real hook/controller and actual chat storage intact.
vi.mock('../features/weeklyPlanning/weeklyPlanningTurnExecutor', async () => ({
  ...await vi.importActual<typeof import('../features/weeklyPlanning/weeklyPlanningTurnExecutor')>('../features/weeklyPlanning/weeklyPlanningTurnExecutor'),
  executeWeeklyPlanningTurn: mocks.execute,
}));
let app: WeeklyPlanningApplication;
function Harness({ owner = 'user-1', completion }: { owner?: string; completion?: Promise<void> }) {
  app = useWeeklyPlanningApplication({ userId: owner, selectedDate: '2026-07-14', plans: [], scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(owner), saveWeeklyApprovedPlan: vi.fn() });
  const application = completion ? { ...app, submitTurn: async (...args: Parameters<WeeklyPlanningApplication['submitTurn']>) => {
    const result = await app.submitTurn(...args); await completion; return result;
  } } : app;
  return <AiPlanningView application={application} userId={owner} selectedDate="2026-07-14" plans={[]} />;
}
let renderer: ReactTestRenderer | undefined;
let storage: ReturnType<typeof createMemoryStorageHarness>;
const index = (owner = 'user-1') => loadAiPlanningChatIndex(owner);
const sidebar = () => renderer!.root.findByType(AiPlanningChatSidebar);
const send = () => renderer!.root.findByProps({ 'aria-label': '送信' });
async function mount(owner = 'user-1') { await act(async () => { renderer = create(<Harness owner={owner} />); }); }
async function attach() {
  await act(async () => { renderer!.root.findByProps({ type: 'file' }).props.onChange({ target: {
    files: [{ name: 'image.png', type: 'image/png', size: 10 }],
  } }); });
}
async function settle(pending: ReturnType<typeof createDeferred<{ text: string }>>, error = false) {
  await act(async () => {
    if (error) pending.reject(new Error('OCR unavailable')); else pending.resolve({ text: 'synthetic image evidence' });
  });
}
beforeEach(() => {
  mocks.ocr.mockReset(); mocks.execute.mockReset();
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  setWeeklyPlanningTraceRepositoryForTests(undefined); resetWeeklyPlanningStableV5DebugTraceForTest();
  mocks.execute.mockImplementation(async (input: WeeklyPlanningTurnExecutionInput) => ({
    state: { ...createInitialPlanningIntakeState(), sourceTurns: [input.userText] }, message: 'processed', draftCandidates: [],
  }));
  storage = createMemoryStorageHarness();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden by fixture'); }));
  vi.stubGlobal('window', { localStorage: storage.storage, sessionStorage: storage.storage,
    matchMedia: () => ({ matches: false }), confirm: vi.fn(() => true),
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
  setWeeklyPlanningTraceRepositoryForTests(undefined); resetWeeklyPlanningStableV5DebugTraceForTest();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

it('keeps normal image submission functional and saves its own chat', async () => {
  const pending = createDeferred<{ text: string }>(); mocks.ocr.mockReturnValue(pending.promise);
  await mount(); const before = index(); await attach();
  await act(async () => { send().props.onClick(); }); await settle(pending);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(index().activeChatId).toBe(before.activeChatId); expect(index().chats).toHaveLength(1);
  expect(app.state.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  expect(sidebar().props.disabled).toBe(false);
});

it('locks same-tick and rendered create/select/delete/submit while OCR owns the operation', async () => {
  const pending = createDeferred<{ text: string }>(); mocks.ocr.mockReturnValue(pending.promise);
  await mount(); await act(async () => { sidebar().props.onCreate(); });
  const before = index(); expect(before.chats).toHaveLength(2); await attach();
  const oldSidebar = sidebar().props; const submit = send().props.onClick;
  await act(async () => {
    submit(); submit(); oldSidebar.onCreate(); oldSidebar.onSelect(before.chats.find((chat) => chat.id !== before.activeChatId)!.id);
    oldSidebar.onDelete(before.activeChatId);
  });
  expect(mocks.ocr).toHaveBeenCalledTimes(1); expect(mocks.execute).not.toHaveBeenCalled();
  expect(sidebar().props.disabled).toBe(true);
  await act(async () => { sidebar().props.onCreate(); sidebar().props.onSelect(before.chats[0].id); sidebar().props.onDelete(before.activeChatId); });
  expect(index()).toEqual(before); expect(window.confirm).not.toHaveBeenCalled();
  await settle(pending); expect(index().activeChatId).toBe(before.activeChatId); expect(index().chats).toHaveLength(2);
  expect(mocks.execute).toHaveBeenCalledTimes(1); expect(sidebar().props.disabled).toBe(false);
});

it.each([false, true])('ignores OCR completion after unmount (reject=%s)', async (reject) => {
  const pending = createDeferred<{ text: string }>(); mocks.ocr.mockReturnValue(pending.promise);
  await mount(); await attach(); await act(async () => { send().props.onClick(); });
  act(() => renderer!.unmount()); renderer = undefined;
  const before = new Map(storage.values); await settle(pending, reject);
  expect(mocks.execute).not.toHaveBeenCalled(); expect(storage.values).toEqual(before);
});

it.each([false, true])('keeps both owners isolated when old OCR settles (reject=%s)', async (reject) => {
  const old = createDeferred<{ text: string }>(); const current = createDeferred<{ text: string }>();
  mocks.ocr.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await mount(); await attach(); await act(async () => { send().props.onClick(); });
  await act(async () => { renderer!.update(<Harness owner="user-2" />); });
  expect(sidebar().props.disabled).toBe(false);
  const oldIndex = index('user-1'); const newIndex = index('user-2');
  await attach(); await act(async () => { send().props.onClick(); });
  await settle(old, reject);
  expect(mocks.execute).not.toHaveBeenCalled(); expect(index('user-1')).toEqual(oldIndex); expect(index('user-2')).toEqual(newIndex);
  expect(sidebar().props.disabled).toBe(true);
  await settle(current); expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(index('user-1')).toEqual(oldIndex); expect(index('user-2').activeChatId).toBe(newIndex.activeChatId);
  expect(sidebar().props.disabled).toBe(false);
});

it('releases a failed extraction for retry without discarding its attachment', async () => {
  const first = createDeferred<{ text: string }>(); const retry = createDeferred<{ text: string }>();
  mocks.ocr.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  await mount(); await attach(); await act(async () => { send().props.onClick(); }); await settle(first, true);
  expect(sidebar().props.disabled).toBe(false); expect(JSON.stringify(renderer!.toJSON())).toContain('OCR unavailable');
  await act(async () => { send().props.onClick(); }); expect(mocks.ocr).toHaveBeenCalledTimes(2);
  await settle(retry); expect(mocks.execute).toHaveBeenCalledTimes(1);
});


it.each([[false, false], [true, false], [true, true]])('owns delayed submission completion after pendingTurn clears (unmount=%s, reject=%s)', async (unmount, reject) => {
  const pending = createDeferred<{ text: string }>(); const completion = createDeferred<void>();
  mocks.ocr.mockReturnValue(pending.promise);
  await act(async () => { renderer = create(<Harness completion={completion.promise} />); });
  await attach(); await act(async () => { send().props.onClick(); }); await settle(pending);
  expect(mocks.execute).toHaveBeenCalledTimes(1); expect(app.state.pendingTurn).toBeUndefined();
  expect(sidebar().props.disabled).toBe(true);
  const before = index(); await act(async () => { sidebar().props.onCreate(); }); expect(index()).toEqual(before);
  if (unmount) { act(() => renderer!.unmount()); renderer = undefined; }
  const stored = new Map(storage.values);
  await act(async () => { if (reject) completion.reject(new Error('late completion error')); else completion.resolve(); });
  if (unmount) expect(storage.values).toEqual(stored);
  else { expect(sidebar().props.disabled).toBe(false); expect(index().activeChatId).toBe(before.activeChatId); }
});

it.each(['create', 'select', 'delete-other', 'delete-active'])('rejects a retained submit callback after same-tick %s navigation', async (action) => {
  mocks.ocr.mockResolvedValue({ text: 'obsolete evidence' });
  await mount(); await act(async () => { sidebar().props.onCreate(); }); await attach();
  const before = index(); const oldSubmit = send().props.onClick; const navigation = sidebar().props;
  const other = before.chats.find((chat) => chat.id !== before.activeChatId)!;
  await act(async () => {
    if (action === 'create') navigation.onCreate();
    else if (action === 'select') navigation.onSelect(other.id);
    else navigation.onDelete(action === 'delete-other' ? other.id : before.activeChatId);
    oldSubmit();
  });
  expect(mocks.ocr).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  expect(sidebar().props.disabled).toBe(false);
  if (action === 'create') expect(index().chats).toHaveLength(3);
  else if (action === 'select') expect(index().activeChatId).toBe(other.id);
  else expect(index().chats).toHaveLength(1);
});

it.each([false, true])('cancel releases the view while late submission stays obsolete (reject=%s)', async (reject) => {
  const old = createDeferred<{ state: ReturnType<typeof createInitialPlanningIntakeState>; message: string; draftCandidates: [] }>();
  mocks.ocr.mockResolvedValue({ text: 'synthetic image evidence' });
  mocks.execute.mockReturnValueOnce(old.promise);
  await mount(); await attach(); await act(async () => { send().props.onClick(); });
  expect(app.state.pendingTurn).toBeDefined();
  const cancel = renderer!.root.findAllByType('button').find((node) => node.children.includes('処理をキャンセル'))!;
  await act(async () => { cancel.props.onClick(); });
  expect(app.state.pendingTurn).toBeUndefined(); expect(sidebar().props.disabled).toBe(false);
  await act(async () => { sidebar().props.onCreate(); });
  const current = createDeferred<{ text: string }>(); mocks.ocr.mockReturnValueOnce(current.promise);
  await attach(); await act(async () => { send().props.onClick(); });
  const currentIndex = index();
  await act(async () => {
    if (reject) old.reject(new Error('obsolete planning error'));
    else old.resolve({ state: createInitialPlanningIntakeState(), message: 'obsolete', draftCandidates: [] });
  });
  expect(index()).toEqual(currentIndex); expect(sidebar().props.disabled).toBe(true);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('obsolete planning error');
  await settle(current); expect(sidebar().props.disabled).toBe(false);
  expect(index().activeChatId).toBe(currentIndex.activeChatId);
});

it('freezes input and image extraction during approval recovery while allowing snapshot-backed chat navigation', async () => {
  await mount();
  const snapshot = app.exportConversationSnapshot({ includeEmpty: true })!;
  const block = createWeeklyPlanningTestDraftBlock({ id: 'recover-ui' });
  const operation = createWeeklyDraftApprovalOperation({ userId: 'user-1',
    metadata: { previewId: 'recover-ui', stateRevision: 0, authorizedUserId: 'user-1',
      assumptionDependencies: [], approvalEligibility: 'eligible', stale: false },
    blocks: [block], now: '2026-10-04T00:00:00.000Z' });
  operation.status = 'failed'; operation.items[0].status = 'failed';
  snapshot.planningState.draftBlocks = [block];
  snapshot.planningState.approvalRecovery = { version: 1, weekStartDate: snapshot.weekStartDate, operation, blocks: [block] };
  await act(async () => { expect(app.loadConversationSnapshot(snapshot)).toBe(true); });
  expect(app.canEditDraftBlocks).toBe(false);
  expect(send().props.disabled).toBe(true);
  expect(sidebar().props.disabled).toBe(false);
  expect(renderer!.root.findAllByProps({ role: 'status' }).some((node) => JSON.stringify(node.children).includes('保存の確認が途中'))).toBe(true);
  await attach();
  await act(async () => { send().props.onClick(); });
  expect(mocks.ocr).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
  const previous = index().activeChatId;
  await act(async () => { sidebar().props.onCreate(); });
  expect(index().activeChatId).not.toBe(previous);
  expect(app.state.approvalRecovery).toBeUndefined();
  await act(async () => { sidebar().props.onSelect(previous); });
  expect(app.state.approvalRecovery?.operation.approvalOperationId).toBe(operation.approvalOperationId);
  expect(app.state.draftBlocks).toHaveLength(1);
});
