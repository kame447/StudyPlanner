import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { DeferredMonthView } from './DeferredMonthView';
import { MonthEventDialog } from './MonthEventDialog';

const delivery = vi.hoisted(() => {
  let release!: () => void, started!: () => void;
  return { requested: vi.fn(), starting: new Promise<void>(resolve => { started = resolve; }), started: () => started(),
    ready: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
});
vi.mock('./MonthView', async importOriginal => {
  delivery.requested(); delivery.started(); await delivery.ready;
  return await importOriginal();
});
// Keep the real month view, editor and request handling; replace only the DOM portal.
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

it('retains an add request during delivery, abandons cancelled owners, and does not replay it on return', async () => {
  const save = vi.fn(async () => {}), select = vi.fn();
  const props = { monthDate: '2026-10-01', selectedDate: '2026-10-16', userId: 'old-owner', plans: [], actuals: [], monthEvents: [],
    createRequestId: 0, onSelectDate: select, onChangeMonth: vi.fn(), onOpenWeek: vi.fn(), onSaveMonthEvent: save, onDeleteMonthEvent: vi.fn(async () => {}) };
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn(), performance,
    matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('document', { body: {}, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  // Importing the shell or rendering Home does not request the month chunk.
  act(() => { renderer = create(<p>Home</p>); });
  expect(delivery.requested).not.toHaveBeenCalled();
  act(() => renderer.update(<DeferredMonthView {...props} />));
  await act(async () => { await delivery.starting; });
  expect(delivery.requested).toHaveBeenCalledOnce();
  expect(renderer.root.findAllByType('video')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ className: 'loading-screen splash-screen' })).toHaveLength(1);
  expect(renderer.root.findAllByType(MonthEventDialog)).toHaveLength(0);
  act(() => renderer.update(<DeferredMonthView {...props} createRequestId={1} />));
  // Cancel the original entry, then enter as another owner before the same chunk settles.
  act(() => renderer.update(<p>Home</p>));
  const current = { ...props, userId: 'current-owner', selectedDate: '2026-10-17', createRequestId: 1 };
  act(() => renderer.update(<DeferredMonthView {...props} createRequestId={1} />));
  // An owner replacement resets the shell even without a route unmount.
  act(() => renderer.update(<DeferredMonthView {...current} />));
  act(() => renderer.update(<DeferredMonthView {...current} createRequestId={2} />));
  await act(async () => { delivery.release(); await vi.dynamicImportSettled(); });
  expect(renderer.root.findAllByType(MonthEventDialog)).toHaveLength(1);
  expect(renderer.root.findByProps({ 'aria-label': '開始日' }).children.join('')).toContain('2026年10月17日');
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith('2026-10-17');
  expect(save).not.toHaveBeenCalled();
  // A new entry captures the already-handled request; it must not reopen the editor.
  act(() => renderer.update(<p>Home</p>));
  await act(async () => renderer.update(<DeferredMonthView {...current} createRequestId={2} />));
  expect(renderer.root.findAllByType(MonthEventDialog)).toHaveLength(0);
  act(() => renderer.update(<DeferredMonthView {...current} createRequestId={3} />));
  expect(renderer.root.findAllByType(MonthEventDialog)).toHaveLength(1);
  expect(select).toHaveBeenCalledTimes(2);
  expect(delivery.requested).toHaveBeenCalledOnce();
});
