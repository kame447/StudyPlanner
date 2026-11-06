import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimeWheelPicker } from './TimeRangeFields';

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function open(value: string, role: 'start' | 'end', minMinutes = 0) {
  const onChange = vi.fn();
  act(() => { renderer = create(<TimeWheelPicker value={value} role={role} minMinutes={minMinutes} onChange={onChange} />); });
  act(() => renderer!.root.findByProps({ 'aria-haspopup': 'dialog' }).props.onClick());
  return onChange;
}
function options(column: number) {
  return renderer!.root.findAllByProps({ className: 'time-wheel-list' })[column].findAllByType('button');
}
function values(column: number) { return options(column).map(button => button.props['data-value']); }
function clickLabel(label: string) {
  act(() => renderer!.root.findAllByType('button').find(button => button.children.includes(label))!.props.onClick({ stopPropagation() {} }));
}

it('rounds a start time to the existing five-minute wheel without offering 24 hours', () => {
  const onChange = open('09:02', 'start');
  expect(values(0)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  expect(values(1)).toEqual(Array.from({ length: 12 }, (_, i) => i * 5));
  expect(onChange).not.toHaveBeenCalled();
  clickLabel('決定');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('09:05');
});
it('omits end-time choices below a non-step minimum and retains the next available choice', () => {
  const onChange = open('09:00', 'end', 9 * 60 + 3);
  expect(values(0)[0]).toBe(9);
  expect(values(0).slice(-1)[0]).toBe(24);
  expect(values(1)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  clickLabel('決定');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('09:05');
});
it('offers only midnight when the minimum is later than the last five-minute choice', () => {
  const onChange = open('23:59', 'end', 23 * 60 + 59);
  expect(values(0)).toEqual([24]);
  expect(values(1)).toEqual([0]);
  clickLabel('決定');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('24:00');
});
it('switches hour-specific minutes for 24:00 but cancellation never commits', () => {
  const onChange = open('23:55', 'end');
  act(() => options(0).find(button => button.props['data-value'] === 24)!.props.onClick());
  expect(values(1)).toEqual([0]);
  expect(onChange).not.toHaveBeenCalled();
  clickLabel('キャンセル');
  expect(onChange).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
});
