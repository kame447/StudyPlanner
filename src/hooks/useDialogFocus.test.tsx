import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

function fixture(withControls = false, initiallyVisible = true) {
  const listeners = new Set<(event: KeyboardEvent) => void>();
  const frames = new Map<number, () => void>();
  let frame = 0;
  let activeElement: Element | null = null;
  class Element {
    children: Element[] = [];
    visible = true; isConnected = true; focus = vi.fn(() => { activeElement = this; });
    getClientRects() { return this.visible ? [{}] : []; }
    getAttribute() { return null; }
    querySelectorAll() { return this.children; }
    contains(element: Element) { return element === this || this.children.includes(element); }
  }
  const previous = new Element(); const dialog = new Element(); const close = vi.fn();
  const newerDialog = new Element();
  dialog.visible = initiallyVisible;
  const first = new Element(); const last = new Element();
  if (withControls) dialog.children = [first, last];
  activeElement = previous;
  vi.stubGlobal('HTMLElement', Element); vi.stubGlobal('document', { body: new Element(), get activeElement() { return activeElement; } });
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: () => void) => { frames.set(++frame, callback); return frame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: KeyboardEvent) => void) => listeners.delete(listener),
  });
  function Probe({ open = true }: { open?: boolean }) { const { dialogRef } = useDialogFocus<HTMLDivElement>(open, close); return <div ref={dialogRef} />; }
  act(() => { renderer = create(<Probe />, { createNodeMock: () => dialog }); });
  return { dialog, previous, newerDialog, close, listeners, first, last, active: () => activeElement,
    open(value: boolean) { act(() => renderer!.update(<Probe open={value} />)); },
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    key(key: string, shiftKey = false) { const preventDefault = vi.fn(); listeners.forEach(listener => listener({ key, shiftKey, preventDefault } as unknown as KeyboardEvent)); return preventDefault; },
  };
}

it('leaves Tab and Escape alone while its retained screen is hidden, then resumes when visible', () => {
  const f = fixture(false, false); f.frame();
  expect(f.dialog.focus).not.toHaveBeenCalled();
  expect(f.key('Tab')).not.toHaveBeenCalled(); expect(f.key('Escape')).not.toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
  f.dialog.visible = true;
  expect(f.key('Tab')).toHaveBeenCalledTimes(1); expect(f.dialog.focus).toHaveBeenCalledTimes(1);
  expect(f.key('Escape')).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1);
});

it('does not restore focus into a hidden previous screen during cleanup', () => {
  const f = fixture(); f.frame(); expect(f.dialog.focus).toHaveBeenCalledTimes(1);
  f.previous.visible = false;
  act(() => renderer!.unmount()); renderer = undefined; f.frame();
  expect(f.previous.focus).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0);
});

it('continues to restore a visible connected previous target', () => {
  const f = fixture(); f.frame();
  act(() => renderer!.unmount()); renderer = undefined; f.frame();
  expect(f.previous.focus).toHaveBeenCalledTimes(1);
});

it('keeps an initial reverse Tab inside a dialog focused on its own container', () => {
  const f = fixture(true); f.frame();
  expect(f.active() === f.dialog).toBe(true);
  expect(f.key('Tab')).not.toHaveBeenCalled();
  expect(f.key('Tab', true)).toHaveBeenCalledOnce();
  expect(f.active()).toBe(f.last);
  expect(f.key('Tab')).toHaveBeenCalledOnce();
  expect(f.active()).toBe(f.first);
});


it('owns focus before a frame so immediate hidden-screen navigation remembers the dialog', () => {
  const f = fixture(true);
  const navigationOrigin = f.active();
  // The retained form becomes hidden before the first animation frame.
  f.dialog.visible = false;
  f.frame();
  f.dialog.visible = true;
  navigationOrigin?.focus();
  expect(f.active() === f.dialog).toBe(true);
  expect(f.key('Escape')).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
});

it('cancels stale cleanup focus when the same dialog lifecycle immediately restarts', () => {
  const f = fixture(true); f.frame();
  f.open(false);
  f.open(true);
  f.frame();
  expect(f.active() === f.dialog).toBe(true);
  // A repeated setup must keep the original launcher, not the dialog itself.
  f.open(false); f.frame();
  expect(f.active() === f.previous).toBe(true);
});

it('does not let an unmounted dialog restore focus over a newly focused dialog', () => {
  const f = fixture(true); f.frame();
  act(() => renderer!.unmount()); renderer = undefined;
  f.newerDialog.focus();
  f.frame();
  expect(f.active() === f.newerDialog).toBe(true);
  expect(f.previous.focus).not.toHaveBeenCalled();
});
