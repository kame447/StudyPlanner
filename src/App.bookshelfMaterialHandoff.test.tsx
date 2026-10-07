import { forwardRef } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { BookshelfView } from './components/BookshelfView';
import type { PlannerAppSnapshot } from './components/PlannerAppBootstrap';
import { BookshelfMaterialDetail } from './components/BookshelfMaterialDetail';
import { PrimaryBottomNav } from './components/PrimaryBottomNav';
import { QuickEntryModal } from './components/QuickEntryModal';
import { QuickAddMenu } from './components/QuickAddMenu';
import { PlannerMutationScopeExpiredError } from './hooks/usePlannerMutationScope';
import { usePlannerDataState, type UsePlannerDataStateResult } from './hooks/usePlannerDataState';
import { createLocalPlannerRepository } from './repositories/createLocalPlannerRepository';
import { createLocalFixture, deferred, MemoryStorage, microtasks } from './repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from './repositories/repositoryContracts';
import type { StudyMaterial, User } from './types/domain';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('./repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
vi.mock('./lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => undefined }));
vi.mock('./features/weeklyPlanning/application/useWeeklyPlanningApplication', () => ({ useWeeklyPlanningApplication: () => ({ pendingDraftBlocks: [], canEditDraftBlocks: false }) }));
vi.mock('./hooks/useThemePreference', () => ({ useThemePreference: () => ({ themeMode: 'light', themePalette: 'forest' }) }));
vi.mock('./lib/appAccessGate', () => ({ isAppAccessGateEnabled: () => false, hasStoredAppAccessGrant: () => true }));
vi.mock('./components/PrimaryAppHeader', () => ({ PrimaryAppHeader: forwardRef(() => <header />) }));
vi.mock('./components/HomeScheduleView', () => ({ HomeScheduleView: () => null }));
vi.mock('./components/MonthView', () => ({ MonthView: () => null }));
vi.mock('./components/ScheduleToolbar', () => ({ ScheduleToolbar: () => null }));
vi.mock('./components/PlanEditorPanel', () => ({ PlanEditorPanel: () => null }));
vi.mock('./components/MyPageDialog', () => ({ MyPageDialog: () => null }));
vi.mock('./components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }));

const DATE = '2026-10-07';
const materialA: StudyMaterial = {
  id: 'material-a', userId: 'owner-a', name: '独自教材 A', subjectId: 'subject-a', subjectName: '情報科学',
  color: '#2f6fc2', status: 'active', paceEnabled: false, progressUnit: 'page', totalUnits: 0,
  currentUnit: 0, targetDate: '', createdAt: DATE, updatedAt: DATE,
};
const materialB: StudyMaterial = { ...materialA, id: 'material-b', name: '独自教材 B', subjectName: '数学' };
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
const showNotice = vi.fn();
function Harness({ owner = 'owner-a' }: { owner?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice });
  const unused = async (): Promise<never> => { throw new Error('outside material handoff'); };
  const snapshot: PlannerAppSnapshot = {
    ...state, user: { id: owner } as User, booting: false, notice: null, dismissNotice() {},
    signUpWithPassword: unused, signInWithPassword: unused, signInWithGoogle: unused,
    sendPasswordReset: unused, saveUserProfile: unused, signOut: unused,
    saveWeeklyApprovedPlan: unused, completeWeeklyApprovalOperation: unused,
  };
  return <App state={snapshot} />;
}
beforeEach(() => {
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { location: { pathname: '/' }, localStorage: storage });
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { body: { style: { overflow: '', overscrollBehavior: '' } } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden'); }));
  showNotice.mockClear();
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() {
  const fixture = createLocalFixture();
  await fixture.repository.upsertStudyMaterial(materialA);
  await fixture.repository.upsertStudyMaterial(materialB);
  boundary.repository = fixture.repository;
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner-a'); state.selectDate(DATE); });
  await act(async () => { renderer!.root.findByType(PrimaryBottomNav).props.onOpenBookshelf(); });
  expect(state.studyMaterials.map(item => item.id)).toEqual([materialA.id, materialB.id]);
  expect(renderer!.root.findAllByType(BookshelfView)).toHaveLength(1);
  return fixture;
}
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'object' ? text(child) : String(child)).join(''); }
function button(label: string) { return renderer!.root.findAllByType('button').find(node => text(node) === label)!; }
function title() { return renderer!.root.findByProps({ placeholder: '例: 英語課題 / 面接準備' }); }
function materialSelect() { return renderer!.root.findAllByType('select').find(node => node.findAllByType('option').some(option => option.props.value === materialA.id || option.props.value === materialB.id))!; }
async function openMaterial(material: StudyMaterial, source: 'detail' | 'menu' = 'detail') {
  const currentDetail = renderer!.root.findAllByType(BookshelfMaterialDetail)[0];
  if (currentDetail) await act(async () => currentDetail.props.onBack());
  await act(async () => { renderer!.root.findAllByProps({ 'aria-label': `${material.name}を開く` })[0].props.onClick({ stopPropagation() {} }); });
  if (source === 'detail') await act(async () => button('この教材を予定に追加').props.onClick());
  else {
    await act(async () => renderer!.root.findByType(BookshelfMaterialDetail).props.onOpenMenu());
    await act(async () => button('予定に追加').props.onClick());
  }
}
async function submit() { await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); }); }

it.each(['detail', 'menu'] as const)('preserves the %s material selection through real App save and local reload', async source => {
  const fixture = await mount();
  await openMaterial(materialA, source);
  expect(title().props.value).toBe(materialA.name);
  expect(button('時間指定').props.className).toContain('active');
  expect(renderer!.root.findByProps({ role: 'tab', 'aria-selected': true }).children).toEqual(['予定']);
  expect(materialSelect().props.value).toBe(materialA.id);
  expect(renderer!.root.findByProps({ placeholder: '数学' }).props.value).toBe(materialA.subjectName);
  // A user title edit must not infer away the explicit bookshelf choice.
  act(() => title().props.onChange({ target: { value: materialB.name } }));
  act(() => button('30分').props.onClick());
  await submit();
  expect(renderer!.root.findAllByType(QuickEntryModal)).toHaveLength(0);
  const freshRepository = createLocalPlannerRepository(fixture.storage);
  const saved = await freshRepository.getPlans('owner-a');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ userId: 'owner-a', title: materialB.name, subject: materialA.subjectName,
    date: DATE, startTime: '19:00', endTime: '19:30', materialId: materialA.id, materialName: materialA.name });
  expect(saved[0].id).toBeTruthy();
  expect(await fixture.repository.getTodos('owner-a')).toHaveLength(0);
  boundary.repository = freshRepository;
  await act(async () => { await state.loadPlannerData('owner-a'); });
  expect(state.plans).toEqual(saved);
});

it('starts a fresh context after close/reopen and leaves the generic schedule entry in Todo mode', async () => {
  await mount(); await openMaterial(materialA);
  const oldClose = renderer!.root.findByType(QuickEntryModal).props.onClose;
  await act(async () => button('閉じる').props.onClick());
  await openMaterial(materialB);
  await act(async () => oldClose());
  expect(title().props.value).toBe(materialB.name);
  expect(materialSelect().props.value).toBe(materialB.id);
  await act(async () => button('閉じる').props.onClick());
  await act(async () => renderer!.root.findByType(PrimaryBottomNav).props.onOpenSchedule());
  await act(async () => renderer!.root.findByType(QuickAddMenu).props.onAddStudy());
  expect(title().props.value).toBe('');
  expect(button('Todo').props.className).toContain('active');
});

it('retires a material context on owner replacement instead of carrying it into the new owner', async () => {
  await mount(); await openMaterial(materialA);
  act(() => button('30分').props.onClick());
  expect(button('保存').props.disabled).toBe(false);
  const oldSubmit = renderer!.root.findByType('form').props.onSubmit;
  await act(async () => renderer!.update(<Harness owner="owner-b" />));
  expect(renderer!.root.findAllByType(QuickEntryModal)).toHaveLength(0);
  await act(async () => { await oldSubmit({ preventDefault() {} }); });
  expect(await boundary.repository.getPlans('owner-a')).toHaveLength(0);
  expect(await boundary.repository.getPlans('owner-b')).toHaveLength(0);
  await act(async () => renderer!.update(<Harness />));
  expect(renderer!.root.findAllByType(QuickEntryModal)).toHaveLength(0);
});

it.each(['delete', 'archive'] as const)('does not silently save an unlinked plan after material %s', async operation => {
  const fixture = await mount(); await openMaterial(materialA);
  act(() => button('30分').props.onClick());
  if (operation === 'delete') await fixture.repository.deleteStudyMaterial('owner-a', materialA.id);
  else await fixture.repository.upsertStudyMaterial({ ...materialA, status: 'archived' });
  await act(async () => { await state.loadPlannerData('owner-a'); });
  expect(title().props.value).toBe(materialA.name);
  expect(button('保存').props.disabled).toBe(true);
  await submit();
  expect(await fixture.repository.getPlans('owner-a')).toHaveLength(0);
  act(() => materialSelect().props.onChange({ target: { value: materialB.id } }));
  await submit();
  expect((await fixture.repository.getPlans('owner-a'))[0].materialId).toBe(materialB.id);
});

it.each(['material', 'owner'] as const)('keeps a newer %s draft open when an older material save settles', async replacement => {
  const fixture = await mount(); await openMaterial(materialA);
  act(() => button('30分').props.onClick());
  const gate = deferred(); const entered = deferred();
  const original = fixture.repository.upsertPlan;
  boundary.repository = { ...fixture.repository, upsertPlan: async plan => { const saved = await original(plan); entered.resolve(); await gate.promise; return saved; } };
  let saved!: Promise<void>;
  await act(async () => { saved = renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); await entered.promise; });
  await act(async () => button('閉じる').props.onClick());
  if (replacement === 'owner') {
    await fixture.repository.upsertStudyMaterial({ ...materialB, userId: 'owner-b' });
    await act(async () => renderer!.update(<Harness owner="owner-b" />));
    await act(async () => { await state.loadPlannerData('owner-b'); });
    await act(async () => renderer!.root.findByType(PrimaryBottomNav).props.onOpenBookshelf());
  }
  await openMaterial(materialB);
  await act(async () => {
    gate.resolve();
    if (replacement === 'owner') await expect(saved).rejects.toBeInstanceOf(PlannerMutationScopeExpiredError);
    else await saved;
    await microtasks();
  });
  expect(title().props.value).toBe(materialB.name);
  expect(materialSelect().props.value).toBe(materialB.id);
  expect(await fixture.repository.getPlans('owner-b')).toHaveLength(0);
  expect((await fixture.repository.getPlans('owner-a'))[0].materialId).toBe(materialA.id);
});


it('keeps an actionable selector when the last material disappears and permits explicit unlinking', async () => {
  const fixture = await mount(); await openMaterial(materialA);
  act(() => button('30分').props.onClick());
  await fixture.repository.deleteStudyMaterial('owner-a', materialA.id);
  await fixture.repository.deleteStudyMaterial('owner-a', materialB.id);
  await act(async () => { await state.loadPlannerData('owner-a'); });
  expect(button('保存').props.disabled).toBe(true);
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('教材');
  const selector = renderer!.root.findAllByType('select').find(node => node.findAllByType('option').some(option => option.props.value === ''))!;
  act(() => selector.props.onChange({ target: { value: '' } }));
  await submit();
  expect((await fixture.repository.getPlans('owner-a'))[0]).toMatchObject({ title: materialA.name, materialId: null, materialName: '' });
});
