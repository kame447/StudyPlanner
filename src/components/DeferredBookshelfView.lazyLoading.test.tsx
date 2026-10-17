import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { DeferredBookshelfView } from './DeferredBookshelfView';
import { BookshelfMaterialDialog } from './BookshelfMaterialDialog';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';

const delivery = vi.hoisted(() => {
  let release!: () => void, started!: () => void;
  return { requested: vi.fn(), starting: new Promise<void>(resolve => { started = resolve; }), started: () => started(),
    ready: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
});
vi.mock('./BookshelfView', async importOriginal => {
  delivery.requested(); delivery.started(); await delivery.ready; return await importOriginal();
});
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
it('keeps delivery lazy and passes current-owner entry actions to the real bookshelf without stale replay', async () => {
  const handledOld = vi.fn(), handledCurrent = vi.fn(), save = vi.fn();
  const props = { userId: 'old-owner', subjects: [], materials: [], plans: [], actuals: [],
    onSaveSubject: save, onDeleteSubject: vi.fn(), onCaptureMaterialBaseline: vi.fn(), onSaveMaterial: save,
    onDeleteMaterial: vi.fn(), onAddMaterialToPlan: vi.fn(), onInitialActionHandled: handledOld };
  vi.stubGlobal('window', { localStorage: new MemoryStorage(), setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn(), performance,
    matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  vi.stubGlobal('document', { body: { style: {} }, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  act(() => { renderer = create(<p>Home</p>); });
  expect(delivery.requested).not.toHaveBeenCalled();
  act(() => renderer.update(<DeferredBookshelfView {...props} initialAction="add-material" />));
  await act(async () => { await delivery.starting; });
  expect(renderer.root.findAllByProps({ className: 'loading-screen splash-screen' })).toHaveLength(1);
  expect(handledOld).not.toHaveBeenCalled();
  act(() => renderer.update(<p>Home</p>));
  const current = { ...props, userId: 'current-owner', onInitialActionHandled: handledCurrent };
  act(() => renderer.update(<DeferredBookshelfView {...current} initialAction="add-material" />));
  await act(async () => { delivery.release(); await vi.dynamicImportSettled(); });
  expect(renderer.root.findByType(BookshelfMaterialDialog).props.userId).toBe('current-owner');
  expect(handledCurrent).toHaveBeenCalledOnce();
  expect(handledOld).not.toHaveBeenCalled();
  act(() => renderer.update(<p>Home</p>));
  await act(async () => renderer.update(<DeferredBookshelfView {...current} initialAction={null} />));
  expect(renderer.root.findAllByType(BookshelfMaterialDialog)).toHaveLength(0);
  expect(delivery.requested).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});
