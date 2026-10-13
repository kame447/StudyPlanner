import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TodayScheduleAddMenu } from './TodayScheduleAddMenu';

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('Node', class {});
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it('keeps the study action alive through an internal pointerdown followed by null-target blur', () => {
  const onAddEntry = vi.fn();
  const target = new Node();
  const container = { contains: (node: unknown) => node === target };
  act(() => { renderer = create(<TodayScheduleAddMenu date="2026-10-13" empty onAddEntry={onAddEntry} />, {
    createNodeMock: element => element.type === 'button' ? { focus: vi.fn() } : container,
  }); });
  const toggle = () => renderer!.root.findAllByType('button').find(button => 'aria-expanded' in button.props)!;
  const group = () => renderer!.root.findByProps({ role: 'group' });
  act(() => toggle().props.onClick());
  // Safari can blur the previously focused button to the document during a
  // pointer activation, before click is dispatched to the still-held target.
  act(() => {
    group().props.onPointerDownCapture?.({ target, currentTarget: container, pointerId: 1, pointerType: 'touch' });
    group().props.onPointerDown?.({ target, currentTarget: container, pointerId: 1, pointerType: 'touch' });
  });
  act(() => group().props.onBlur({ relatedTarget: null, currentTarget: container }));
  const study = renderer!.root.findAllByType('button').find(button => button.props.id?.endsWith('-study'));
  expect(study, 'the pointer target must not unmount before its click').toBeDefined();
  expect(study!.props.disabled).not.toBe(true);
  act(() => study!.props.onClick());
  expect(onAddEntry).toHaveBeenCalledExactlyOnceWith({ kind: 'study', date: '2026-10-13' });
});

it('does not turn an interrupted pointer gesture into an add, and still dismisses on a real outside focus', () => {
  const onAddEntry = vi.fn();
  const target = new Node();
  const outside = new Node();
  const container = { contains: (node: unknown) => node === target };
  act(() => { renderer = create(<TodayScheduleAddMenu date="2026-10-13" empty onAddEntry={onAddEntry} />, {
    createNodeMock: element => element.type === 'button' ? { focus: vi.fn() } : container,
  }); });
  const toggle = () => renderer!.root.findAllByType('button').find(button => 'aria-expanded' in button.props)!;
  const group = () => renderer!.root.findByProps({ role: 'group' });
  act(() => toggle().props.onClick());
  act(() => {
    group().props.onPointerDownCapture?.({ target, currentTarget: container, pointerId: 1, pointerType: 'touch' });
    group().props.onPointerDown?.({ target, currentTarget: container, pointerId: 1, pointerType: 'touch' });
  });
  act(() => group().props.onBlur({ relatedTarget: null, currentTarget: container }));
  act(() => {
    group().props.onPointerMove?.({ target, currentTarget: container, pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 500 });
    group().props.onPointerCancel?.({ target, currentTarget: container, pointerId: 1, pointerType: 'touch' });
  });
  expect(onAddEntry).not.toHaveBeenCalled();
  // Keyboard focus leaving (in either Tab direction) is a known outside target,
  // unlike a browser dropping focus to the document during pointer activation.
  act(() => group().props.onBlur({ relatedTarget: outside, currentTarget: container }));
  expect(toggle().props['aria-expanded']).toBe(false);
  expect(onAddEntry).not.toHaveBeenCalled();
});
