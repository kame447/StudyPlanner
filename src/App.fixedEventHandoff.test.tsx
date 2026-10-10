import { forwardRef } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { AiPlanningView } from './components/AiPlanningView';
import { MonthEventDialog } from './components/MonthEventDialog';
import type { PlannerAppSnapshot } from './components/PlannerAppBootstrap';
import { PrimaryBottomNav } from './components/PrimaryBottomNav';
import { QuickAddMenu } from './components/QuickAddMenu';
import { TimeWheelPicker } from './components/TimeRangeFields';
import type { WeeklyPlanningApplication } from './features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { loadWeeklyPlanningRuntimeModule } from './features/weeklyPlanning/application/weeklyPlanningRuntimeModule';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5';
import { usePlannerDataState, type UsePlannerDataStateResult } from './hooks/usePlannerDataState';
import { createLocalPlannerRepository } from './repositories/createLocalPlannerRepository';
import { createLocalFixture, MemoryStorage, microtasks } from './repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from './repositories/repositoryContracts';
import type { OpenAiCompatibleClient } from './services/ai/openAiCompatibleClient';
import type { ScheduleEvent } from './domain/scheduleEvent';
import type { User } from './types/domain';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository,
  provider: vi.fn<OpenAiCompatibleClient['createChatCompletion']>() }));
vi.mock('./repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
vi.mock('./lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test-model', apiKey: 'test-key' }),
  getAiConfigValidationMessage: () => undefined,
}));
vi.mock('./services/ai/openAiCompatibleClient', () => ({ createOpenAiCompatibleClient: () => ({ createChatCompletion: boundary.provider }) }));
// Replace peripheral surfaces and the DOM portal only. App, AI view/application,
// normalizer/controller, calendar, dialog, planner mutations and storage are real.
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
vi.mock('./lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => undefined }));
vi.mock('./hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./components/PrimaryAppHeader', () => ({ PrimaryAppHeader: forwardRef(() => <header />) }));
vi.mock('./components/HomeScheduleView', () => ({ HomeScheduleView: () => null }));
vi.mock('./components/ScheduleToolbar', () => ({ ScheduleToolbar: () => null }));
vi.mock('./components/PlanEditorPanel', () => ({ PlanEditorPanel: () => null }));
vi.mock('./components/MyPageDialog', () => ({ MyPageDialog: () => null }));
vi.mock('./components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }));

const DATE = '2026-08-17';
const USER_TEXT = '8月17日から23日の予定です。8月17日の10:30から12:00の部活を登録したいです。';
const document: WeeklyPlanningSemanticDocumentV5 = {
  schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'create_plan',
  planningWindow: { localId: 'window', kind: 'absolute', value: '2026-08-17/2026-08-23',
    start: DATE, end: '2026-08-23', sourceText: '8月17日から23日' },
  tasks: [{ localId: 'club', category: 'non_study', title: '部活', study: null,
    workloads: [], effortEstimates: [], recurrence: [], sourceText: USER_TEXT,
    temporalConstraints: [{ localId: 'club-time', targetLocalId: 'club', kind: 'fixed_interval',
      constraintLevel: 'hard', dateExpression: DATE, namedTimePeriod: null,
      startTime: '10:30', endTime: '12:00', precision: 'exact', sourceText: USER_TEXT }] }],
  relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
  conversationActs: [{ kind: 'request_event_registration', targetPublicId: null }],
};
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
const saveWeeklyApprovedPlan = vi.fn<PlannerAppSnapshot['saveWeeklyApprovedPlan']>();
const completeWeeklyApprovalOperation = vi.fn<NonNullable<PlannerAppSnapshot['completeWeeklyApprovalOperation']>>();
const showNotice = vi.fn();
function Harness() {
  state = usePlannerDataState({ userId: 'owner-handoff', showNotice });
  const unused = async (): Promise<never> => { throw new Error('outside fixed-event handoff'); };
  const snapshot: PlannerAppSnapshot = {
    ...state, user: { id: 'owner-handoff' } as User, booting: false, notice: null, dismissNotice() {},
    signUpWithPassword: unused, signInWithPassword: unused, signInWithGoogle: unused,
    sendPasswordReset: unused, saveUserProfile: unused, signOut: unused,
    saveWeeklyApprovedPlan, completeWeeklyApprovalOperation,
  };
  return <App state={snapshot} />;
}
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'object' ? text(child) : String(child)).join(''); }
function button(label: string) { return renderer!.root.findAllByType('button').find(node => text(node) === label)!; }
function application(): WeeklyPlanningApplication { return renderer!.root.findByType(AiPlanningView).props.application; }
const click = async (node: ReactTestInstance) => { await act(async () => { node.props.onClick(); await microtasks(); }); };
async function openManualEntry() {
  await click(renderer!.root.findByProps({ 'aria-label': 'クイック追加メニューを開く' }));
  await click(button('予定を追加'));
  expect(renderer!.root.findAllByType(MonthEventDialog)).toHaveLength(1);
  expect(renderer!.root.findByProps({ 'aria-label': 'タイトル' }).props.value).toBe('');
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-08-12T00:00:00Z'));
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { location: { pathname: '/' }, localStorage: storage, sessionStorage: new MemoryStorage(),
    matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, performance });
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { documentElement: { dataset: {}, style: {} }, body: { style: {} } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden'); }));
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  saveWeeklyApprovedPlan.mockReset().mockRejectedValue(new Error('AI plan save forbidden'));
  completeWeeklyApprovalOperation.mockReset().mockRejectedValue(new Error('AI approval forbidden'));
  showNotice.mockReset();
  boundary.provider.mockReset().mockImplementation(async request => {
    if (request.responseFormat?.json_schema.name === 'weekly_planning_semantic_document_v5') return JSON.stringify(document);
    if (request.responseFormat?.json_schema.name === 'weekly_planning_stable_v5_dialogue_response') {
      const body = JSON.parse(request.messages[request.messages.length - 1].content);
      return JSON.stringify({ actionId: body.actionId, actionKind: body.applicationDecision.actionKind,
        questionCode: body.applicationDecision.questionCode, groundingAcknowledgement: null,
        text: '部活の時間を確認しました。保存する場合は「予定」から「予定を追加」を開いて入力できます。' });
    }
    throw new Error(`Unexpected provider schema: ${request.responseFormat?.json_schema.name}`);
  });
  // Real module loading is setup; no turn, renderer, or persistence is mocked.
  await loadWeeklyPlanningRuntimeModule();
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers();
});

it('hands an actual AI fixed-event turn to the existing manual entry and saves only after explicit user input', async () => {
  const fixture = createLocalFixture();
  boundary.repository = fixture.repository;
  const savePlan = vi.spyOn(fixture.repository, 'upsertPlan');
  const saveEvent = vi.spyOn(fixture.repository, 'upsertMonthEvent');
  const writePlans = vi.spyOn(fixture.gateway, 'writePlans');
  const writeEvents = vi.spyOn(fixture.gateway, 'writeMonthEvents');
  const storageWrite = vi.spyOn(fixture.storage, 'setItem');
  const canonicalWrites = () => storageWrite.mock.calls.filter(([key]) => key === 'studyplanner.scheduleEvents.v1')
    .map(([, value]) => JSON.parse(value) as ScheduleEvent[]);
  const eventWrites = () => canonicalWrites().filter(events => events.length > 0);
  const assertNoWrites = () => {
    expect(savePlan).not.toHaveBeenCalled(); expect(saveEvent).not.toHaveBeenCalled();
    expect(writePlans).not.toHaveBeenCalled(); expect(writeEvents).not.toHaveBeenCalled();
    // A successful empty-source migration may write []; it creates no event.
    expect(canonicalWrites().every(events => events.length === 0)).toBe(true);
    expect(saveWeeklyApprovedPlan).not.toHaveBeenCalled(); expect(completeWeeklyApprovalOperation).not.toHaveBeenCalled();
  };
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner-handoff'); state.selectDate(DATE); });
  await click(button('AI計画'));
  expect(application().plannerDataReady).toBe(true);
  await act(async () => { renderer!.root.findByType('textarea').props.onChange({ target: { value: USER_TEXT } }); });
  expect(renderer!.root.findByProps({ 'aria-label': '送信' }).props.disabled).toBe(false);
  await click(renderer!.root.findByProps({ 'aria-label': '送信' }));
  await act(async () => { await vi.waitFor(() => {
    expect(boundary.provider).toHaveBeenCalledTimes(2);
    expect(application().state.pendingTurn).toBeFalsy();
    expect(application().state.intakeState?.shouldSavePlan).toBe(false);
  }); });
  expect(boundary.provider.mock.calls.map(([request]) => request.responseFormat?.json_schema.name))
    .toEqual(['weekly_planning_semantic_document_v5', 'weekly_planning_stable_v5_dialogue_response']);
  await expect(boundary.provider.mock.results[0].value).resolves.toBe(JSON.stringify(document));
  const semanticRequest = boundary.provider.mock.calls[0][0];
  expect(semanticRequest.messages[semanticRequest.messages.length - 1].content).toContain(USER_TEXT);
  const rendererRequest = boundary.provider.mock.calls[1][0];
  const rendererBody = JSON.parse(rendererRequest.messages[rendererRequest.messages.length - 1].content);
  expect(rendererBody.applicationDecision.communication).toMatchObject({ statusReason: 'fixed_event_manual_entry',
    manualEntry: { navigationLabel: '予定', actionLabel: '予定を追加', eventCreatedByTurn: false } });
  expect(application().state.messages[application().state.messages.length - 1].content)
    .toBe(JSON.parse(await boundary.provider.mock.results[1].value).text);
  expect(application().state.intakeState?.lastQuestionContext).toBeUndefined();
  expect(application().state.previewCandidates).toEqual([]);
  expect(application().pendingDraftBlocks).toEqual([]);
  expect(application().approvalAvailability).toMatchObject({ kind: 'blocked', reason: 'no_draft_blocks' });
  expect(application().exportConversationSnapshot()!.graph.temporalConstraints).toHaveLength(1);
  expect(renderer!.root.findAllByType(QuickAddMenu)).toHaveLength(0);
  expect(renderer!.root.findByType(PrimaryBottomNav).props.active).toBe('ai-planning');
  assertNoWrites();
  expect(await fixture.repository.getPlans('owner-handoff')).toEqual([]);
  expect(await fixture.repository.getMonthEvents('owner-handoff')).toEqual([]);

  await click(button('予定'));
  await openManualEntry(); assertNoWrites();
  await click(button('閉じる'));
  expect(renderer!.root.findAllByType(MonthEventDialog)).toHaveLength(0);
  assertNoWrites();
  await openManualEntry();
  await act(async () => { renderer!.root.findByProps({ 'aria-label': 'タイトル' }).props.onChange({ target: { value: '手動で入力した部活' } }); });
  await act(async () => { renderer!.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: false } }); });
  await act(async () => { renderer!.root.findAllByType(TimeWheelPicker).find(node => node.props.role === 'start')!.props.onChange('10:30'); });
  await act(async () => { renderer!.root.findAllByType(TimeWheelPicker).find(node => node.props.role === 'end')!.props.onChange('12:00'); });
  assertNoWrites();
  expect(button('保存').props.disabled).toBe(false);
  await click(button('保存'));
  await act(async () => { await vi.waitFor(() => expect(state.monthEvents).toHaveLength(1)); });
  expect(saveEvent).toHaveBeenCalledTimes(1);
  expect(writeEvents).not.toHaveBeenCalled(); // Legacy arrays are not the canonical writer.
  expect(eventWrites()).toHaveLength(1);
  expect(eventWrites()[0]).toEqual([expect.objectContaining({ userId: 'owner-handoff',
    kind: 'general', title: '手動で入力した部活', date: DATE, startTime: '10:30', endTime: '12:00',
    provenance: expect.objectContaining({ legacy: expect.objectContaining({ kind: 'month-event' }) }) })]);
  expect(savePlan).not.toHaveBeenCalled(); expect(writePlans).not.toHaveBeenCalled();
  expect(saveWeeklyApprovedPlan).not.toHaveBeenCalled(); expect(completeWeeklyApprovalOperation).not.toHaveBeenCalled();
  const freshRepository = createLocalPlannerRepository(fixture.storage);
  const saved = await freshRepository.getMonthEvents('owner-handoff');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ userId: 'owner-handoff', title: '手動で入力した部活', date: DATE,
    endDate: DATE, startTime: '10:30', endTime: '12:00', repeat: 'none' });
  expect(saved[0].id).toBeTruthy();
  expect(eventWrites()[0][0].provenance.legacy.id).toBe(saved[0].id);
  expect(await freshRepository.getPlans('owner-handoff')).toEqual([]);
  boundary.repository = freshRepository;
  await act(async () => { await state.loadPlannerData('owner-handoff'); });
  expect(state.monthEvents).toEqual(saved);
  expect(eventWrites()).toHaveLength(1);
  expect(boundary.provider).toHaveBeenCalledTimes(2);
});
