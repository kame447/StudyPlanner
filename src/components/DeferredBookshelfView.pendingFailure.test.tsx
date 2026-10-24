import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { DeferredBookshelfView } from './DeferredBookshelfView';

const delivery = vi.hoisted(() => {
  let release!: () => void, started!: () => void;
  return { requested: vi.fn(), starting: new Promise<void>(resolve => { started = resolve; }), started: () => started(),
    ready: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
});
vi.mock('./BookshelfView', async () => {
  delivery.requested(); delivery.started(); await delivery.ready;
  throw new Error('delayed bookshelf delivery failure');
});
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); });
const props = { subjects: [], materials: [], plans: [], actuals: [], onSaveSubject: vi.fn(), onDeleteSubject: vi.fn(),
  onCaptureMaterialBaseline: vi.fn(), onSaveMaterial: vi.fn(), onDeleteMaterial: vi.fn(), onAddMaterialToPlan: vi.fn() };
function Harness({ owner }: { owner: string }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Materials</button><button onClick={() => setOpen(false)}>Home</button>
    {open ? <DeferredBookshelfView {...props} userId={owner} /> : <p>Home content</p>}</>;
}
it('ignores rejection after leaving pending entry and bounds cached failure for the current owner', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  act(() => { renderer = create(<Harness owner="old-owner" />); });
  expect(delivery.requested).not.toHaveBeenCalled();
  const [open, home] = renderer.root.findAllByType('button');
  act(() => open.props.onClick());
  await act(async () => { await delivery.starting; });
  expect(renderer.root.findAllByProps({ className: 'loading-screen splash-screen' })).toHaveLength(1);
  act(() => { home.props.onClick(); renderer.update(<Harness owner="current-owner" />); });
  await act(async () => { delivery.release(); await vi.dynamicImportSettled(); });
  expect(renderer.root.findByType('p').children).toEqual(['Home content']);
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  await act(async () => open.props.onClick());
  expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual(['教材を読み込めませんでした。']);
  act(() => home.props.onClick());
  expect(renderer.root.findByType('p').children).toEqual(['Home content']);
  expect(delivery.requested).toHaveBeenCalledOnce();
  expect(props.onSaveMaterial).not.toHaveBeenCalled();
  expect(props.onDeleteMaterial).not.toHaveBeenCalled();
});
