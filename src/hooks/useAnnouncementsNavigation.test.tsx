import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnnouncementsNavigation } from './useAnnouncementsNavigation';
let navigation: ReturnType<typeof useAnnouncementsNavigation>;
let renderer: ReactTestRenderer;
function Probe({ owner = 'owner' }: { owner?: string }) { navigation = useAnnouncementsNavigation(owner); return null; }
function browser(initial: Record<string, unknown> = { foreign: true }) {
  const entries = [initial]; let index = 0; const listeners = new Set<() => void>();
  const history = { get state() { return entries[index]; }, get length() { return entries.length; },
    pushState: vi.fn((state: Record<string, unknown>) => { entries.splice(index + 1); entries.push(state); index++; }),
    replaceState: vi.fn((state: Record<string, unknown>) => { entries[index] = state; }), back: vi.fn() };
  vi.stubGlobal('window', { history, addEventListener: (_type: string, listener: () => void) => listeners.add(listener), removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener) });
  return { history, entries, listeners, pop(i: number) { act(() => { index = i; listeners.forEach((listener) => listener()); }); } };
}
function mount() { act(() => { renderer = create(<Probe />); }); }
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
describe('announcement same-document history', () => {
  it('pushes list/detail once, keeps foreign state and waits for Back/Forward', () => {
    const b = browser(); mount(); act(() => { navigation.open(); navigation.open(); }); expect(b.history.pushState).toHaveBeenCalledTimes(1);
    act(() => { navigation.open('a'); navigation.open('a'); }); expect(b.history.pushState).toHaveBeenCalledTimes(2); expect(navigation.detailId).toBe('a');
    act(() => { navigation.back(); navigation.back(); }); expect(b.history.back).toHaveBeenCalledTimes(1); expect(navigation.isOpen).toBe(true);
    b.pop(1); expect(navigation.detailId).toBeNull(); b.pop(0); expect(navigation.isOpen).toBe(false); b.pop(1); expect(navigation.isOpen).toBe(true);
    expect(b.entries[2]).toEqual({ foreign: true, laplanceAnnouncements: { owner: 'owner', detailId: 'a' } });
  });
  it('does not show a prior owner entry or navigate through newer foreign history', () => {
    const b = browser(); mount(); act(() => navigation.open());
    act(() => renderer.update(<Probe owner="other" />)); expect(navigation.isOpen).toBe(false);
    act(() => navigation.open()); expect(navigation.isOpen).toBe(true);
    b.history.replaceState({ foreign: true }); act(() => navigation.back()); expect(navigation.isOpen).toBe(false); expect(b.history.back).not.toHaveBeenCalled();
  });
  it('closes an orphaned entry without navigating away', () => {
    const b = browser({ foreign: true, laplanceAnnouncements: { owner: 'owner', detailId: null } }); mount(); expect(navigation.isOpen).toBe(true);
    act(() => navigation.back()); expect(navigation.isOpen).toBe(false); expect(b.history.state).toEqual({ foreign: true }); expect(b.history.back).not.toHaveBeenCalled();
  });
});
