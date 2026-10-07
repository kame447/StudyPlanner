import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { MonthView } from './MonthView';
import { QuickAddMenu } from './QuickAddMenu';

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

function browser() {
  const listeners = new Set<(event: KeyboardEvent) => void>();
  const frames = new Map<number, () => void>();
  let frame = 0;
  let visible = true;
  class Element {
    tagName = 'BUTTON';
    isContentEditable = false;
    focus = vi.fn();
    getClientRects() { return visible ? [{}] : []; }
  }
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('window', {
    addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => listeners.delete(listener),
    requestAnimationFrame: (callback: () => void) => { frames.set(++frame, callback); return frame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  const node = new Element();
  return {
    node,
    setVisible(value: boolean) { visible = value; },
    key(key: string) {
      const preventDefault = vi.fn();
      act(() => listeners.forEach(listener => listener({ key, target: new Element(), preventDefault } as unknown as KeyboardEvent)));
      return preventDefault;
    },
    runFrames() { const pending = [...frames.values()]; frames.clear(); act(() => pending.forEach(callback => callback())); },
  };
}

it('keeps the hidden month selection unchanged and resumes shortcuts when the planner returns', () => {
  const b = browser();
  const selectDate = vi.fn();
  act(() => { renderer = create(<MonthView monthDate="2026-10-01" selectedDate="2026-10-07" userId="owner"
    plans={[]} actuals={[]} monthEvents={[]} onSelectDate={selectDate} onChangeMonth={vi.fn()} onOpenWeek={vi.fn()}
    onSaveMonthEvent={vi.fn(async () => undefined)} onDeleteMonthEvent={vi.fn(async () => undefined)} />,
  { createNodeMock: () => b.node }); });

  b.setVisible(false);
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    expect.soft(b.key(key)).not.toHaveBeenCalled();
  }
  expect.soft(selectDate).not.toHaveBeenCalled();
  selectDate.mockClear();
  b.setVisible(true);
  expect(b.key('ArrowRight')).toHaveBeenCalledTimes(1);
  expect(selectDate).toHaveBeenCalledWith('2026-10-08');
});

it('retains a hidden quick-add menu on Escape and resumes dismissal after returning', () => {
  const b = browser();
  act(() => { renderer = create(<QuickAddMenu onAddSchedule={vi.fn()} onAddStudy={vi.fn()} onOpenAiPlanning={vi.fn()} />,
    { createNodeMock: () => b.node }); });
  const trigger = () => renderer!.root.findByProps({ className: 'daily-add-fab schedule-add-fab quick-add-trigger print-hide' });
  act(() => trigger().props.onClick());
  b.setVisible(false);
  b.runFrames();
  expect.soft(b.node.focus).not.toHaveBeenCalled();
  expect.soft(b.key('Escape')).not.toHaveBeenCalled();
  expect.soft(trigger().props['aria-expanded']).toBe(true);
  b.setVisible(true);
  expect(b.key('Escape')).toHaveBeenCalledTimes(1);
  expect(trigger().props['aria-expanded']).toBe(false);
  b.runFrames();
  expect(b.node.focus).toHaveBeenCalledTimes(1);
});
