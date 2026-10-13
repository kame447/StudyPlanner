import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TodayScheduleAddMenu } from './TodayScheduleAddMenu';

let renderer: ReactTestRenderer;
let listeners: Map<string, EventListener>;
let firstFocus: ReturnType<typeof vi.fn>;
let toggleFocus: ReturnType<typeof vi.fn>;
const onAddEntry = vi.fn();

beforeEach(() => {
  listeners = new Map();
  firstFocus = vi.fn();
  toggleFocus = vi.fn();
  onAddEntry.mockClear();
  vi.stubGlobal('Node', class {});
  vi.stubGlobal('document', {
    addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
  });
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

function mount(empty = true) {
  act(() => { renderer = create(<TodayScheduleAddMenu date="2026-10-13" empty={empty} onAddEntry={onAddEntry} />, {
    createNodeMock: (element) => element.type === 'button'
      ? { focus: element.props.className.includes('toggle') ? toggleFocus : firstFocus }
      : { contains: () => false },
  }); });
}
const toggle = () => renderer.root.findAllByType('button').find(node => 'aria-expanded' in node.props)!;
const action = (kind: string) => renderer.root.findAllByType('button').find(node => node.props.id?.endsWith(`-${kind}`))!;

it.each([true, false])('opens and collapses repeatedly inside the existing row (empty=%s)', (empty) => {
  mount(empty);
  expect(renderer.root.findByProps({ role: 'group' }).props.className).toContain(empty ? 'home-schedule-empty' : 'home-schedule-add-row');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    expect(toggle().props['aria-expanded']).toBe(false);
    expect(renderer.root.findAllByType('button')).toHaveLength(1);
    expect(listeners.size).toBe(0);
    act(() => toggle().props.onClick());
    expect(toggle().props['aria-expanded']).toBe(true);
    expect(toggle().props['aria-controls'].split(' ')).toEqual([action('schedule').props.id, action('study').props.id]);
    expect(renderer.root.findAllByType('button')).toHaveLength(3);
    expect(firstFocus).toHaveBeenCalledTimes(attempt + 1);
    expect(listeners.has('pointerdown')).toBe(true);
    act(() => toggle().props.onClick());
    expect(toggleFocus).toHaveBeenCalledTimes(attempt + 1);
  }
  expect(onAddEntry).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});

it.each(['schedule', 'study'])('selects %s once, restores the toggle and removes closed activity', (kind) => {
  mount();
  act(() => toggle().props.onClick());
  act(() => action(kind).props.onClick());
  expect(onAddEntry).toHaveBeenCalledExactlyOnceWith({ kind, date: '2026-10-13' });
  expect(toggleFocus).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType('button')).toHaveLength(1);
  expect(toggle().props['aria-expanded']).toBe(false);
  expect(listeners.size).toBe(0);
});

it('Escape restores focus without opening a form; Tab is not trapped', () => {
  mount();
  const preventDefault = vi.fn(); const stopPropagation = vi.fn();
  act(() => toggle().props.onClick());
  const group = renderer.root.findByProps({ role: 'group' });
  act(() => group.props.onKeyDown({ key: 'Tab', preventDefault, stopPropagation }));
  expect(preventDefault).not.toHaveBeenCalled();
  act(() => group.props.onKeyDown({ key: 'Escape', preventDefault, stopPropagation }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(stopPropagation).toHaveBeenCalledOnce();
  expect(toggleFocus).toHaveBeenCalledOnce();
  expect(toggle().props['aria-expanded']).toBe(false);
  expect(onAddEntry).not.toHaveBeenCalled();
});

it('dismisses on outside pointer or focus leaving, without stealing outside focus', () => {
  mount();
  act(() => toggle().props.onClick());
  act(() => listeners.get('pointerdown')!({ target: new Node() } as unknown as Event));
  expect(toggle().props['aria-expanded']).toBe(false);
  expect(toggleFocus).not.toHaveBeenCalled();
  act(() => toggle().props.onClick());
  const group = renderer.root.findByProps({ role: 'group' });
  act(() => group.props.onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} }));
  expect(toggle().props['aria-expanded']).toBe(true);
  act(() => group.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: {} }));
  expect(toggle().props['aria-expanded']).toBe(false);
  expect(toggleFocus).not.toHaveBeenCalled();
  expect(onAddEntry).not.toHaveBeenCalled();
});

it('unmount removes the open listener and a new visit starts closed', () => {
  mount();
  act(() => toggle().props.onClick());
  act(() => renderer.unmount());
  expect(listeners.size).toBe(0);
  mount();
  expect(toggle().props['aria-expanded']).toBe(false);
});
