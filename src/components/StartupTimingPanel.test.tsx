import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { StartupTimingPanel } from './StartupTimingPanel';
import { StartupTimingButton } from './StartupTimingButton';
const state = vi.hoisted(() => ({ enabled: true, markOnce: vi.fn(),
  rows: [{ id: 1, phase: 'bootstrap', startMs: 0, durationMs: 20, outcome: 'error' }] }));
vi.mock('../lib/startupTiming', () => ({ startupTiming: {
  get enabled() { return state.enabled; }, markOnce: state.markOnce,
  subscribe: () => () => {}, getSnapshot: () => state.rows,
} }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); state.enabled = true; });
function fixture() {
  let observe!: () => void;
  let frame: (() => void) | undefined;
  let visible = false;
  let splash = false;
  const home = { isConnected: true, getClientRects: () => visible ? [1] : [] };
  const disconnect = vi.fn();
  vi.stubGlobal('document', { body: {}, querySelector: (selector: string) => selector === '.home-main' ? home : splash ? {} : null });
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { observe = callback; } observe() {} disconnect = disconnect; });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frame = callback; return 7; });
  const cancel = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancel);
  act(() => { renderer = create(<StartupTimingPanel />); });
  return { home, disconnect, cancel, observe: () => observe(), paint: () => { const callback = frame; frame = undefined; callback?.(); },
    visible: (value: boolean) => { visible = value; }, splash: (value: boolean) => { splash = value; } };
}
it('observes Home once only after gates and layout, without upgrading failed bootstrap', () => {
  const f = fixture(); f.observe(); f.paint(); expect(state.markOnce).not.toHaveBeenCalled();
  f.visible(true); f.splash(true); f.observe(); f.paint(); expect(state.markOnce).not.toHaveBeenCalled();
  f.splash(false); f.observe(); f.home.isConnected = false; f.paint(); expect(state.markOnce).not.toHaveBeenCalled();
  f.home.isConnected = true; f.observe(); f.paint(); f.observe(); f.paint();
  expect(state.markOnce).toHaveBeenCalledExactlyOnceWith('home-visible');
  expect(f.disconnect).toHaveBeenCalledOnce();
  expect(renderer.root.findByType('pre').props.children).toContain('"outcome": "error"');
});
it('cancels a pending observation on unmount and does not mount diagnostics when disabled', () => {
  const f = fixture(); f.visible(true); f.observe(); act(() => renderer.unmount());
  expect(f.cancel).toHaveBeenCalledWith(7);
  state.enabled = false;
  act(() => { renderer = create(<StartupTimingPanel />); });
  expect(renderer.toJSON()).toBeNull();
  expect(state.markOnce).not.toHaveBeenCalled();
});

it('keeps the optional diagnostic panel above the shared bottom-navigation clearance', () => {
  fixture();
  expect(renderer.root.findByType('details').props.style.bottom)
    .toBe('calc(var(--app-bottom-nav-clearance, 72px) + 8px)');
});

it('offers an explicit stop reload while preserving the diagnostic rows', () => {
  fixture();
  expect(renderer.root.findByType(StartupTimingButton).props.enabled).toBe(true);
  expect(renderer.root.findByType('pre').props.children).toContain('bootstrap');
});
