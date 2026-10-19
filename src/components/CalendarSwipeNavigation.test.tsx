import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';

vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
let renderer: ReactTestRenderer;
const change = vi.fn();
const openDay = vi.fn();
function Harness({ mode }: { mode: 'month' | 'week' }) {
  const [date, setDate] = useState(mode === 'month' ? '2026-12-01' : '2026-12-31');
  function navigate(value: string) { change(value); setDate(value); }
  return mode === 'month'
    ? <MonthView monthDate={date} selectedDate={date} userId="owner" plans={[]} actuals={[]} monthEvents={[]}
        onSelectDate={vi.fn()} onChangeMonth={navigate} onOpenWeek={vi.fn()} onSaveMonthEvent={vi.fn()} onDeleteMonthEvent={vi.fn()} />
    : <WeekView selectedDate={date} plans={[]} actuals={[]} onOpenDay={openDay} onChangeWeek={navigate} />;
}
const surface = () => renderer.root.findByType('section');
function swipe(x: number, y = 0) {
  const target = null;
  act(() => {
    surface().props.onTouchStart({ target, touches: [{ clientX: 150, clientY: 150 }] });
    surface().props.onTouchMove({ target, touches: [{ clientX: 150 + x, clientY: 150 + y }] });
    surface().props.onTouchEnd({ target });
  });
}
beforeEach(() => {
  vi.useFakeTimers(); change.mockClear(); openDay.mockClear();
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), setTimeout, clearTimeout, performance });
  vi.stubGlobal('document', { body: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('month/week reuse day swipe behavior', () => {
  it.each([
    ['month', '2027-01-01', '2026-12-01'],
    ['week', '2027-01-07', '2026-12-31'],
  ] as const)('navigates %s across the year boundary exactly once and keeps taps separate', (mode, next, previous) => {
    act(() => { renderer = create(<Harness mode={mode} />); });
    swipe(-100);
    act(() => surface().props.onTouchEnd({ target: null }));
    expect(change.mock.calls).toEqual([[next]]);
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    surface().props.onClickCapture(click);
    expect(click.preventDefault).toHaveBeenCalled();
    swipe(100); expect(change.mock.calls).toEqual([[next], [previous]]);
    swipe(40); swipe(100, 150); expect(change).toHaveBeenCalledTimes(2);
    expect(openDay).not.toHaveBeenCalled();
  });
  it('does not change month while its day sheet is open', () => {
    act(() => { renderer = create(<Harness mode="month" />); });
    const cell = renderer.root.findAllByProps({ role: 'gridcell' })[10];
    act(() => cell.props.onClick());
    act(() => { vi.advanceTimersByTime(240); });
    swipe(-100); expect(change).not.toHaveBeenCalled();
  });
});
