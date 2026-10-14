import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { StudyStreakFlame } from './StudyStreakFlame';
import { StudyStreakView, type StudyStreakDisplayModel } from './StudyStreakView';

const model: StudyStreakDisplayModel = { historyComplete: true, currentStreak: 9, bestStreak: 12,
  studyDates: ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-14'],
  protectedDates: ['2026-10-13'], unprotectedRestDates: [], availableTickets: 1, studyDaysTowardNextTicket: 2 };
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
function mount(overrides: Partial<Parameters<typeof StudyStreakView>[0]> = {}) {
  const close = vi.fn(); const focus = vi.fn();
  act(() => { renderer = create(<StudyStreakView today="2026-10-14" model={model} onClose={close} {...overrides} />, {
    createNodeMock: element => element.type === 'h1' ? { focus } : null,
  }); });
  const root = renderer!.root;
  const button = (label: string) => root.findAllByType('button').find(node => node.props['aria-label'] === label || node.children.includes(label))!;
  const date = (label: string) => root.findByProps({ 'aria-label': label });
  return { root, close, focus, button, date };
}

it('shows study dates and protected rest dates as distinct labelled calendar states', () => {
  const { root, date } = mount();
  expect(date('2026年10月7日、学習した日').props.className).toContain('is-study');
  expect(date('2026年10月13日、お休みチケット使用').props.className).toContain('is-protected');
  expect(date('2026年10月14日、学習した日、今日').findByProps({ 'aria-current': 'date' }).children).toHaveLength(1);
  expect(date('2026年10月15日、これから').props.className).toContain('is-future');
  expect(root.findAllByType('th').map(node => node.children[0])).toEqual(['月', '火', '水', '木', '金', '土', '日']);
  expect(root.findByProps({ 'aria-label': 'お休みチケット 1枚' }).children[0]).toBe('1');
  expect(root.findAllByType('span').some(node => node.children.join('') === '次の1枚まで 5日')).toBe(true);
});

it('moves between months and returns to the live current month without changing record data', () => {
  const { root, button } = mount();
  expect(button('次の月').props.disabled).toBe(true);
  act(() => button('前の月').props.onClick());
  expect(root.findByProps({ 'aria-live': 'polite' }).children).toEqual(['2026年9月']);
  expect(button('次の月').props.disabled).toBe(false);
  act(() => button('次の月').props.onClick());
  act(() => button('前の月').props.onClick());
  act(() => button('前の月').props.onClick());
  act(() => button('今日').props.onClick());
  expect(root.findByProps({ 'aria-live': 'polite' }).children).toEqual(['2026年10月']);
  expect(model.protectedDates).toEqual(['2026-10-13']);
});

it.each(['2028-02-29', '2027-01-01'])('renders real month boundaries for %s', today => {
  const { root, button } = mount({ today });
  const visibleDates = root.findAllByType('td').filter(node => node.props['aria-label']);
  expect(visibleDates).toHaveLength(today.startsWith('2028') ? 29 : 31);
  act(() => button('前の月').props.onClick());
  expect(root.findByProps({ 'aria-live': 'polite' }).children).toEqual([today.startsWith('2028') ? '2028年1月' : '2026年12月']);
});

it('does not label unknown totals or ticket balance as zero during an incomplete read', () => {
  const { root } = mount({ model: { ...model, historyComplete: false, currentStreak: null, bestStreak: null,
    availableTickets: null, studyDaysTowardNextTicket: null, protectedDates: [] }, pending: true });
  expect(root.findByProps({ role: 'status' }).children).toEqual(['記録を確認しています…']);
  expect(root.findAllByType('dd').every(node => node.children[0] === '—')).toBe(true);
  expect(root.findByProps({ 'aria-label': 'お休みチケット 確認中' }).children[0]).toBe('—');
  expect(root.findAllByType('p').some(node => node.children.join('').startsWith('次の1枚'))).toBe(false);
});

it('keeps read failures visible and offers a retry without changing the selected month', () => {
  const retry = vi.fn();
  const { root, button } = mount({ error: '記録を読み込めませんでした。', onRetry: retry });
  act(() => button('前の月').props.onClick());
  act(() => button('再読み込み').props.onClick());
  expect(retry).toHaveBeenCalledTimes(1);
  expect(root.findByProps({ role: 'alert' }).findByType('p').children).toEqual(['記録を読み込めませんでした。']);
  expect(root.findByProps({ 'aria-live': 'polite' }).children).toEqual(['2026年9月']);
});

it('focuses its heading and supports the explicit back control and Escape', () => {
  const { root, close, focus, button } = mount();
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  act(() => button('戻る').props.onClick());
  expect(close).toHaveBeenCalledTimes(1);
  const preventDefault = vi.fn();
  act(() => root.findByType('main').props.onKeyDown({ key: 'Escape', preventDefault }));
  expect(close).toHaveBeenCalledTimes(2);
  expect(preventDefault).toHaveBeenCalled();
});

it('updates the today target at midnight without jumping the displayed month', () => {
  const { root, button } = mount({ today: '2026-10-31' });
  act(() => renderer!.update(<StudyStreakView today="2026-11-01" model={model} onClose={vi.fn()} />));
  expect(root.findByProps({ 'aria-live': 'polite' }).children).toEqual(['2026年10月']);
  expect(button('次の月').props.disabled).toBe(false);
  act(() => button('今日').props.onClick());
  expect(root.findByProps({ 'aria-live': 'polite' }).children).toEqual(['2026年11月']);
});

it('shows automatic protection with a compact three-value summary and no manual form', () => {
  const { root } = mount();
  expect(root.findByProps({ className: 'study-streak-summary' }).findAllByType('dd')).toHaveLength(3);
  expect(root.findAllByType('input')).toHaveLength(0);
  expect(root.findAllByType('form')).toHaveLength(0);
  expect(root.findAllByType('button').some(node => node.children.includes('チケットを使う'))).toBe(false);
  expect(root.findAllByType('span').some(node => node.children.includes('お休み券は自動で使います'))).toBe(true);
});

it('provides all six calendar rows without discarding the last week', () => {
  const { root, date } = mount({ today: '2026-08-31' });
  expect(root.findByType('tbody').findAllByType('tr')).toHaveLength(6);
  expect(root.findByProps({ className: 'study-streak-calendar' }).props.style['--streak-week-count']).toBe(6);
  expect(date('2026年8月31日、記録なし、今日')).toBeDefined();
});

it('moves the flame only for real study today and follows record corrections and midnight', () => {
  const { root } = mount();
  expect(root.findByType(StudyStreakFlame).props.studiedToday).toBe(true);
  act(() => renderer!.update(<StudyStreakView today="2026-10-14" model={{ ...model, studyDates: [], protectedDates: ['2026-10-14'] }} onClose={vi.fn()} />));
  expect(root.findByType(StudyStreakFlame).props.studiedToday).toBe(false);
  act(() => renderer!.update(<StudyStreakView today="2026-10-15" model={model} onClose={vi.fn()} />));
  expect(root.findByType(StudyStreakFlame).props.studiedToday).toBe(false);
});

it('distinguishes a previously registered rest day that changed study history no longer supports', () => {
  const { root, date } = mount({ model: { ...model, protectedDates: [], unprotectedRestDates: ['2026-10-13'] } });
  expect(date('2026年10月13日、お休みチケットの再確認が必要').props.className).toContain('is-unprotected');
  expect(root.findByProps({ role: 'status' }).children.join('')).toContain('お休み1日分を連続学習に含められません');
});


it('keeps a confirmed snapshot visible during a background refresh instead of flashing unknown totals', () => {
  const { root } = mount({ pending: true, refreshing: true });
  expect(root.findByProps({ 'aria-label': 'お休みチケット 1枚' }).children[0]).toBe('1');
  expect(root.findAllByType('dd').map(node => node.children[0])).toEqual(['7', '1', '1']);
  expect(root.findByType('main').props['aria-busy']).toBe(true);
  expect(root.findAllByProps({ role: 'status' })).toHaveLength(0);
});
