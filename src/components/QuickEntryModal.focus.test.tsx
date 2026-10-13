import { useState, type ComponentProps, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { QuickEntryModal } from './QuickEntryModal';
import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

function setup(render: (props: ComponentProps<typeof QuickEntryModal>) => ReactElement = props => <QuickEntryModal {...props} />) {
  const listeners = new Set<(event: KeyboardEvent) => void>();
  const frames = new Map<number, () => void>();
  let frameId = 0;
  let activeElement: Element | null = null;
  class Element {
    visible = true;
    isConnected = true;
    children: Element[] = [];
    focus = vi.fn(() => { activeElement = this; });
    getClientRects() { return this.visible ? [{}] : []; }
    getAttribute() { return null; }
    querySelectorAll() { return this.children; }
    contains(element: Element) { return element === this || this.children.includes(element); }
  }
  const opener = new Element();
  const form = new Element();
  const first = new Element();
  const last = new Element();
  form.children = [first, last];
  activeElement = opener;
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', {
    get activeElement() { return activeElement; },
    body: { style: { overflow: '', overscrollBehavior: '' } },
  });
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: () => void) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      if (type === 'keydown') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      if (type === 'keydown') listeners.delete(listener);
    },
  });
  const onClose = vi.fn();
  const save = vi.fn().mockResolvedValue(undefined);
  const props = {
    userId: 'focus-owner', selectedDate: '2026-10-13', initialMode: 'scheduled' as const,
    plans: [], actuals: [], materials: [], subjects: [], onClose,
    onSaveTodo: save, onSavePlan: save, onSaveStandaloneActual: save, onSaveLinkedActual: save,
  };
  function mount() {
    act(() => { renderer = create(render(props), {
      createNodeMock: node => node.type === 'form' ? form : null,
    }); });
  }
  function flushFrame() {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback());
  }
  function key(key: string, shiftKey = false) {
    const preventDefault = vi.fn();
    act(() => listeners.forEach(listener => listener({ key, shiftKey, preventDefault } as unknown as KeyboardEvent)));
    return preventDefault;
  }
  mount();
  return { opener, form, first, last, onClose, save, props, mount, flushFrame, key,
    active: () => activeElement, listenerCount: () => listeners.size };
}

it('moves initial focus from the Home launcher onto the non-input dialog', () => {
  const f = setup();
  expect(f.active() === f.opener).toBe(true);
  f.flushFrame();
  expect(f.active() === f.form).toBe(true);
  expect(renderer!.root.findByType('form').props.tabIndex).toBe(-1);
  expect(f.first.focus).not.toHaveBeenCalled();
  expect(f.last.focus).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it('contains forward and reverse Tab without intercepting ordinary interior navigation', () => {
  const f = setup(); f.flushFrame();
  expect(f.active() === f.form).toBe(true);
  expect(f.key('Tab', true)).toHaveBeenCalledOnce();
  expect(f.active() === f.last).toBe(true);
  expect(f.key('Tab')).toHaveBeenCalledOnce();
  expect(f.active() === f.first).toBe(true);
  expect(f.key('Tab')).not.toHaveBeenCalled();
  expect(f.key('Tab', true)).toHaveBeenCalledOnce();
  expect(f.active() === f.last).toBe(true);
  f.opener.focus();
  expect(f.key('Tab')).toHaveBeenCalledOnce();
  expect(f.active() === f.first).toBe(true);
});

it('closes through the latest callback on Escape without saving', () => {
  const f = setup(); f.flushFrame();
  const nextClose = vi.fn();
  act(() => renderer!.update(<QuickEntryModal {...f.props} onClose={nextClose} />));
  expect(f.key('Escape')).toHaveBeenCalledOnce();
  expect(nextClose).toHaveBeenCalledOnce();
  expect(f.onClose).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it('restores the retained launcher after close and supports a fresh reopening', () => {
  const f = setup(); f.flushFrame(); f.first.focus();
  act(() => renderer!.unmount()); renderer = undefined;
  f.flushFrame();
  expect(f.active() === f.opener).toBe(true);
  expect(f.listenerCount()).toBe(0);
  f.mount(); f.flushFrame();
  expect(f.active() === f.form).toBe(true);
  expect(f.listenerCount()).toBe(1);
});

it.each(['hidden', 'disconnected'])('does not return focus to a %s launcher after navigation', state => {
  const f = setup(); f.flushFrame();
  if (state === 'hidden') f.opener.visible = false;
  else f.opener.isConnected = false;
  act(() => renderer!.unmount()); renderer = undefined;
  f.flushFrame();
  expect(f.opener.focus).not.toHaveBeenCalled();
  expect(f.listenerCount()).toBe(0);
});

it('cancels pending entry focus when closed before the first frame', () => {
  const f = setup();
  act(() => renderer!.unmount()); renderer = undefined;
  f.flushFrame();
  expect(f.form.focus).not.toHaveBeenCalled();
  expect(f.active() === f.opener).toBe(true);
  expect(f.listenerCount()).toBe(0);
});

it('Escape during a save returns focus and an old success cannot close the reopened entry', async () => {
  const pending = deferred();
  const save = vi.fn(() => pending.promise);
  function Session(props: ComponentProps<typeof QuickEntryModal>) {
    const [open, setOpen] = useState(true);
    return open ? <QuickEntryModal {...props} initialMode="later" onSaveTodo={save}
      onClose={() => { props.onClose(); setOpen(false); }} />
      : <button id="reopen" onClick={() => setOpen(true)}>再入場</button>;
  }
  const f = setup(props => <Session {...props} />);
  const title = () => renderer!.root.findByProps({ placeholder: '例: 英語課題 / 面接準備' });
  f.flushFrame();
  act(() => title().props.onChange({ target: { value: '保存中の入力' } }));
  let submitted!: Promise<void>;
  act(() => { submitted = renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(save).toHaveBeenCalledOnce();
  expect(f.key('Escape')).toHaveBeenCalledOnce();
  f.flushFrame();
  expect(f.onClose).toHaveBeenCalledOnce();
  expect(f.active() === f.opener).toBe(true);
  expect(f.listenerCount()).toBe(0);
  act(() => renderer!.root.findByProps({ id: 'reopen' }).props.onClick());
  f.flushFrame();
  act(() => title().props.onChange({ target: { value: '新しい未保存の入力' } }));
  await act(async () => { pending.resolve(undefined); await submitted; });
  expect(title().props.value).toBe('新しい未保存の入力');
  expect(f.onClose).toHaveBeenCalledOnce();
  expect(f.listenerCount()).toBe(1);
  expect(f.active() === f.form).toBe(true);
});
