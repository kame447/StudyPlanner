import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { callbacks, entries, view } from './deferredWorkspaceViews.testUtils';

const deliveries = vi.hoisted(() => Object.fromEntries(['Day', 'Timetable', 'Report'].map(entry => {
  let release!: () => void, started!: () => void;
  return [entry, { requested: vi.fn(), starting: new Promise<void>(resolve => { started = resolve; }), started: () => started(),
    ready: new Promise<void>(resolve => { release = resolve; }), release: () => release() }];
})));
vi.mock('./DayView', async () => { const d = deliveries.Day; d.requested(); d.started(); await d.ready; throw Error('late Day delivery failure'); });
vi.mock('./TimetableView', async () => { const d = deliveries.Timetable; d.requested(); d.started(); await d.ready; throw Error('late Timetable delivery failure'); });
vi.mock('./ReportView', async () => { const d = deliveries.Report; d.requested(); d.started(); await d.ready; throw Error('late Report delivery failure'); });
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); });
it.each(entries)('ignores late %s rejection after leaving, then contains the current-owner cached rejection', async entry => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const delivery = deliveries[entry];
  act(() => { renderer = create(<p>Home</p>); });
  expect(delivery.requested).not.toHaveBeenCalled();
  act(() => renderer.update(view(entry, 'old-owner')));
  await act(async () => { await delivery.starting; });
  expect(renderer.root.findAllByProps({ className: 'loading-screen splash-screen' })).toHaveLength(1);
  act(() => renderer.update(<p>Home</p>));
  await act(async () => { delivery.release(); await vi.dynamicImportSettled(); });
  expect(renderer.root.findByType('p').children).toEqual(['Home']);
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  await act(async () => renderer.update(view(entry, 'current-owner')));
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('読み込めませんでした');
  act(() => renderer.update(<p>Home</p>));
  expect(renderer.root.findByType('p').children).toEqual(['Home']);
  expect(delivery.requested).toHaveBeenCalledOnce();
  expect(callbacks.save).not.toHaveBeenCalled();
  expect(callbacks.remove).not.toHaveBeenCalled();
});
