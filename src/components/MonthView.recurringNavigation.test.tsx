import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MonthView } from './MonthView';
import { ScheduleToolbar } from './ScheduleToolbar';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
import { createEmptyMonthEventDraft } from '../domain/planner';
import { formatDateLabel } from '../lib/date';

const repo = vi.hoisted(() => ({ upsertMonthEvent: vi.fn(), deleteMonthEvent: vi.fn() }));
vi.mock('../repositories', () => ({ plannerRepository: repo }));
// Only the DOM portal boundary is replaced; calendar, sheet, dialog, date picker, and state are real.
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer;
function Harness() {
  state = usePlannerDataState({ userId: 'owner', showNotice: () => {} });
  return <>
    <ScheduleToolbar viewMode={state.viewMode} selectedDate={state.selectedDate} monthDate={state.monthDate}
      onChangeView={state.setViewMode} onChangeMonth={state.changeMonth} onChangeWeek={state.openWeek} onChangeDay={state.openDay} />
    <MonthView monthDate={state.monthDate} selectedDate={state.selectedDate} userId="owner"
      plans={state.plans} actuals={state.actuals} monthEvents={state.monthEvents}
      onSelectDate={state.selectDate} onChangeMonth={state.changeMonth} onOpenWeek={state.openWeek}
      onSaveMonthEvent={state.saveMonthEvent} onDeleteMonthEvent={state.deleteMonthEvent} />
  </>;
}
const byLabel = (label: string) => renderer.root.findByProps({ 'aria-label': label });
const button = (label: string) => renderer.root.findAllByType('button').find(n => n.children.includes(label))!;
const click = async (node: ReturnType<typeof byLabel>) => { await act(async () => { node.props.onClick(); }); };
async function cell(day: number) {
  const node = renderer.root.findAllByProps({ role: 'gridcell' }).find(n =>
    !n.props.className.includes('is-muted') && n.findAllByType('strong').some(c =>
      c.props.className?.includes('month-date-number') && c.children.join('') === String(day)))!;
  await click(node);
  await act(async () => { vi.advanceTimersByTime(240); });
}
async function title(text: string) {
  await act(async () => { byLabel('タイトル').props.onChange({ target: { value: text } }); });
}
async function october() {
  for (let i = 0; i < 5; i++) await click(byLabel('次の期間へ'));
  expect(state.monthDate).toBe('2026-10-01');
  expect(state.selectedDate).toBe('2026-10-01');
}
async function seed(repeat: 'monthly' | 'none' = 'monthly', endDate = '2026-05-15') {
  await act(async () => {
    await state.saveMonthEvent({ ...createEmptyMonthEventDraft('owner', '2026-05-15'), endDate, title: 'Seed May event', repeat });
  });
  repo.upsertMonthEvent.mockClear();
}
async function openOccurrence() {
  await october();
  await cell(15);
  const eventButton = renderer.root.findAllByType('button').find(n => n.props.className?.includes('month-day-sheet-event'))!;
  expect(eventButton).toBeDefined();
  await click(eventButton);
  expect(state.selectedDate).toBe('2026-10-15');
  expect(byLabel('10/15(木)').children.join('')).toContain('10月15日');
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
  vi.stubGlobal('window', {
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args), clearTimeout,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), performance,
    matchMedia: () => ({ matches: true }),
  });
  vi.stubGlobal('document', { body: {} });
  repo.upsertMonthEvent.mockReset().mockResolvedValue(undefined);
  repo.deleteMonthEvent.mockReset().mockResolvedValue(undefined);
  await act(async () => { renderer = create(<Harness />); });
});
afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['none', 'monthly'] as const)('new October %s input stays in October despite a saved May series', async repeat => {
  await seed(); await october(); await cell(15); await click(byLabel('予定を追加'));
  expect(byLabel('開始日').children.join('')).toContain('2026年10月15日');
  await title('New October event');
  if (repeat !== 'none') {
    const repeatButton = renderer.root.findAllByType('button').find(n => n.findAllByType('span').some(c => c.children.includes('繰り返し')))!;
    await click(repeatButton);
    await act(async () => { byLabel('繰り返し').props.onChange({ target: { value: repeat } }); });
  }
  await click(button('保存'));
  expect(repo.upsertMonthEvent).toHaveBeenCalledTimes(1);
  expect(repo.upsertMonthEvent.mock.calls[0][0]).toMatchObject({ date: '2026-10-15', title: 'New October event', repeat });
  expect(state.selectedDate).toBe('2026-10-15'); expect(state.monthDate).toBe('2026-10-01');
});

it('keeps October after title input on a recurring occurrence with a May series anchor', async () => {
  await seed(); await openOccurrence();
  expect(byLabel('開始日').children.join('')).toContain('2026年5月15日');
  await title('October occurrence title input'); await click(button('保存'));
  expect(repo.upsertMonthEvent).toHaveBeenCalledTimes(1);
  expect(repo.upsertMonthEvent.mock.calls[0][0]).toMatchObject({ date: '2026-05-15', title: 'October occurrence title input' });
  expect(state.monthDate).toBe('2026-10-01'); expect(state.selectedDate).toBe('2026-10-15');
});

it('date picker creates an October event from May without a date parse error', async () => {
  await cell(15); await click(byLabel('予定を追加')); await title('Moved new draft');
  await click(byLabel('開始日'));
  for (let i = 0; i < 5; i++) await click(byLabel('翌月'));
  await click(byLabel(formatDateLabel('2026-10-15')));
  expect(byLabel('開始日').children.join('')).toContain('2026年10月15日');
  await click(button('保存'));
  expect(repo.upsertMonthEvent.mock.calls[0][0]).toMatchObject({ date: '2026-10-15', endDate: '2026-10-15' });
  expect(state.monthDate).toBe('2026-10-01');
});

it.each(['この予定だけ削除', 'これ以降も全部削除'])('keeps October after recurring scope %s', async scope => {
  await seed(); await openOccurrence(); await click(button('削除')); await click(button(scope));
  expect(repo.upsertMonthEvent).toHaveBeenCalledTimes(1);
  expect(state.monthDate).toBe('2026-10-01');
});

it('keeps October after title input on a May-to-October nonrecurring range', async () => {
  await seed('none', '2026-10-18'); await openOccurrence();
  await title('Long event edit'); await click(button('保存'));
  expect(state.monthDate).toBe('2026-10-01');
});


it('an explicit recurring start-date move still navigates to the new month', async () => {
  await seed(); await openOccurrence();
  await click(byLabel('開始日'));
  for (let i = 0; i < 6; i++) await click(byLabel('翌月'));
  await click(byLabel(formatDateLabel('2026-11-15')));
  expect(byLabel('開始日').children.join('')).toContain('2026年11月15日');
  await click(button('保存'));
  expect(repo.upsertMonthEvent.mock.calls[0][0]).toMatchObject({ date: '2026-11-15', endDate: '2026-11-15' });
  expect(state.monthDate).toBe('2026-11-01'); expect(state.selectedDate).toBe('2026-11-15');
});

it.each(['resolve', 'reject'] as const)('preserves a newer toolbar month when a recurring edit later %ss', async outcome => {
  await seed(); await openOccurrence(); await title('Pending October edit');
  let resolve!: () => void; let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  repo.upsertMonthEvent.mockReturnValueOnce(promise);
  await click(button('保存'));
  expect(state.monthDate).toBe('2026-10-01');
  await click(byLabel('次の期間へ'));
  expect(state.monthDate).toBe('2026-11-01');
  await act(async () => { if (outcome === 'resolve') resolve(); else reject(new Error('offline')); await promise.catch(() => {}); });
  expect(state.monthDate).toBe('2026-11-01'); expect(state.selectedDate).toBe('2026-11-01');
  if (outcome === 'reject') {
    expect(byLabel('タイトル').props.value).toBe('Pending October edit');
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('もう一度保存');
  }
});
