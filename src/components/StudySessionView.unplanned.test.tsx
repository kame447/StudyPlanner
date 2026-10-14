import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GettingStartedSection, NextPlanSection } from './home/HomeSections';
import { StudySessionProvider, useStudySessionLauncher } from './StudySessionView';
import { ActualMutationAdmissionError } from '../hooks/useActualMutationAdmission';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import { createLocalFixture, deferred, plan } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { ActualDraft, Plan, StudyMaterial } from '../types/domain';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof PlannerRepository] }) }));
vi.mock('./home/HomeScene', () => ({ HomeScene: () => null }));
const notice = vi.fn();
const openDay = vi.fn();
const openAi = vi.fn();
const book: StudyMaterial = { id: 'book', userId: 'owner', name: '数学の本', subjectId: 'math', subjectName: '数学', status: 'active', paceEnabled: true, progressUnit: 'page', currentUnit: 10, totalUnits: 100, createdAt: '', updatedAt: '' };
const futurePlan = plan({ date: '2026-10-08', startTime: '19:00', endTime: '20:00', title: '明日の学習', materialId: book.id, materialName: book.name });
let renderer: ReactTestRenderer | undefined;
let state: UsePlannerDataStateResult;
let launch: NonNullable<ReturnType<typeof useStudySessionLauncher>>;
let fixture: ReturnType<typeof createLocalFixture>;
let linked: ReturnType<typeof vi.fn<(plan: Plan, draft: ActualDraft) => Promise<void>>>;
let standalone: ReturnType<typeof vi.fn<(draft: ActualDraft) => Promise<void>>>;
function Probe() { launch = useStudySessionLauncher()!; return null; }
function Harness({ owner = 'owner', nextPlan = null }: { owner?: string; nextPlan?: Plan | null }) {
  state = usePlannerDataState({ userId: owner, showNotice: notice });
  const dashboard = { ...buildHomeDashboardModel({ plans: [], actuals: [], todos: [] }), nextPlan };
  return <StudySessionProvider userId={owner} materials={[book, { ...book, id: 'foreign', userId: 'other', name: 'Other book' }, { ...book, id: 'archived', status: 'archived' }]} onSaveActual={linked} onSaveStandaloneActual={standalone}>
    <Probe />
    <NextPlanSection dashboard={dashboard} studyMaterials={[book]} onOpenAiPlanning={openAi} onOpenDay={openDay} />
  </StudySessionProvider>;
}
function button(text: string) { return renderer!.root.findAllByType('button').find(node => node.children.includes(text))!; }
async function click(text: string) { await act(async () => { button(text).props.onClick(); }); }
async function change(props: Record<string, unknown>, value: string) { await act(async () => { renderer!.root.findByProps(props).props.onChange({ target: { value } }); }); }
async function back() { await act(async () => { renderer!.root.findByProps({ 'aria-label': '戻る' }).props.onClick(); }); }
async function mount(nextPlan: Plan | null = null, page?: { scrollTop: number }) {
  await act(async () => { renderer = create(<Harness nextPlan={nextPlan} />, {
    createNodeMock: element => element.props.className === 'study-session-page' ? page ?? null : null,
  }); });
  await act(async () => { await state.loadPlannerData('owner'); });
}
async function startAndFinish() {
  await click('スタート');
  vi.setSystemTime(new Date('2026-10-07T12:05:00'));
  await click('終了する');
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T12:00:00'));
  vi.stubGlobal('window', { setInterval, clearInterval, confirm: vi.fn(() => true) });
  vi.stubGlobal('document', { body: { style: { overflow: '' } } });
  fixture = createLocalFixture();
  fixture.storage.setItem('studyplanner.plans', JSON.stringify([futurePlan]));
  fixture.storage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([book]));
  boundary.repository = fixture.repository;
  linked = vi.fn(async (plan, draft) => { await state.saveActual(plan, draft); });
  standalone = vi.fn(async draft => { await state.saveStandaloneActual(draft); });
  notice.mockClear(); openDay.mockClear(); openAi.mockClear();
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });

it('starts from an empty Home and persists an unplanned Actual without creating a Plan', async () => {
  const savedPlans = await fixture.repository.getPlans('owner');
  await mount(); await click('勉強を開始');
  expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('学習を開始');
  expect(renderer!.root.findByProps({ 'data-study-session-elapsed': true }).children).toEqual(['00:00:00']);
  expect(openAi).not.toHaveBeenCalled();
  await change({ 'aria-label': '勉強する内容' }, '自主練習');
  await startAndFinish(); await click('記録を保存');
  expect(linked).not.toHaveBeenCalled();
  expect(standalone).toHaveBeenCalledTimes(1);
  expect(await fixture.repository.getActuals('owner')).toEqual([expect.objectContaining({ userId: 'owner', planId: null, occurrenceDate: '2026-10-07', actualStartTime: '12:00', actualEndTime: '12:05', title: '自主練習', isAlignedToPlan: false })]);
  expect(await fixture.repository.getPlans('owner')).toEqual(savedPlans);
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
});

it('class Home keeps an accessible schedule button while its primary action starts unplanned study', async () => {
  const classPlan = { ...futurePlan, sourceType: 'timetable' as const, title: '数学の授業' };
  await mount(classPlan);
  const inspect = renderer!.root.findByProps({ className: 'home-plan-inspect' });
  expect(inspect.type).toBe('button');
  expect(inspect.props.type).toBe('button');
  expect(inspect.props['aria-label']).toContain('授業を確認');
  await act(async () => { inspect.props.onClick(); });
  expect(openDay).toHaveBeenCalledWith(classPlan.date);
  await click('勉強を開始'); await startAndFinish(); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ planId: null, occurrenceDate: '2026-10-07' }));
  expect(linked).not.toHaveBeenCalled();
});

it('makes the next-study association explicit and permits an unrelated session dated today', async () => {
  await mount(futurePlan); await click('勉強を開始');
  const choice = renderer!.root.findByProps({ 'aria-label': '学習内容' });
  expect(choice.props.value).toBe('planned');
  expect(renderer!.root.findAllByType('dd').some(node => node.children.includes(futurePlan.date))).toBe(true);
  expect(choice.findAllByType('option').map(node => node.children.join(''))).toEqual(['この予定で学習: 明日の学習', '予定にない学習']);
  await change({ 'aria-label': '学習内容' }, 'unplanned');
  await startAndFinish(); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ planId: null, occurrenceDate: '2026-10-07' }));
  expect(linked).not.toHaveBeenCalled();
});

it('preserves deliberate planned recording and material progress', async () => {
  await mount(futurePlan); await click('勉強を開始'); await startAndFinish();
  await change({ id: 'study-session-progress' }, '3'); await click('記録を保存');
  expect(linked).toHaveBeenCalledWith(futurePlan, expect.objectContaining({ planId: futurePlan.id, occurrenceDate: futurePlan.date }));
  expect(standalone).not.toHaveBeenCalled();
  expect((await fixture.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(13);
});

it('offers only the current owner active materials and saves standalone progress through the existing command', async () => {
  await mount(); await click('勉強を開始');
  expect(renderer!.root.findByProps({ 'aria-label': '教材' }).findAllByType('option').map(node => node.props.value)).toEqual(['', 'book']);
  await change({ 'aria-label': '教材' }, 'book'); await startAndFinish();
  await change({ id: 'study-session-progress' }, '5'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ title: book.name, subject: book.subjectName, materialId: book.id, planId: null }));
  expect((await fixture.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(15);
});

it('retained launch and start callbacks cannot replace or reset a running session', async () => {
  await mount(); await click('勉強を開始');
  const retainedStart = button('スタート').props.onClick;
  await act(async () => { retainedStart(); });
  vi.setSystemTime(new Date('2026-10-07T12:04:00'));
  await act(async () => { launch({ kind: 'unplanned' }); retainedStart(); });
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ actualStartTime: '12:00', actualEndTime: '12:04' }));
});

it('same-render duplicate saves dispatch exactly one standalone creation', async () => {
  await mount(); await click('勉強を開始'); await startAndFinish();
  const pending = deferred(); standalone.mockImplementation(() => pending.promise);
  const save = button('記録を保存').props.onClick;
  await act(async () => { save(); save(); });
  expect(standalone).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(); });
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
});

it('pause/resume keeps the local start date, and returning from record retains edited input', async () => {
  await mount(); await click('勉強を開始'); await click('スタート');
  vi.setSystemTime(new Date('2026-10-07T12:02:00')); await click('一時停止');
  vi.setSystemTime(new Date('2026-10-07T12:12:00')); await click('再開');
  vi.setSystemTime(new Date('2026-10-07T12:15:00')); await click('終了する');
  const content = renderer!.root.findAllByType('label').find(node => node.children.includes('実際にやった内容'))!.findByType('input');
  await act(async () => { content.props.onChange({ target: { value: '残した内容' } }); });
  await change({ rows: 3 }, '残したメモ');
  await back(); await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ title: '残した内容', note: '残したメモ', actualStartTime: '12:00', actualEndTime: '12:05', occurrenceDate: '2026-10-07' }));
});

it('a same-date calculated range still requires inspection when wall time crossed midnight during a pause', async () => {
  vi.setSystemTime(new Date('2026-10-07T23:50:00'));
  await mount(); await click('勉強を開始'); await click('スタート');
  vi.setSystemTime(new Date('2026-10-07T23:51:00')); await click('一時停止');
  vi.setSystemTime(new Date('2026-10-08T00:01:00')); await click('再開');
  vi.setSystemTime(new Date('2026-10-08T00:02:00')); await click('終了する');
  await click('記録を保存');
  expect(standalone).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByProps({ role: 'alert' }).some(node => node.children.join('').includes('日付をまたいだ'))).toBe(true);
});

it('cross-midnight unplanned capture retains the start date and draft until the user adjusts its range', async () => {
  vi.setSystemTime(new Date('2026-10-07T23:58:00'));
  await mount(); await click('勉強を開始'); await change({ 'aria-label': '勉強する内容' }, '夜の復習'); await click('スタート');
  vi.setSystemTime(new Date('2026-10-08T00:03:00')); await click('終了する');
  await change({ rows: 3 }, '翌日分を別途記録'); await click('記録を保存');
  expect(standalone).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByProps({ role: 'alert' }).some(node => node.children.join('').includes('日付をまたいだ'))).toBe(true);
  const endInput = renderer!.root.findAllByType('input').find(node => node.props.type === 'time' && node.props.value === '00:03')!;
  await act(async () => { endInput.props.onChange({ target: { value: '00:00' } }); });
  await back(); await click('終了する');
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ occurrenceDate: '2026-10-07', title: '夜の復習', note: '翌日分を別途記録', actualEndTime: '00:00' }));
});

it('busy rejection permits explicit retry and uncertain failure retains the draft without replay', async () => {
  await mount(); await click('勉強を開始'); await startAndFinish(); await change({ rows: 3 }, '失いたくない入力');
  standalone.mockRejectedValueOnce(new ActualMutationAdmissionError('保存・更新中です'));
  await click('記録を保存');
  expect(button('記録を保存').props.disabled).toBe(false);
  standalone.mockRejectedValueOnce(new Error('ack lost'));
  const retainedSave = button('記録を保存').props.onClick;
  await click('記録を保存');
  expect(renderer!.root.findByProps({ rows: 3 }).props.value).toBe('失いたくない入力');
  expect(button('記録を保存').props.disabled).toBe(true);
  await act(async () => { retainedSave(); });
  await click('記録を保存'); await back(); await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findByProps({ rows: 3 }).props.value).toBe('失いたくない入力');
});

it('owner replacement discards visible old sessions and rejects retained save/launch callbacks', async () => {
  await mount(); await click('勉強を開始'); await startAndFinish();
  const staleLaunch = launch;
  const staleSave = button('記録を保存').props.onClick;
  await act(async () => { renderer!.update(<Harness owner="other" />); });
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  await act(async () => { staleLaunch({ kind: 'unplanned' }); staleSave(); });
  expect(standalone).not.toHaveBeenCalled();
  await act(async () => { renderer!.update(<Harness owner="owner" />); staleLaunch({ kind: 'unplanned' }); });
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
});

it('cancelled close keeps the session, and old successful saves cannot close a newly opened one', async () => {
  await mount(); await click('勉強を開始'); await startAndFinish();
  const pending = deferred(); standalone.mockImplementation(() => pending.promise); await click('記録を保存');
  await back(); vi.mocked(window.confirm).mockReturnValueOnce(false); await back();
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
  await back(); await click('勉強を開始'); await change({ 'aria-label': '勉強する内容' }, '新しい学習');
  await act(async () => { pending.resolve(); });
  expect(renderer!.root.findByProps({ 'aria-label': '勉強する内容' }).props.value).toBe('新しい学習');
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
});

it('the first-use setup exposes the same unplanned launcher without a required registration', async () => {
  await act(async () => { renderer = create(<StudySessionProvider userId="owner" materials={[]} onSaveActual={linked} onSaveStandaloneActual={standalone}>
    <GettingStartedSection onOpenAiPlanning={openAi} onOpenSchedule={() => {}} onOpenTodo={() => {}} onOpenBookshelf={() => {}} />
  </StudySessionProvider>); });
  const start = renderer!.root.findAllByType('button').find(node => node.findAllByType('strong').some(child => child.children.includes('勉強を開始')))!;
  await act(async () => { start.props.onClick(); });
  expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('学習を開始');
  expect(renderer!.root.findByProps({ 'aria-label': '教材' }).findAllByType('option')).toHaveLength(1);
});

it('empty adjusted times cannot bypass range validation with NaN', async () => {
  await mount(); await click('勉強を開始'); await startAndFinish();
  const start = renderer!.root.findAllByType('input').find(node => node.props.type === 'time' && node.props.value === '12:00')!;
  await act(async () => { start.props.onChange({ target: { value: '' } }); });
  await click('記録を保存');
  expect(standalone).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('終了時刻');
});

it('paused round trips after busy rejection preserve manual times and all draft input', async () => {
  await mount(); await click('勉強を開始'); await startAndFinish();
  const times = renderer!.root.findAllByType('input').filter(node => node.props.type === 'time');
  await act(async () => { times[0].props.onChange({ target: { value: '11:58' } }); });
  await act(async () => { renderer!.root.findAllByType('input').filter(node => node.props.type === 'time')[1].props.onChange({ target: { value: '12:03' } }); });
  await change({ rows: 3 }, '修正した時刻を保持');
  standalone.mockRejectedValueOnce(new ActualMutationAdmissionError('保存・更新中です'));
  await click('記録を保存');
  for (let count = 0; count < 2; count++) { await back(); await click('終了する'); }
  await click('記録を保存');
  expect(standalone).toHaveBeenLastCalledWith(expect.objectContaining({ actualStartTime: '11:58', actualEndTime: '12:03', note: '修正した時刻を保持' }));
});

it('resumed measurement refreshes its range while preserving other edited record fields', async () => {
  await mount(); await click('勉強を開始'); await startAndFinish();
  await act(async () => { renderer!.root.findAllByType('input').filter(node => node.props.type === 'time')[1].props.onChange({ target: { value: '12:03' } }); });
  await change({ rows: 3 }, '続けて学習');
  await back(); await click('再開');
  vi.setSystemTime(new Date('2026-10-07T12:06:00'));
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ actualStartTime: '12:00', actualEndTime: '12:06', note: '続けて学習' }));
});


it.each([{ label: 'planned', nextPlan: futurePlan }, { label: 'unplanned', nextPlan: null }])('resets only phase navigation scroll for $label study while retaining edited fields', async ({ nextPlan }) => {
  const page = { scrollTop: 0 };
  await mount(nextPlan, page); await click('勉強を開始');
  page.scrollTop = 144;
  await click('スタート');
  expect(page.scrollTop).toBe(144);
  vi.setSystemTime(new Date('2026-10-07T12:05:00'));
  await click('終了する');
  expect(page.scrollTop).toBe(0);
  page.scrollTop = 111;
  await change({ rows: 3 }, 'スクロール後も入力を保持');
  expect(page.scrollTop).toBe(111);
  await back();
  expect(page.scrollTop).toBe(0);
  page.scrollTop = 144;
  await click('終了する');
  expect(page.scrollTop).toBe(0);
  expect(renderer!.root.findByProps({ rows: 3 }).props.value).toBe('スクロール後も入力を保持');
});

it('keeps planned context once, behind an optional disclosure, without repeated start explanations', async () => {
  const planned = { ...futurePlan, memo: '読み直すページを確認' };
  await mount(planned); await click('勉強を開始');
  const dialog = renderer!.root.findByProps({ role: 'dialog' });
  const context = dialog.findByProps({ className: 'study-session-details' });
  expect(context.type).toBe('details');
  expect(context.props.open).toBeUndefined();
  expect(context.findByType('summary').children).toEqual(['詳細']);
  expect(context.findAllByType('dd').map(node => node.children.join(''))).toEqual([planned.title, planned.subject, book.name, planned.memo].filter(Boolean));
  expect(dialog.findAllByProps({ className: 'study-session-helper' })).toHaveLength(0);
  expect(dialog.findAllByProps({ className: 'study-session-card study-session-context-card' })).toHaveLength(0);
  expect(dialog.findByProps({ 'aria-label': '学習内容' }).props.value).toBe('planned');
  expect(dialog.findAllByType('h2')).toHaveLength(0);
  expect(dialog.findByProps({ 'data-study-session-elapsed': true }).props['aria-label']).toBe('経過時間');
});

it('retains accessible mode controls and the break-inclusion notice before explicit start', async () => {
  await mount(futurePlan); await click('勉強を開始');
  await change({ 'aria-label': '学習内容' }, 'unplanned');
  const picker = renderer!.root.findByProps({ role: 'group', 'aria-label': '学習方式' });
  const [normal, pomodoro] = picker.findAllByType('button');
  expect(normal.props['aria-pressed']).toBe(true);
  await act(async () => { pomodoro.props.onClick(); });
  expect(pomodoro.props['aria-pressed']).toBe(true);
  expect(renderer!.root.findByProps({ 'data-study-session-phase-remaining': true }).children).toEqual(['25:00']);
  expect(renderer!.root.findAllByType('small').some(node => node.children.includes('休憩を含めて記録'))).toBe(true);
  expect(renderer!.root.findByProps({ 'aria-label': '勉強する内容' }).props.value).toBe('');
  await click('スタート');
  expect(pomodoro.props.disabled).toBe(true);
  expect(normal.props.disabled).toBe(true);
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledTimes(1);
  expect(linked).not.toHaveBeenCalled();
});


it('keeps the entire planned title readable before start even without other details', async () => {
  const title = '長い学習内容を開始前に確認するためのタイトル'.repeat(10);
  const planned = { ...futurePlan, title, subject: '', memo: '', materialId: null, materialName: '' };
  await mount(planned); await click('勉強を開始');
  const details = renderer!.root.findByProps({ className: 'study-session-details' });
  expect(details.props.open).toBeUndefined();
  expect(details.findAllByType('dd').map(node => node.children.join(''))).toEqual([title]);
});

async function choosePomodoro() {
  const picker = renderer!.root.findByProps({ role: 'group', 'aria-label': '学習方式' });
  await act(async () => { picker.findAllByType('button')[1].props.onClick(); });
}
async function openPomodoroSettings() {
  await act(async () => { renderer!.root.findByProps({ 'aria-label': '集中と休憩の設定' }).props.onClick(); });
}

it('keeps Pomodoro settings on a separate screen and saves them without starting or losing study inputs', async () => {
  await mount(futurePlan); await click('勉強を開始');
  await change({ 'aria-label': '学習内容' }, 'unplanned');
  await change({ 'aria-label': '勉強する内容' }, '設定を変えても残す');
  await change({ 'aria-label': '教材' }, 'book');
  await choosePomodoro(); await openPomodoroSettings();
  expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('ポモドーロ設定');
  expect(renderer!.root.findAllByProps({ 'aria-label': '勉強する内容' })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ className: 'study-session-timer-ring' })).toHaveLength(0);
  await click('50分 / 10分');
  await change({ 'aria-label': 'セット数' }, '3');
  await click('設定を保存');
  expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('学習を開始');
  expect(renderer!.root.findByProps({ 'data-study-session-phase-remaining': true }).children).toEqual(['50:00']);
  expect(renderer!.root.findByProps({ 'aria-label': '勉強する内容' }).props.value).toBe('設定を変えても残す');
  expect(renderer!.root.findByProps({ 'aria-label': '教材' }).props.value).toBe('book');
  expect(standalone).not.toHaveBeenCalled();
  await openPomodoroSettings();
  expect(renderer!.root.findByProps({ 'aria-label': 'セット数' }).props.value).toBe(3);
  expect(button('50分 / 10分').props['aria-pressed']).toBe(true);
});

it('Back discards unsaved settings while keeping committed values and the study target', async () => {
  const page = { scrollTop: 0 };
  await mount(futurePlan, page); await click('勉強を開始'); await choosePomodoro();
  page.scrollTop = 50;
  await openPomodoroSettings(); expect(page.scrollTop).toBe(0);
  await click('50分 / 10分'); await change({ 'aria-label': 'セット数' }, '2');
  page.scrollTop = 150;
  await back(); expect(page.scrollTop).toBe(0);
  expect(renderer!.root.findByProps({ 'data-study-session-phase-remaining': true }).children).toEqual(['25:00']);
  expect(renderer!.root.findByProps({ 'aria-label': '学習内容' }).props.value).toBe('planned');
  await openPomodoroSettings();
  expect(renderer!.root.findByProps({ 'aria-label': 'セット数' }).props.value).toBe('');
  expect(button('25分 / 5分').props['aria-pressed']).toBe(true);
  expect(window.confirm).not.toHaveBeenCalled();
});

it('retained settings and start callbacks cannot start from settings or modify an active session', async () => {
  await mount(); await click('勉強を開始'); await choosePomodoro();
  const start = button('スタート').props.onClick;
  const open = renderer!.root.findByProps({ 'aria-label': '集中と休憩の設定' }).props.onClick;
  await openPomodoroSettings();
  await act(async () => { start(); });
  expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('ポモドーロ設定');
  await click('50分 / 10分'); await change({ 'aria-label': 'セット数' }, '1');
  const saveSettings = button('設定を保存').props.onClick;
  await back(); await click('スタート');
  await act(async () => { open(); saveSettings(); });
  expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('学習中');
  expect(renderer!.root.findByProps({ 'data-study-session-phase-remaining': true }).children).toEqual(['25:00']);
  expect(renderer!.root.findAllByProps({ 'aria-label': '集中と休憩の設定' })).toHaveLength(0);
});

it.each([{ preset: '25分 / 5分', focus: 25, cycle: 30 }, { preset: '50分 / 10分', focus: 50, cycle: 60 }])('stops at one complete $preset set, retaining explicit record review and break duration', async ({ preset, focus, cycle }) => {
  let tick = () => {};
  vi.spyOn(window, 'setInterval').mockImplementation(handler => { tick = handler as () => void; return 1 as unknown as ReturnType<typeof window.setInterval>; });
  vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
  await mount(); await click('勉強を開始'); await choosePomodoro(); await openPomodoroSettings();
  await click(preset); await change({ 'aria-label': 'セット数' }, '1'); await click('設定を保存'); await click('スタート');
  vi.setSystemTime(new Date(`2026-10-07T12:${focus.toString().padStart(2, '0')}:00`));
  await act(async () => tick());
  expect(renderer!.root.findByProps({ 'data-pomodoro-phase': true }).children).toEqual(['休憩']);
  vi.setSystemTime(new Date(new Date('2026-10-07T12:00:00').getTime() + (cycle + 4) * 60_000));
  await act(async () => tick());
  expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual(['全セット完了']);
  expect(renderer!.root.findByProps({ 'data-study-session-phase-remaining': true }).children).toEqual(['00:00']);
  expect(button('完了').props.disabled).toBe(true);
  expect(standalone).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('学習中');
  await click('終了する'); await back();
  expect(button('完了').props.disabled).toBe(true);
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ actualStartTime: '12:00', actualEndTime: cycle === 60 ? '13:00' : '12:30' }));
});

it('caps a finite Pomodoro record even if finish precedes a delayed timer tick', async () => {
  await mount(); await click('勉強を開始'); await choosePomodoro(); await openPomodoroSettings();
  await change({ 'aria-label': 'セット数' }, '2'); await click('設定を保存'); await click('スタート');
  vi.setSystemTime(new Date('2026-10-07T13:15:00'));
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ actualStartTime: '12:00', actualEndTime: '13:00' }));
});

it('does not count paused time toward a finite Pomodoro goal and repeated resume keeps elapsed work', async () => {
  await mount(); await click('勉強を開始'); await choosePomodoro(); await openPomodoroSettings();
  await change({ 'aria-label': 'セット数' }, '1'); await click('設定を保存'); await click('スタート');
  vi.setSystemTime(new Date('2026-10-07T12:10:00')); await click('一時停止');
  vi.setSystemTime(new Date('2026-10-07T12:20:00'));
  const resume = button('再開').props.onClick;
  await act(async () => { resume(); resume(); });
  vi.setSystemTime(new Date('2026-10-07T12:25:00')); await act(async () => { resume(); });
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ actualStartTime: '12:00', actualEndTime: '12:15' }));
});

it.each(['tick', 'pause', 'finish'])('uses the actual Pomodoro completion date when a completed session stays open overnight (%s)', async endPath => {
  let tick = () => {};
  vi.spyOn(window, 'setInterval').mockImplementation(handler => { tick = handler as () => void; return 1 as unknown as ReturnType<typeof window.setInterval>; });
  vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
  vi.setSystemTime(new Date('2026-10-07T22:00:00'));
  await mount(); await click('勉強を開始'); await choosePomodoro(); await openPomodoroSettings();
  await change({ 'aria-label': 'セット数' }, '1'); await click('設定を保存'); await click('スタート');
  vi.setSystemTime(new Date('2026-10-07T22:35:00'));
  if (endPath === 'tick') await act(async () => tick());
  if (endPath === 'pause') await click('一時停止');
  vi.setSystemTime(new Date('2026-10-08T08:00:00'));
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ occurrenceDate: '2026-10-07', actualStartTime: '22:00', actualEndTime: '22:30' }));
});

it('retained resume cannot restart a paused tracker behind record review', async () => {
  await mount(); await click('勉強を開始'); await click('スタート');
  vi.setSystemTime(new Date('2026-10-07T12:05:00')); await click('一時停止');
  const resume = button('再開').props.onClick;
  await click('終了する');
  await act(async () => { resume(); });
  vi.setSystemTime(new Date('2026-10-07T12:20:00')); await back();
  expect(button('再開')).toBeDefined();
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ actualEndTime: '12:05' }));
});

it('requires date review when the active Pomodoro measurement itself crosses midnight', async () => {
  vi.setSystemTime(new Date('2026-10-07T23:45:00'));
  await mount(); await click('勉強を開始'); await choosePomodoro(); await openPomodoroSettings();
  await change({ 'aria-label': 'セット数' }, '1'); await click('設定を保存'); await click('スタート');
  vi.setSystemTime(new Date('2026-10-08T08:00:00'));
  await click('終了する'); await click('記録を保存');
  expect(standalone).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByProps({ role: 'alert' }).some(node => node.children.some(text => typeof text === 'string' && text.includes('日付をまたいだ計測')))).toBe(true);
});

it('keeps the planned automatic set count as a goal without introducing an automatic stop', async () => {
  let tick = () => {};
  vi.spyOn(window, 'setInterval').mockImplementation(handler => { tick = handler as () => void; return 1 as unknown as ReturnType<typeof window.setInterval>; });
  vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
  await mount(futurePlan); await click('勉強を開始'); await choosePomodoro(); await click('スタート');
  vi.setSystemTime(new Date('2026-10-07T13:05:00'));
  await act(async () => tick());
  expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0);
  expect(button('一時停止').props.disabled).toBe(false);
  await click('終了する'); await click('記録を保存');
  expect(linked).toHaveBeenCalledWith(futurePlan, expect.objectContaining({ actualStartTime: '12:00', actualEndTime: '13:05' }));
});


it('uses the newly saved preset and set limit even through a retained Start callback', async () => {
  await mount(); await click('勉強を開始'); await choosePomodoro();
  const retainedStart = button('スタート').props.onClick;
  await openPomodoroSettings(); await click('50分 / 10分');
  await change({ 'aria-label': 'セット数' }, '1'); await click('設定を保存');
  await act(async () => { retainedStart(); });
  expect(renderer!.root.findByProps({ 'data-study-session-phase-remaining': true }).children).toEqual(['50:00']);
  vi.setSystemTime(new Date('2026-10-07T13:20:00'));
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ actualStartTime: '12:00', actualEndTime: '13:00' }));
});


it('keeps the latest mode and settings when Save and a retained Start arrive together', async () => {
  await mount(); await click('勉強を開始');
  const retainedStart = button('スタート').props.onClick;
  await choosePomodoro(); await openPomodoroSettings();
  await click('50分 / 10分'); await change({ 'aria-label': 'セット数' }, '1');
  const save = button('設定を保存').props.onClick;
  await act(async () => { save(); retainedStart(); });
  expect(renderer!.root.findByProps({ 'data-study-session-phase-remaining': true }).children).toEqual(['50:00']);
  vi.setSystemTime(new Date('2026-10-07T13:20:00'));
  await click('終了する'); await click('記録を保存');
  expect(standalone).toHaveBeenCalledWith(expect.objectContaining({ actualEndTime: '13:00' }));
});

it('ignores a discarded settings Save callback after a different settings screen is opened', async () => {
  await mount(); await click('勉強を開始'); await choosePomodoro(); await openPomodoroSettings();
  await click('50分 / 10分'); await change({ 'aria-label': 'セット数' }, '3');
  const discardedSave = button('設定を保存').props.onClick;
  await back(); await openPomodoroSettings();
  await act(async () => { discardedSave(); });
  expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('ポモドーロ設定');
  await click('設定を保存');
  expect(renderer!.root.findByProps({ 'data-study-session-phase-remaining': true }).children).toEqual(['25:00']);
  expect(renderer!.root.findByProps({ 'aria-label': '集中と休憩の設定' }).children.join('')).toContain('制限なし');
});
