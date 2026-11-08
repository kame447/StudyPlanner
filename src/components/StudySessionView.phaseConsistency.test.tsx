import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudySessionProvider, useStudySessionLauncher } from './StudySessionView';

vi.mock('./home/HomeScene', () => ({ HomeScene: () => null }));

// #190: pause / resume / finish / reload must agree with the pomodoro phase (focus / break), its remaining time,
// and the elapsed time saved as the Actual (which includes the breaks, excludes the paused time).
const at = (clock: string) => new Date(`2026-10-07T${clock}`);
let renderer: ReactTestRenderer | undefined;
let launch: NonNullable<ReturnType<typeof useStudySessionLauncher>>;
let tick = () => {};
let store: Map<string, string>;
const saved = vi.fn(async (_draft: { actualStartTime: string; actualEndTime: string }) => {});
function Probe() { launch = useStudySessionLauncher()!; return null; }

async function mount() {
  await act(async () => {
    renderer = create(<StudySessionProvider userId="owner" materials={[]} onSaveActual={vi.fn(async () => {})} onSaveStandaloneActual={saved}><Probe /></StudySessionProvider>);
  });
}
const button = (text: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(text))!;
const click = (text: string) => act(async () => { button(text).props.onClick(); });
const back = () => act(async () => { renderer!.root.findByProps({ 'aria-label': '戻る' }).props.onClick(); });
const phase = () => renderer!.root.findByProps({ 'data-pomodoro-phase': true }).children.join('');
const remaining = () => renderer!.root.findByProps({ 'data-study-session-phase-remaining': true }).children.join('');
const hasButton = (text: string) => renderer!.root.findAllByType('button').some(node => node.children.includes(text));
async function clockTo(clock: string) { vi.setSystemTime(at(clock)); await act(async () => tick()); }
async function startPomodoro() {
  await mount();
  await act(async () => { launch({ kind: 'unplanned' }); });
  await act(async () => { renderer!.root.findByProps({ 'data-mode': 'pomodoro', type: 'button' }).props.onClick(); });
  await click('スタート');
}
async function reload(clock: string) {
  await act(async () => { renderer!.unmount(); });
  vi.setSystemTime(at(clock));
  await mount();
  await click('計測中へ戻る');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at('12:00:00'));
  store = new Map();
  vi.stubGlobal('window', {
    setInterval: (handler: () => void) => { tick = handler; return 1; }, clearInterval: () => {}, confirm: () => true,
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) },
  });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
  vi.stubGlobal('document', { body: { style: { overflow: '' } } });
  saved.mockClear();
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps the break (and its remaining time) while paused, and resumes inside the same break', async () => {
  await startPomodoro();
  await clockTo('12:27:00');
  expect([phase(), remaining()]).toEqual(['休憩', '03:00']);
  await click('一時停止');
  await clockTo('12:57:00'); // thirty minutes pass while paused
  expect([phase(), remaining()]).toEqual(['休憩', '03:00']);
  await click('再開');
  await clockTo('12:58:00');
  expect([phase(), remaining()]).toEqual(['休憩', '02:00']);
  await clockTo('13:00:00');
  expect([phase(), remaining()]).toEqual(['集中', '25:00']);
});

it('does not count paused time toward the focus-to-break boundary', async () => {
  await startPomodoro();
  await clockTo('12:10:00');
  await click('一時停止');
  await clockTo('13:10:00');
  await click('再開');
  await clockTo('13:24:00');
  expect([phase(), remaining()]).toEqual(['集中', '01:00']);
  await clockTo('13:25:00');
  expect(phase()).toBe('休憩');
});

it('survives repeated pauses across the focus/break boundary without moving the boundary', async () => {
  await startPomodoro();
  await clockTo('12:24:30'); await click('一時停止');
  await clockTo('12:40:00'); await click('再開');
  await clockTo('12:40:30'); // 30 s after resuming: 25:00 of focus reached
  expect([phase(), remaining()]).toEqual(['休憩', '05:00']);
  await click('一時停止');
  await clockTo('13:00:00'); await click('再開');
  await clockTo('13:05:00');
  expect([phase(), remaining()]).toEqual(['集中', '25:00']);
});

it('restores a paused break with the same remaining time and resumes it', async () => {
  await startPomodoro();
  await clockTo('12:27:00'); await click('一時停止');
  await reload('15:00:00');
  expect([phase(), remaining()]).toEqual(['休憩', '03:00']);
  expect(hasButton('再開')).toBe(true);
  await click('再開');
  await clockTo('15:01:00');
  expect([phase(), remaining()]).toEqual(['休憩', '02:00']);
});

it('restores a running break by wall time, and a running focus that crossed into the break', async () => {
  await startPomodoro();
  await clockTo('12:20:00'); // still focus when the page goes away
  await reload('12:27:30');  // restore alone crosses focus -> break
  expect([phase(), remaining()]).toEqual(['休憩', '02:30']);
  await reload('12:31:00');
  expect([phase(), remaining()]).toEqual(['集中', '24:00']);
});

it('records elapsed time including the break but not the paused time, and returns to the same phase', async () => {
  await startPomodoro();
  await clockTo('12:27:00'); await click('一時停止');
  await clockTo('14:00:00');
  await click('終了する');
  await back();
  expect([phase(), remaining()]).toEqual(['休憩', '03:00']);
  expect(hasButton('再開')).toBe(true);
  await click('再開');
  await clockTo('14:03:00');
  expect([phase(), remaining()]).toEqual(['集中', '25:00']);
  await click('終了する');
  await click('記録を保存');
  expect(saved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actualStartTime: '12:00', actualEndTime: '12:30' }));
});

it('completes a one-set session when the pause lands after a delayed tick, and neither resume nor reload extends it', async () => {
  await mount();
  await act(async () => { launch({ kind: 'unplanned' }); });
  await act(async () => { renderer!.root.findByProps({ 'data-mode': 'pomodoro', type: 'button' }).props.onClick(); });
  await act(async () => { renderer!.root.findByProps({ 'aria-label': '集中と休憩の設定' }).props.onClick(); });
  await act(async () => { renderer!.root.findByProps({ 'aria-label': 'セット数' }).props.onChange({ target: { value: '1' } }); });
  await click('設定を保存'); await click('スタート');
  vi.setSystemTime(at('12:40:00')); // no tick: the page was in the background
  await click('一時停止');
  expect(hasButton('完了')).toBe(true);
  await reload('19:00:00');
  expect(hasButton('完了')).toBe(true);
  expect(button('完了').props.disabled).toBe(true);
  await click('終了する'); await click('記録を保存');
  expect(saved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actualStartTime: '12:00', actualEndTime: '12:30' }));
});

it('restores the record step and returns to the paused phase', async () => {
  await startPomodoro();
  await clockTo('12:27:00'); await click('終了する');
  await reload('18:00:00');
  await back();
  expect([phase(), remaining()]).toEqual(['休憩', '03:00']);
  await click('終了する'); await click('記録を保存');
  expect(saved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actualStartTime: '12:00', actualEndTime: '12:27' }));
});
