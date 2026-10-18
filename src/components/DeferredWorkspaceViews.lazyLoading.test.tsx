import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { callbacks, entries, selectedDate, view } from './deferredWorkspaceViews.testUtils';

const deliveries = vi.hoisted(() => Object.fromEntries(['Day', 'Timetable', 'Report'].map(entry => {
  let release!: () => void, started!: () => void;
  return [entry, { requested: vi.fn(), starting: new Promise<void>(resolve => { started = resolve; }), started: () => started(),
    ready: new Promise<void>(resolve => { release = resolve; }), release: () => release() }];
})));
vi.mock('./DayView', async original => { const d = deliveries.Day; d.requested(); d.started(); await d.ready; return await original(); });
vi.mock('./TimetableView', async original => { const d = deliveries.Timetable; d.requested(); d.started(); await d.ready; return await original(); });
vi.mock('./ReportView', async original => { const d = deliveries.Report; d.requested(); d.started(); await d.ready; return await original(); });
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden'); }));
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { body: { style: {} }, documentElement: { dataset: {} } }));
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it.each(entries)('keeps %s lazy and delivers the real view only with current-owner props', async entry => {
  const delivery = deliveries[entry];
  act(() => { renderer = create(<p>Home</p>); });
  expect(delivery.requested).not.toHaveBeenCalled();
  act(() => renderer.update(view(entry, 'old-owner')));
  await act(async () => { await delivery.starting; });
  expect(renderer.root.findAllByProps({ className: 'loading-screen splash-screen' })).toHaveLength(1);
  act(() => renderer.update(<p>Home</p>));
  act(() => renderer.update(view(entry, 'current-owner')));
  await act(async () => { delivery.release(); await vi.dynamicImportSettled(); });
  const actualView = renderer.root.find(node => typeof node.type === 'function' && node.type.name === `${entry}View`);
  if (entry !== 'Report') expect(actualView.props.userId).toBe('current-owner');
  expect(actualView.props.plans).toEqual([]);
  if (entry !== 'Timetable') {
    expect(actualView.props.selectedDate).toBe(selectedDate);
    expect(actualView.props.actuals).toEqual([expect.objectContaining({ id: 'record-current-owner', userId: 'current-owner' })]);
  }
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(delivery.requested).toHaveBeenCalledOnce();
  expect(callbacks.save).not.toHaveBeenCalled();
  expect(callbacks.remove).not.toHaveBeenCalled();
});
