import { startTransition, Suspense } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiPlanningView } from './AiPlanningView';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { WeeklyPlanningRuntimeModuleError } from '../features/weeklyPlanning/application/weeklyPlanningRuntimeModule';
import { AI_PLANNING_MODULE_RECOVERY_KEY } from '../features/weeklyPlanning/chat/aiPlanningModuleRecovery';
import { createDeferred, createMemoryStorageHarness } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { PlannerDataReadAuthority, type PlannerDataAvailability } from '../domain/plannerDataReadAuthority';
import { createReadyPlannerDataAvailability } from '../features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { createInitialPlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import { setWeeklyPlanningTraceRepositoryForTests } from '../features/weeklyPlanning/trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../features/weeklyPlanning/trace/weeklyPlanningStableV5DebugTrace';
import { clearWeeklyPlanningSessionRuntime } from '../features/weeklyPlanning/planning/weeklyPlanningSessionRuntime';

const mocks = vi.hoisted(() => ({ load: vi.fn(), ocr: vi.fn(), execute: vi.fn(), reload: vi.fn(), todos: vi.fn() }));
vi.mock('../features/weeklyPlanning/application/weeklyPlanningRuntimeModule', async () => ({
  ...await vi.importActual('../features/weeklyPlanning/application/weeklyPlanningRuntimeModule'),
  loadWeeklyPlanningRuntimeModule: mocks.load,
}));
vi.mock('../lib/planningImageAttachment', () => ({ extractPlanningImageAttachment: mocks.ocr }));
vi.mock('../repositories', () => ({ plannerRepository: { getTodos: mocks.todos, getStudyMaterials: async () => [] } }));
vi.mock('../features/weeklyPlanning/weeklyPlanningTurnExecutor', async () => ({
  ...await vi.importActual('../features/weeklyPlanning/weeklyPlanningTurnExecutor'), executeWeeklyPlanningTurn: mocks.execute,
}));
let app: WeeklyPlanningApplication;
function Harness({ owner = 'user-1', ready = true, suspended, availability, isSnapshotCurrent = () => true }: { owner?: string; ready?: boolean; suspended?: Promise<void>; availability?: PlannerDataAvailability; isSnapshotCurrent?: () => boolean }) {
  app = useWeeklyPlanningApplication({ userId: owner, selectedDate: '2026-10-05', plans: [], scheduleTemplates: [],
    isPlannerDataSnapshotCurrent: isSnapshotCurrent,
    plannerDataAvailability: availability ?? (ready ? createReadyPlannerDataAvailability(owner) : {status:'loading',ownerId:owner,observedAt:new Date().toISOString(),lastSuccessfulAt:null}), saveWeeklyApprovedPlan: vi.fn() });
  if (suspended) throw suspended;
  return <AiPlanningView application={app} userId={owner} selectedDate="2026-10-05" plans={[]} />;
}
let renderer: ReactTestRenderer | undefined;
let local: ReturnType<typeof createMemoryStorageHarness>;
let session: ReturnType<typeof createMemoryStorageHarness>;
const textInput = () => renderer!.root.findByType('textarea');
const send = () => renderer!.root.findByProps({ 'aria-label': '送信' });
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(label))!;
const nativeError = () => new WeeklyPlanningRuntimeModuleError(new TypeError("'text/html' is not a valid JavaScript MIME type."));
async function mount(owner = 'user-1') { await act(async () => { renderer = create(<Harness owner={owner} />); }); }
async function type(text: string) { await act(async () => { textInput().props.onChange({ target: { value: text } }); }); }
async function attach(file = new File([new Uint8Array([0,128,255,10,13])], '画像.png', {type:'image/png',lastModified:42})) {
  await act(async () => { renderer!.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [file] } }); }); return file;
}
async function failSubmission() { mocks.load.mockRejectedValue(nativeError()); await act(async () => { send().props.onClick(); }); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.values(mocks).forEach(mock => mock.mockReset()); mocks.load.mockResolvedValue({}); mocks.ocr.mockResolvedValue({text:'synthetic OCR'}); mocks.todos.mockResolvedValue([]);
  mocks.execute.mockResolvedValue({state:createInitialPlanningIntakeState(),message:'processed',draftCandidates:[]});
  local=createMemoryStorageHarness(); session=createMemoryStorageHarness();
  vi.stubGlobal('window',{localStorage:local.storage,sessionStorage:session.storage,matchMedia:()=>({matches:false}),confirm:vi.fn(()=>true),location:{reload:mocks.reload}});
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('network forbidden by fixture')}));
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:synthetic');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>undefined);
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED','false');
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();clearWeeklyPlanningSessionRuntime();
  setWeeklyPlanningTraceRepositoryForTests(undefined);resetWeeklyPlanningStableV5DebugTraceForTest();
});
afterEach(()=>{
  act(()=>renderer?.unmount());renderer=undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();clearWeeklyPlanningSessionRuntime();
  setWeeklyPlanningTraceRepositoryForTests(undefined);resetWeeklyPlanningStableV5DebugTraceForTest();
  vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();
});

it('rejects module failure before OCR or begin_turn and keeps the exact composer text and file',async()=>{
  await mount();await type('  明日の予定立てたい\n');const file=await attach();await failSubmission();
  expect(mocks.ocr).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();expect(app.state.messages).toHaveLength(0);expect(app.state.pendingTurn).toBeUndefined();
  expect(textInput().props.value).toBe('  明日の予定立てたい\n');expect(renderer!.root.findByProps({'aria-label':`添付画像 ${file.name}`})).toBeDefined();
  expect(JSON.stringify(renderer!.toJSON())).toContain('入力内容はこの画面に保持');expect(send().props.disabled).toBe(true);expect(mocks.reload).not.toHaveBeenCalled();
});
it('one code-only retry never starts OCR or AI and requires a separate Send afterward',async()=>{
  await mount();await type('明日');await attach();await failSubmission();mocks.load.mockResolvedValue({});
  await act(async()=>{button('機能の読み込みを再試行').props.onClick()});
  expect(mocks.ocr).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();expect(send().props.disabled).toBe(false);
  await act(async()=>{send().props.onClick()});expect(mocks.ocr).toHaveBeenCalledTimes(1);expect(mocks.execute).toHaveBeenCalledTimes(1);
});
it('bounds failed code-only retry, including repeated retained callbacks',async()=>{
  await mount();await type('明日');await failSubmission();const retry=button('機能の読み込みを再試行').props.onClick;
  await act(async()=>{retry();retry()});expect(mocks.load).toHaveBeenCalledTimes(2);expect(button('機能の読み込みを再試行').props.disabled).toBe(true);
  await act(async()=>{retry();button('機能の読み込みを再試行').props.onClick()});expect(mocks.load).toHaveBeenCalledTimes(2);expect(mocks.execute).not.toHaveBeenCalled();
});
it('explicit reload verifies the real chat checkpoint and restores exact text/file once without automatic OCR or AI',async()=>{
  await mount();await type('  明日の予定立てたい\n');const original=await attach();await failSubmission();
  await act(async()=>{button('入力を一時保存して画面を更新').props.onClick()});
  expect(mocks.reload).toHaveBeenCalledTimes(1);expect(session.values.has(AI_PLANNING_MODULE_RECOVERY_KEY)).toBe(true);expect(mocks.ocr).not.toHaveBeenCalled();
  const binding=app.getModuleRecoveryBinding();act(()=>renderer!.unmount());renderer=undefined;resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  await mount();expect(app.getModuleRecoveryBinding()).toEqual(binding);expect(textInput().props.value).toBe('  明日の予定立てたい\n');
  expect(session.values.has(AI_PLANNING_MODULE_RECOVERY_KEY)).toBe(false);expect(mocks.ocr).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
  const previewCalls=vi.mocked(URL.createObjectURL).mock.calls;
  const restored=previewCalls[previewCalls.length - 1][0] as File;
  expect(restored).toMatchObject({name:original.name,type:original.type,lastModified:original.lastModified});expect(new Uint8Array(await restored.arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()));
});
it.each(['quota','readback','checkpoint'])('keeps the current composer and blocks reload when %s fails',async(mode)=>{
  await mount();await type('exact input');await attach();await failSubmission();
  if(mode==='quota')session.storage.setItem=()=>{throw new DOMException('quota','QuotaExceededError')};
  if(mode==='readback')session.storage.getItem=()=>'{corrupt';
  if(mode==='checkpoint'){const write=local.storage.setItem.bind(local.storage);local.storage.setItem=(key,value)=>{if(key.includes('.chat.v1.'))throw new Error('checkpoint failure');write(key,value)}}
  await act(async()=>{button('入力を一時保存して画面を更新').props.onClick()});expect(mocks.reload).not.toHaveBeenCalled();expect(textInput().props.value).toBe('exact input');expect(renderer!.root.findByProps({'aria-label':'添付画像 画像.png'})).toBeDefined();expect(mocks.ocr).not.toHaveBeenCalled();
});
it('does not restore another owner capsule or replay a late owner-A code-preparation result',async()=>{
  await mount();await type('owner A');await failSubmission();await act(async()=>{button('入力を一時保存して画面を更新').props.onClick()});
  act(()=>renderer!.unmount());renderer=undefined;await mount('user-2');expect(textInput().props.value).toBe('');expect(session.values.has(AI_PLANNING_MODULE_RECOVERY_KEY)).toBe(true);
  const pending=createDeferred<object>();mocks.load.mockReturnValue(pending.promise);await type('owner B');await act(async()=>{send().props.onClick()});
  await act(async()=>{renderer!.update(<Harness owner="user-3" />)});await act(async()=>{pending.resolve({})});expect(mocks.ocr).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();expect(app.state.messages).toHaveLength(0);
});
it('direct application submission also preflights before appending a turn',async()=>{
  await mount();mocks.load.mockRejectedValue(nativeError());await expect(app.submitTurn('direct caller')).rejects.toBeInstanceOf(WeeklyPlanningRuntimeModuleError);
  expect(app.state.messages).toHaveLength(0);expect(mocks.execute).not.toHaveBeenCalled();
});

// Independent review regressions: stale callbacks, storage races, and untrusted recovery data.
it('review: recovery remains available after replacing attachment', async () => {
  await mount(); await type('draft'); await failSubmission();
  await attach();
  expect(send().props.disabled).toBe(true);
  expect(button('機能の読み込みを再試行')).toBeDefined();
  expect(button('入力を一時保存して画面を更新')).toBeDefined();
});
it('review: retained retry callback cannot start another retry after completion', async () => {
  await mount(); await type('draft'); await failSubmission();
  const retry = button('機能の読み込みを再試行').props.onClick;
  await act(async () => { retry(); });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  await act(async () => { retry(); });
  expect(mocks.load).toHaveBeenCalledTimes(2);
});
it('review: direct pending submit is revoked after reset and reimport of the same binding', async () => {
  await mount();
  const saved = app.exportConversationSnapshot({ includeEmpty: true });
  expect(saved).not.toBeNull();
  const initial = app.getModuleRecoveryBinding();
  const pending = createDeferred<object>(); mocks.load.mockReturnValue(pending.promise);
  let result: ReturnType<typeof app.submitTurn>;
  await act(async () => { result = app.submitTurn('abandoned request'); });
  await act(async () => { app.resetSession(); });
  expect(app.getModuleRecoveryBinding()).not.toEqual(initial);
  await act(async () => { expect(app.loadConversationSnapshot(saved)).toBe(true); });
  expect(app.getModuleRecoveryBinding()).toEqual(initial);
  await act(async () => { pending.resolve({}); await result; });
  expect(mocks.execute).not.toHaveBeenCalled();
});
it('review: direct pending submit is revoked after chat A-B-A navigation', async () => {
  await mount();
  const firstChat = app.chat.index.activeChatId;
  await act(async () => { expect(app.chat.create().status).toBe('saved'); });
  const secondChat = app.chat.index.activeChatId;
  await act(async () => { expect(app.chat.select(firstChat).status).toBe('saved'); });
  const initial = app.getModuleRecoveryBinding();
  const pending = createDeferred<object>(); mocks.load.mockReturnValue(pending.promise);
  let result: ReturnType<typeof app.submitTurn>;
  await act(async () => { result = app.submitTurn('abandoned request'); });
  await act(async () => { expect(app.chat.select(secondChat).status).toBe('saved'); });
  await act(async () => { expect(app.chat.select(firstChat).status).toBe('saved'); });
  expect(app.getModuleRecoveryBinding()).toEqual(initial);
  await act(async () => { pending.resolve({}); await result; });
  expect(mocks.execute).not.toHaveBeenCalled();
});
it('review: pending reload is revoked after reset and reimport of the same binding', async () => {
  await mount(); await type('old draft');
  const file = await attach();
  const bytes = await file.arrayBuffer();
  const pending = createDeferred<ArrayBuffer>();
  vi.spyOn(file, 'arrayBuffer').mockReturnValue(pending.promise);
  await failSubmission();
  const saved = app.exportConversationSnapshot({ includeEmpty: true });
  const initial = app.getModuleRecoveryBinding();
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  await act(async () => { app.resetSession(); });
  await act(async () => { expect(app.loadConversationSnapshot(saved)).toBe(true); });
  expect(app.getModuleRecoveryBinding()).toEqual(initial);
  await act(async () => { pending.resolve(bytes); });
  expect(mocks.reload).not.toHaveBeenCalled();
});
it('review: reload blocks if durable chat identity changes during attachment serialization', async () => {
  await mount();
  const firstChat = app.chat.index.activeChatId;
  await act(async () => { expect(app.chat.create().status).toBe('saved'); });
  const secondChat = app.chat.index.activeChatId;
  await act(async () => { expect(app.chat.select(firstChat).status).toBe('saved'); });
  await type('must restore automatically');
  const file = await attach();
  const bytes = await file.arrayBuffer();
  const pending = createDeferred<ArrayBuffer>();
  vi.spyOn(file, 'arrayBuffer').mockReturnValue(pending.promise);
  await failSubmission();
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  const indexKey = 'studyplanner.aiPlanning.chats.v1.user-1';
  const persisted = JSON.parse(local.storage.getItem(indexKey)!);
  persisted.activeChatId = secondChat;
  local.storage.setItem(indexKey, JSON.stringify(persisted));
  await act(async () => { pending.resolve(bytes); });
  expect(mocks.reload).not.toHaveBeenCalled();
});
it('review: restore rejects a capsule if canonical initialization changes the revision', async () => {
  await mount(); await type('draft bound to old revision'); await failSubmission();
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  const binding = app.getModuleRecoveryBinding()!;
  const key = `studyplanner.aiPlanning.chat.v1.${binding.ownerId}.${binding.chatId}`;
  const snapshot = JSON.parse(local.storage.getItem(key)!);
  snapshot.planningState.revision++;
  local.storage.setItem(key, JSON.stringify(snapshot));
  act(() => renderer!.unmount()); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  await mount();
  expect(app.getModuleRecoveryBinding()?.revision).toBe(binding.revision + 1);
  expect(textInput().props.value).toBe('');
  expect(session.values.has(AI_PLANNING_MODULE_RECOVERY_KEY)).toBe(true);
});
it('review: nonempty owned-state startup cannot restore before newer canonical initialization', async () => {
  await mount();
  await act(async () => { app.appendMessage({id:'existing-user-message',role:'user',content:'existing conversation',createdAt:new Date().toISOString()}); app.chat.checkpoint(); });
  await type('draft bound to old revision'); await failSubmission();
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  const binding = app.getModuleRecoveryBinding()!;
  const key = `studyplanner.aiPlanning.chat.v1.${binding.ownerId}.${binding.chatId}`;
  const snapshot = JSON.parse(local.storage.getItem(key)!);
  snapshot.planningState.revision++;
  local.storage.setItem(key, JSON.stringify(snapshot));
  act(() => renderer!.unmount()); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  await mount();
  expect(app.getModuleRecoveryBinding()?.revision).toBe(binding.revision + 1);
  expect(textInput().props.value).toBe('');
  expect(session.values.has(AI_PLANNING_MODULE_RECOVERY_KEY)).toBe(true);
});
it('review: recovery never forwards unknown persisted starter target fields', async () => {
  mocks.todos.mockResolvedValue([{id:'todo-known',title:'math exercises',status:'todo',dueDate:null,createdAt:new Date().toISOString()}]);
  await mount();
  const starter = renderer!.root.findAllByType('button').find(node => node.findAllByType('span').some(span => span.children.includes('math exercisesを進める学習計画を作って')))!;
  expect(starter).toBeDefined();
  await act(async () => { starter.props.onClick(); });
  await failSubmission();
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  const capsule = JSON.parse(session.storage.getItem(AI_PLANNING_MODULE_RECOVERY_KEY)!);
  capsule.selectedStarter.target.unexpectedInstructions = 'untrusted persisted metadata';
  session.storage.setItem(AI_PLANNING_MODULE_RECOVERY_KEY, JSON.stringify(capsule));
  act(() => renderer!.unmount()); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); mocks.load.mockResolvedValue({});
  await mount();
  await act(async () => { send().props.onClick(); });
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.execute.mock.calls[0][0].selectedStarterTarget).not.toHaveProperty('unexpectedInstructions');
});
it.each(['snapshot-noop','snapshot-corrupt','index-noop','index-corrupt','capsule-noop','capsule-corrupt'])('review: blocks reload for %s durable write', async mode => {
  await mount();
  if (mode.startsWith('snapshot')) {
    await act(async () => { expect(app.chat.checkpoint().status).toBe('saved'); });
    await act(async () => { app.appendMessage({id:'unsaved-user',role:'user',content:'must not disappear',createdAt:new Date().toISOString()}); });
  }
  await type('  exact input\n'); await attach(); await failSubmission();
  const storage = mode.startsWith('capsule') ? session.storage : local.storage;
  const originalWrite = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    const relevant = mode.startsWith('snapshot') ? key.includes('.chat.v1.') : mode.startsWith('index') ? key.includes('.chats.v1.') : key === AI_PLANNING_MODULE_RECOVERY_KEY;
    if (relevant) { if (mode.endsWith('corrupt')) originalWrite(key, '{broken'); return; }
    originalWrite(key, value);
  };
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  expect(mocks.reload).not.toHaveBeenCalled();
  expect(textInput().props.value).toBe('  exact input\n');
  expect(renderer!.root.findByProps({'aria-label':'添付画像 画像.png'})).toBeDefined();
});
it('review: actual component controls cannot mutate a draft during pending serialization', async () => {
  await mount(); await type('  exact protected input\n'); const file = await attach();
  const bytes = await file.arrayBuffer(); const pending = createDeferred<ArrayBuffer>();
  vi.spyOn(file, 'arrayBuffer').mockReturnValue(pending.promise); await failSubmission();
  const oldChange = textInput().props.onChange;
  const oldFileChange = renderer!.root.findByProps({type:'file'}).props.onChange;
  const oldRemove = renderer!.root.findByProps({'aria-label':'添付画像を削除'}).props.onClick;
  const oldStarter = renderer!.root.findByProps({className:'ai-planning-starter-list'}).findAllByType('button')[0].props.onClick;
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  expect(textInput().props.disabled).toBe(true);
  expect(renderer!.root.findByProps({'aria-label':'写真を追加'}).props.disabled).toBe(true);
  expect(renderer!.root.findByProps({'aria-label':'添付画像を削除'}).props.disabled).toBe(true);
  await act(async () => {
    oldChange({target:{value:'new input'}});
    oldFileChange({target:{files:[new File(['new'],'replacement.png',{type:'image/png'})]}});
    oldRemove(); oldStarter();
  });
  expect(textInput().props.value).toBe('  exact protected input\n');
  expect(renderer!.root.findByProps({'aria-label':'添付画像 画像.png'})).toBeDefined();
  await act(async () => { pending.resolve(bytes); });
  expect(mocks.reload).toHaveBeenCalledTimes(1);
  const capsule = JSON.parse(session.storage.getItem(AI_PLANNING_MODULE_RECOVERY_KEY)!);
  expect(capsule.text).toBe('  exact protected input\n'); expect(capsule.attachment.name).toBe(file.name);
});
it('review: aborting second preflight preserves original whitespace exactly', async () => {
  await mount(); await type('  exact input\n');
  const pending = createDeferred<object>(); mocks.load.mockResolvedValueOnce({}).mockReturnValueOnce(pending.promise);
  await act(async () => { send().props.onClick(); });
  await act(async () => { app.appendMessage({id:'changed-state',role:'user',content:'changed',createdAt:new Date().toISOString()}); });
  await act(async () => { pending.resolve({}); });
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(textInput().props.value).toBe('  exact input\n');
  expect(JSON.stringify(renderer!.toJSON())).toContain('送信前の状態が変わりました');
  expect(send().props.disabled).toBe(false);
});
it('review: restored starter cannot submit without its target while source rows are loading', async () => {
  const rows = [{id:'todo-known',title:'math exercises',status:'todo',dueDate:null,createdAt:new Date().toISOString()}];
  mocks.todos.mockResolvedValue(rows); await mount();
  const starter = renderer!.root.findAllByType('button').find(node => node.findAllByType('span').some(span => span.children.includes('math exercisesを進める学習計画を作って')))!;
  await act(async () => { starter.props.onClick(); }); await failSubmission();
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  act(() => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const pending = createDeferred<typeof rows>(); mocks.todos.mockReturnValue(pending.promise); mocks.load.mockResolvedValue({});
  await mount(); expect(textInput().props.value).toBe('このTodoを進める学習計画を作って');
  await act(async () => { send().props.onClick(); });
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(textInput().props.value).toBe('このTodoを進める学習計画を作って');
  await act(async () => { pending.resolve(rows); });
  await act(async () => { send().props.onClick(); });
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.execute.mock.calls[0][0].selectedStarterTarget).toMatchObject({kind:'todo',id:'todo-known'});
});
it('review: preflight rejects readiness revoked while the module was loading', async () => {
  await mount(); const pending = createDeferred<object>(); mocks.load.mockReturnValue(pending.promise);
  let result: ReturnType<typeof app.submitTurn>;
  await act(async () => { result = app.submitTurn('request against old ready data'); });
  await act(async () => { renderer!.update(<Harness ready={false} />); });
  await act(async () => { pending.resolve({}); await result; });
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(app.state.messages).toHaveLength(0);
});
it('review: oversized otherwise-valid 15 MiB attachment explicitly blocks reload and stays in composer', async () => {
  await mount(); await type('  keep all input\n');
  const file = await attach(new File([new Uint8Array(15 * 1024 * 1024)], 'large.png', {type:'image/png'}));
  const read = vi.spyOn(file, 'arrayBuffer'); await failSubmission();
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  expect(mocks.reload).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  expect(textInput().props.value).toBe('  keep all input\n');
  expect(renderer!.root.findByProps({'aria-label':'添付画像 large.png'})).toBeDefined();
  expect(JSON.stringify(renderer!.toJSON())).toContain('入力や画像を一時保存できないため、画面は更新していません');
  expect(mocks.ocr).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it('review: capsule acknowledgment occurs only after its exact text and attachment have rendered', async () => {
  await mount(); await type('  restored draft\n'); await attach(); await failSubmission();
  await act(async () => { button('入力を一時保存して画面を更新').props.onClick(); });
  act(() => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const remove = session.storage.removeItem.bind(session.storage); let ackCount = 0;
  session.storage.removeItem = key => {
    if (key === AI_PLANNING_MODULE_RECOVERY_KEY) {
      expect(textInput().props.value).toBe('  restored draft\n');
      expect(renderer!.root.findByProps({'aria-label':'添付画像 画像.png'})).toBeDefined();
      ackCount++;
    }
    remove(key);
  };
  await mount(); expect(ackCount).toBe(1);
});
it('review: ready-loading-ready with replaced request inputs revokes old preflight', async () => {
  await mount(); const pending = createDeferred<object>(); mocks.load.mockReturnValue(pending.promise);
  const committed = app; let result: ReturnType<typeof app.submitTurn>;
  await act(async () => { result = committed.submitTurn('request against old ready arrays'); });
  await act(async () => { renderer!.update(<Harness ready={false} />); });
  await act(async () => { renderer!.update(<Harness ready />); });
  await act(async () => { pending.resolve({}); await result; });
  expect(mocks.execute).not.toHaveBeenCalled(); expect(app.state.messages).toHaveLength(0);
});
it('review: an abandoned suspended render cannot poison committed request readiness', async () => {
  await act(async () => { renderer = create(<Suspense fallback={<div>loading</div>}><Harness /></Suspense>, {unstable_isConcurrent:true} as never); });
  const committed = app; const pending = createDeferred<object>(); mocks.load.mockReturnValue(pending.promise);
  let result: ReturnType<typeof app.submitTurn>;
  await act(async () => { result = committed.submitTurn('committed request'); });
  const suspended = createDeferred<void>();
  await act(async () => { startTransition(() => { renderer!.update(<Suspense fallback={<div>loading</div>}><Harness ready={false} suspended={suspended.promise} /></Suspense>); }); });
  expect(app).not.toBe(committed); // The uncommitted render really ran before suspension.
  expect(renderer!.root.findAllByType('textarea')).toHaveLength(1);
  await act(async () => { pending.resolve({}); await result; });
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});
it('waits for restored starter catalog and validates a target beyond the displayed top three before manual send', async () => {
  const todo=(id:string,createdAt:string)=>({id,title:`Task ${id}`,status:'todo',dueDate:null,createdAt});
  const selected=todo('selected','2026-01-04T00:00:00Z');mocks.todos.mockResolvedValue([selected]);
  await mount();await act(async()=>{renderer!.root.findByProps({className:'ai-planning-starter-list'}).findAllByType('button')[0].props.onClick()});
  await failSubmission();await act(async()=>{button('入力を一時保存して画面を更新').props.onClick()});
  act(()=>renderer!.unmount());renderer=undefined;resetWeeklyPlanningStableV5RuntimeSessionsForTest();mocks.load.mockResolvedValue({});
  const pending=createDeferred<object[]>();mocks.todos.mockReturnValue(pending.promise);await mount();
  expect(send().props.disabled).toBe(true);await act(async()=>{send().props.onClick()});expect(mocks.execute).not.toHaveBeenCalled();
  await act(async()=>{pending.resolve([todo('one','2026-01-01T00:00:00Z'),todo('two','2026-01-02T00:00:00Z'),todo('three','2026-01-03T00:00:00Z'),selected])});
  expect(send().props.disabled).toBe(false);expect(mocks.execute).not.toHaveBeenCalled();
  await act(async()=>{send().props.onClick()});expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.execute.mock.calls[0][0].selectedStarterTarget).toEqual({kind:'todo',id:'selected',label:'Task selected',targetDate:null});
});
it('a removed restored starter target fails before OCR instead of silently sending an ambiguous request',async()=>{
  mocks.todos.mockResolvedValue([{id:'selected',title:'Task selected',status:'todo',dueDate:null,createdAt:'2026-01-01T00:00:00Z'}]);
  await mount();await act(async()=>{renderer!.root.findByProps({className:'ai-planning-starter-list'}).findAllByType('button')[0].props.onClick()});await attach();
  await failSubmission();await act(async()=>{button('入力を一時保存して画面を更新').props.onClick()});
  act(()=>renderer!.unmount());renderer=undefined;resetWeeklyPlanningStableV5RuntimeSessionsForTest();mocks.load.mockResolvedValue({});mocks.todos.mockResolvedValue([]);await mount();
  const before=textInput().props.value;await act(async()=>{send().props.onClick()});expect(textInput().props.value).toBe(before);expect(mocks.ocr).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();expect(JSON.stringify(renderer!.toJSON())).toContain('参照先を確認できません');
});
it('keeps explicit reload available if navigation returns without replacing the document',async()=>{
  await mount();await type('draft');await failSubmission();await act(async()=>{button('入力を一時保存して画面を更新').props.onClick()});
  expect(mocks.reload).toHaveBeenCalledTimes(1);expect(textInput().props.disabled).toBe(false);expect(button('入力を一時保存して画面を更新').props.disabled).toBe(false);
});


it.each([false, true])('preflight data revocation across code loading retains exact composer without OCR (recovered=%s)', async (recovered) => {
  const authority = new PlannerDataReadAuthority();
  const load = authority.begin('user-1', '2026-10-05T00:00:00Z');
  authority.succeed(load.token, '2026-10-05T00:01:00Z');
  const lease = authority.captureProjectionLease()!;
  const isSnapshotCurrent = () => authority.isProjectionUsable(lease);
  await act(async () => { renderer = create(<Harness availability={authority.read()} isSnapshotCurrent={isSnapshotCurrent} />); });
  await type('  exact before OCR\n'); const file = await attach();
  const pending = createDeferred<object>(); mocks.load.mockReturnValue(pending.promise);
  await act(async () => { send().props.onClick(); });
  authority.requireActualMaterialReconciliation(lease, '2026-10-05T00:02:00Z');
  await act(async () => { renderer!.update(<Harness availability={authority.read()} isSnapshotCurrent={isSnapshotCurrent} />); });
  if (recovered) {
    const ticket = authority.beginReconciliation(lease, '2026-10-05T00:03:00Z')!;
    authority.acceptReconciliation(ticket, '2026-10-05T00:04:00Z');
    const currentLease = authority.captureProjectionLease()!;
    await act(async () => { renderer!.update(<Harness availability={authority.read()}
      isSnapshotCurrent={() => authority.isProjectionUsable(currentLease)} />); });
  }
  await act(async () => { pending.resolve({}); });
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.ocr).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  expect(app.state.messages).toHaveLength(0); expect(app.state.pendingTurn).toBeUndefined();
  expect(textInput().props.value).toBe('  exact before OCR\n');
  expect(renderer!.root.findByProps({ 'aria-label': `添付画像 ${file.name}` })).toBeDefined();
  expect(JSON.stringify(renderer!.toJSON())).toContain('学習データが更新されました');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('機能の読み込みを再試行');
  expect(textInput().props.disabled).toBe(false); expect(send().props.disabled).toBe(!recovered);
  expect(mocks.reload).not.toHaveBeenCalled();
  if (recovered) {
    await act(async () => { send().props.onClick(); });
    expect(mocks.ocr).toHaveBeenCalledTimes(1); expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(textInput().props.value).toBe('');
  }
});

it.each(['before-load', 'during-load'] as const)('module retry remains recoverable after data revocation %s without replaying the draft', async (phase) => {
  const authority = new PlannerDataReadAuthority();
  const load = authority.begin('user-1', '2026-10-05T00:00:00Z');
  authority.succeed(load.token, '2026-10-05T00:01:00Z');
  const lease = authority.captureProjectionLease()!;
  const isSnapshotCurrent = () => authority.isProjectionUsable(lease);
  await act(async () => { renderer = create(<Harness availability={authority.read()} isSnapshotCurrent={isSnapshotCurrent} />); });
  await type('  exact retry input\n'); const file = await attach(); await failSubmission();
  const pending = createDeferred<object>(); mocks.load.mockReturnValue(pending.promise);
  if (phase === 'before-load') authority.requireActualMaterialReconciliation(lease, '2026-10-05T00:02:00Z');
  await act(async () => { button('機能の読み込みを再試行').props.onClick(); });
  if (phase === 'during-load') authority.requireActualMaterialReconciliation(lease, '2026-10-05T00:02:00Z');
  await act(async () => { renderer!.update(<Harness availability={authority.read()} isSnapshotCurrent={isSnapshotCurrent} />); });
  await act(async () => { pending.resolve({}); });
  expect(mocks.load).toHaveBeenCalledTimes(phase === 'before-load' ? 1 : 2);
  expect(JSON.stringify(renderer!.toJSON())).toContain('学習データが更新されました。確認が終わったら「機能の読み込みを再試行」を押してから、もう一度送信してください。入力内容と画像は保持しています。');
  expect(button('機能の読み込みを再試行').props.disabled).toBe(false);
  expect(textInput().props.value).toBe('  exact retry input\n');
  expect(renderer!.root.findByProps({ 'aria-label': `添付画像 ${file.name}` })).toBeDefined();
  expect(textInput().props.disabled).toBe(false); expect(send().props.disabled).toBe(true);
  expect(mocks.ocr).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  expect(app.state.messages).toHaveLength(0); expect(app.state.pendingTurn).toBeUndefined();
  const ticket = authority.beginReconciliation(lease, '2026-10-05T00:03:00Z')!;
  authority.acceptReconciliation(ticket, '2026-10-05T00:04:00Z');
  const currentLease = authority.captureProjectionLease()!;
  await act(async () => { renderer!.update(<Harness availability={authority.read()}
    isSnapshotCurrent={() => authority.isProjectionUsable(currentLease)} />); });
  expect(send().props.disabled).toBe(true); // Still needs a successful code-only retry.
  await act(async () => { button('機能の読み込みを再試行').props.onClick(); });
  expect(send().props.disabled).toBe(false);
  expect(textInput().props.value).toBe('  exact retry input\n');
  expect(renderer!.root.findByProps({ 'aria-label': `添付画像 ${file.name}` })).toBeDefined();
  expect(mocks.ocr).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.reload).not.toHaveBeenCalled();
  await act(async () => { send().props.onClick(); });
  expect(mocks.ocr).toHaveBeenCalledTimes(1); expect(mocks.execute).toHaveBeenCalledTimes(1);
});
