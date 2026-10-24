import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MonthPickerDialog } from './MonthPickerDialog';

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-19T10:00:00'));
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(activeMonthDate = '2026-08-01') {
  const onSelectMonth = vi.fn();
  const wheels: Array<{ scrollTop: number; position: (value: number) => number }> = [];
  act(() => {
    renderer = create(<MonthPickerDialog open activeMonthDate={activeMonthDate}
      onSelectMonth={onSelectMonth} onClose={vi.fn()} />, {
      createNodeMock: element => {
        if (element.props.className !== 'month-wheel-list') return null;
        const values = element.props.children.map((child: { props: { 'data-value': number } }) => child.props['data-value']);
        const position = (value: number) => values.indexOf(value) * 48;
        const wheel = {
          scrollTop: 0,
          clientHeight: 240,
          position,
          querySelector(selector: string) {
            const value = Number(selector.match(/data-value="(\d+)"/)?.[1]);
            return values.includes(value) ? { offsetTop: position(value) + 96, offsetHeight: 48 } : null;
          },
          scrollTo({ top, behavior }: ScrollToOptions) {
            // Smooth browser scrolling may still be at its old position when
            // an earlier scroll-settle callback runs. Auto positioning is immediate.
            if (behavior === 'auto') {
              wheel.scrollTop = top ?? 0;
              element.props.onScroll();
            }
          },
        };
        wheels.push(wheel);
        return wheel;
      },
    });
  });
  // Flush the initial positioning callback, leaving its scroll-settle timer pending.
  act(() => { vi.advanceTimersByTime(0); });
  return { onSelectMonth, wheels };
}

function click(label: string) {
  const button = renderer!.root.findAllByType('button').find(node => node.children.join('') === label)!;
  act(() => button.props.onClick());
}
function summary() {
  return renderer!.root.findByProps({ className: 'month-picker-summary' }).children.join('');
}

it.each([
  ['2027年', '2027年8月', '2027-08-01'],
  ['9月', '2026年9月', '2026-09-01'],
])('keeps explicit %s selection when the opening scroll settles', (label, expectedSummary, expectedDate) => {
  const { onSelectMonth } = mount();
  click(label);
  expect(summary()).toBe(expectedSummary);
  act(() => { vi.advanceTimersByTime(90); });
  expect(summary()).toBe(expectedSummary);
  click('決定');
  expect(onSelectMonth).toHaveBeenCalledExactlyOnceWith(expectedDate);
});

it('keeps the current-month shortcut when both older wheel callbacks are pending', () => {
  const { onSelectMonth } = mount('2024-03-01');
  click('今月');
  act(() => { vi.advanceTimersByTime(90); });
  expect(summary()).toBe('2026年8月');
  click('決定');
  expect(onSelectMonth).toHaveBeenCalledExactlyOnceWith('2026-08-01');
});

it('keeps the latest explicit choice and still accepts a subsequent wheel selection', () => {
  const { onSelectMonth, wheels } = mount();
  click('2027年');
  click('2028年');
  act(() => { vi.advanceTimersByTime(90); });
  expect(summary()).toBe('2028年8月');
  act(() => {
    wheels[0].scrollTop = wheels[0].position(2029);
    renderer!.root.findAllByProps({ className: 'month-wheel-list' })[0].props.onScroll();
    vi.advanceTimersByTime(89);
  });
  expect(summary()).toBe('2028年8月');
  act(() => { vi.advanceTimersByTime(1); });
  expect(summary()).toBe('2029年8月');
  click('決定');
  expect(onSelectMonth).toHaveBeenCalledExactlyOnceWith('2029-08-01');
});
