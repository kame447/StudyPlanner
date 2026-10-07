import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsNavigation } from './useSettingsNavigation';

let current: ReturnType<typeof useSettingsNavigation>;
let renderer: ReactTestRenderer | undefined;
function Probe() { current = useSettingsNavigation(); return null; }
function mount() { act(() => { renderer = create(<Probe />); }); }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

function browser(initial: Record<string, unknown> = { existing: 'kept' }) {
  const entries = [initial];
  let index = 0;
  const listeners = new Set<() => void>();
  const focus = vi.fn();
  class Element { isConnected = true; focus = focus; }
  const trigger = new Element();
  const history = {
    get state() { return entries[index]; },
    get length() { return entries.length; },
    replaceState: vi.fn((state: Record<string, unknown>) => { entries[index] = state; }),
    pushState: vi.fn((state: Record<string, unknown>) => {
      entries.splice(index + 1); entries.push(state); index++;
    }),
    back: vi.fn(),
  };
  const window = { history, scrollX: 7, scrollY: 340, scrollTo: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', { activeElement: trigger });
  vi.stubGlobal('window', window);
  return { entries, history, window, trigger, focus, listeners,
    pop(to: number) { act(() => { index = to; listeners.forEach(listener => listener()); }); },
    replace(state: Record<string, unknown>) { entries[index] = state; },
  };
}

describe('settings screen history', () => {
  it('pushes once on repeated open, preserves foreign state and waits for the browser Back event', () => {
    const b = browser(); mount();
    act(() => { current.open(); current.open(); });
    expect(current.isOpen).toBe(true);
    expect(b.entries).toEqual([{ existing: 'kept' }, { existing: 'kept', studyPlannerSettings: true }]);
    expect(b.history.pushState).toHaveBeenCalledTimes(1);
    act(() => { current.close(); current.close(); });
    expect(b.history.back).toHaveBeenCalledTimes(1);
    expect(current.isOpen).toBe(true);
    b.pop(0);
    expect(current.isOpen).toBe(false);
    expect(b.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(b.window.scrollTo).toHaveBeenCalledWith(7, 340);
  });

  it('handles native Back/Forward, then replaces the forward entry on a new open', () => {
    const b = browser(); mount();
    act(() => current.open()); b.pop(0); b.pop(1);
    expect(current.isOpen).toBe(true);
    act(() => current.close()); b.pop(0);
    act(() => current.open());
    expect(current.isOpen).toBe(true);
    expect(b.entries).toHaveLength(2);
    act(() => current.close());
    expect(b.history.back).toHaveBeenCalledTimes(2);
    b.pop(0); expect(current.isOpen).toBe(false);
  });

  it('restores an entry on reload and removes the listener on unmount', () => {
    const b = browser({ studyPlannerSettings: true }); mount();
    expect(current.isOpen).toBe(true);
    expect(b.history.pushState).not.toHaveBeenCalled();
    expect(b.listeners.size).toBe(1);
    act(() => renderer!.unmount()); renderer = undefined;
    expect(b.listeners.size).toBe(0);
  });

  it('closes an orphaned initial settings entry without waiting for an impossible Back event', () => {
    const b = browser({ studyPlannerSettings: true, existing: 'kept' }); mount();
    act(() => current.close());
    expect(current.isOpen).toBe(false);
    expect(b.history.back).not.toHaveBeenCalled();
    expect(b.history.state).toEqual({ existing: 'kept' });
  });

  it('does not go back through an unrelated newer history entry', () => {
    const b = browser(); mount(); act(() => current.open());
    b.replace({ anotherScreen: true });
    act(() => current.close());
    expect(current.isOpen).toBe(false);
    expect(b.history.back).not.toHaveBeenCalled();
    expect(b.history.state).toEqual({ anotherScreen: true });
  });

  it('does not restore focus to a detached trigger', () => {
    const b = browser(); mount(); act(() => current.open());
    b.trigger.isConnected = false; b.pop(0);
    expect(b.focus).not.toHaveBeenCalled();
    expect(current.isOpen).toBe(false);
  });

  it('does not read browser history during server rendering', () => {
    vi.stubGlobal('window', undefined); mount();
    expect(current.isOpen).toBe(false);
  });
});
