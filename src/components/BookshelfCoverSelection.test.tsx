import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import { BookshelfMaterialDialog } from './BookshelfMaterialDialog';
import type { StudyMaterial, StudySubject } from '../types/domain';

const mocks = vi.hoisted(() => ({ image: vi.fn(), search: vi.fn(), resolve: vi.fn() }));
vi.mock('../lib/materialImage', () => ({ createMaterialCoverDataUrl: mocks.image }));
vi.mock('../services/materialMetadataService', () => ({
  searchMaterialMetadata: mocks.search,
  resolveMaterialMetadataCandidate: mocks.resolve,
}));
const subject: StudySubject = { id: 'subject', userId: 'owner', name: 'Math', color: '#000000', createdAt: '', updatedAt: '' };
const material: StudyMaterial = { id: 'material', userId: 'owner', name: 'Book', subjectId: subject.id, subjectName: subject.name, color: subject.color, status: 'active', createdAt: '', updatedAt: '' };
const candidate = { catalogEntryId: 'catalog', title: 'Catalog book', authors: [], coverImageUrl: 'https://example.com/cover.jpg', aliases: [] };
let renderer: ReactTestRenderer;
function mount() {
  const save = vi.fn().mockResolvedValue(material);
  act(() => { renderer = create(<BookshelfMaterialDialog userId="owner" material={null} subjects={[subject]} onClose={vi.fn()} onSave={save} onDelete={vi.fn()} />); });
  act(() => renderer.root.findByProps({ placeholder: '黄色チャート' }).props.onChange({ target: { value: 'Book' } }));
  return save;
}
function selectPhoto() {
  let pending!: Promise<void>;
  act(() => { pending = renderer.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [{ name: 'photo.png', type: 'image/png' }], value: 'photo.png' } }); });
  return pending;
}
async function startCatalog() {
  act(() => renderer.root.findByProps({ placeholder: '例: 金フレ / 青チャート / 東京大学 赤本' }).props.onChange({ target: { value: 'Book' } }));
  await act(async () => { renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick(); });
  act(() => renderer.root.findByProps({ className: 'material-metadata-result' }).props.onClick());
}
async function submit(save: ReturnType<typeof vi.fn>) {
  await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
  expect(save).toHaveBeenCalledTimes(1);
  return save.mock.calls[0][0];
}
function preview() {
  return renderer.root.findAllByType('img').filter(img => img.props.alt !== '').map(img => img.props.src);
}
beforeEach(() => { vi.clearAllMocks(); mocks.search.mockResolvedValue({ results: [candidate] }); });
afterEach(() => { act(() => renderer?.unmount()); });

describe('material cover selection order', () => {
  it.each(['success', 'failure'] as const)('retains newer photo when the older conversion ends with %s', async outcome => {
    const old = deferred<string>(); const latest = deferred<string>();
    mocks.image.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const save = mount(); const oldPending = selectPhoto(); const newPending = selectPhoto();
    await act(async () => { latest.resolve('data:image/jpeg;base64,new'); await newPending; });
    await act(async () => { if (outcome === 'success') old.resolve('data:image/jpeg;base64,old'); else old.reject(new Error('old failure')); await oldPending; });
    expect(preview()).toEqual(['data:image/jpeg;base64,new']);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('old failure');
    expect((await submit(save)).coverImageDataUrl).toBe('data:image/jpeg;base64,new');
  });
  it('keeps removal after an older conversion completes', async () => {
    const old = deferred<string>(); mocks.image.mockResolvedValueOnce('data:image/jpeg;base64,initial').mockReturnValueOnce(old.promise);
    const save = mount(); await act(async () => { await selectPhoto(); });
    const pending = selectPhoto();
    act(() => renderer.root.findAllByType('button').find(button => button.props.children === '写真を外す')!.props.onClick());
    await act(async () => { old.resolve('data:image/jpeg;base64,old'); await pending; });
    expect(preview()).toEqual([]);
    expect((await submit(save)).coverImageDataUrl).toBeUndefined();
  });
  it('keeps a later catalogue selection after an older photo completes', async () => {
    const old = deferred<string>(); mocks.image.mockReturnValueOnce(old.promise); mocks.resolve.mockResolvedValue(candidate);
    const save = mount(); const pending = selectPhoto(); await startCatalog();
    await act(async () => {});
    await act(async () => { old.resolve('data:image/jpeg;base64,old'); await pending; });
    const draft = await submit(save);
    expect(draft).toMatchObject({ coverImageUrl: candidate.coverImageUrl, catalogEntryId: candidate.catalogEntryId });
    expect(draft.coverImageDataUrl).toBeUndefined();
  });
  it('retains catalogue identity but honors a photo selected while its details are loading', async () => {
    const details = deferred<typeof candidate>(); mocks.resolve.mockReturnValueOnce(details.promise); mocks.image.mockResolvedValue('data:image/jpeg;base64,new');
    const save = mount(); await startCatalog(); await act(async () => { await selectPhoto(); });
    await act(async () => { details.resolve(candidate); });
    const draft = await submit(save);
    expect(draft).toMatchObject({ name: candidate.title, catalogEntryId: candidate.catalogEntryId, coverImageDataUrl: 'data:image/jpeg;base64,new' });
    expect(draft.coverImageUrl).toBeUndefined();
  });
  it('blocks save for the current conversion, including a captured same-render submit', async () => {
    const old = deferred<string>(); const latest = deferred<string>();
    mocks.image.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const save = mount(); const capturedSubmit = renderer.root.findByType('form').props.onSubmit;
    const oldPending = selectPhoto(); const latestPending = selectPhoto();
    await act(async () => { await capturedSubmit({ preventDefault: vi.fn() }); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { old.resolve('data:image/jpeg;base64,old'); await oldPending; });
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    await act(async () => { latest.resolve('data:image/jpeg;base64,new'); await latestPending; });
    expect((await submit(save)).coverImageDataUrl).toBe('data:image/jpeg;base64,new');
  });
  it('invalidates a photo at catalogue click, before catalogue details return', async () => {
    const old = deferred<string>(); const details = deferred<typeof candidate>();
    mocks.image.mockReturnValueOnce(old.promise); mocks.resolve.mockReturnValueOnce(details.promise);
    mount(); const pending = selectPhoto(); await startCatalog();
    await act(async () => { old.resolve('data:image/jpeg;base64,old'); await pending; });
    expect(preview()).toEqual([]);
    await act(async () => { details.resolve(candidate); });
    expect(preview()).toEqual([candidate.coverImageUrl]);
  });
  it('keeps removal during catalogue loading without dropping its metadata', async () => {
    const details = deferred<typeof candidate>(); mocks.resolve.mockReturnValueOnce(details.promise); mocks.image.mockResolvedValue('data:image/jpeg;base64,initial');
    const save = mount(); await act(async () => { await selectPhoto(); }); await startCatalog();
    act(() => renderer.root.findAllByType('button').find(button => button.props.children === '写真を外す')!.props.onClick());
    await act(async () => { details.resolve(candidate); });
    const draft = await submit(save);
    expect(draft.catalogEntryId).toBe(candidate.catalogEntryId);
    expect(draft.coverImageUrl).toBeUndefined(); expect(draft.coverImageDataUrl).toBeUndefined();
  });
  it('resets the input immediately and permits serial success after a current failure', async () => {
    const gate = deferred<string>(); mocks.image.mockReturnValueOnce(gate.promise).mockResolvedValueOnce('data:image/jpeg;base64,new');
    const save = mount(); const target = { files: [{ name: 'same.png', type: 'image/png' }], value: 'same.png' };
    let pending!: Promise<void>;
    act(() => { pending = renderer.root.findByProps({ type: 'file' }).props.onChange({ target }); });
    expect(target.value).toBe(''); target.value = 'new selection';
    await act(async () => { gate.reject(new Error('current failure')); await pending; });
    expect(target.value).toBe('new selection');
    expect(JSON.stringify(renderer.toJSON())).toContain('current failure');
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
    await act(async () => { await selectPhoto(); });
    expect((await submit(save)).coverImageDataUrl).toBe('data:image/jpeg;base64,new');
  });

  it.each([false, true])('does not save the previous draft while a new catalogue selection resolves (previous catalogue: %s)', async previousCatalog => {
    const details = deferred<typeof candidate>();
    const save = mount();
    if (previousCatalog) {
      mocks.resolve.mockResolvedValueOnce({ ...candidate, catalogEntryId: 'previous', title: 'Previous book' });
      await startCatalog(); await act(async () => {});
    }
    mocks.resolve.mockReturnValueOnce(details.promise);
    const capturedSubmit = renderer.root.findByType('form').props.onSubmit;
    await startCatalog();
    await act(async () => { await capturedSubmit({ preventDefault: vi.fn() }); });
    expect(save).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    await act(async () => { details.resolve(candidate); });
    const draft = await submit(save);
    expect(draft).toMatchObject({ name: candidate.title, catalogEntryId: candidate.catalogEntryId });
  });

  it('can cancel stalled details, retain manual fields, and ignore them during a newer selection', async () => {
    const old = deferred<typeof candidate>(); const latest = deferred<typeof candidate>();
    mocks.resolve.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    mocks.image.mockResolvedValue('data:image/jpeg;base64,custom');
    const save = mount(); await startCatalog(); await act(async () => { await selectPhoto(); });
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    act(() => renderer.root.findAllByType('button').find(button => button.props.children === '教材の選択を取り消す')!.props.onClick());
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
    expect(renderer.root.findByProps({ placeholder: '黄色チャート' }).props.value).toBe('Book');
    await startCatalog();
    await act(async () => { old.resolve({ ...candidate, title: 'Cancelled book' }); });
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ placeholder: '黄色チャート' }).props.value).toBe('Book');
    await act(async () => { latest.resolve(candidate); });
    expect((await submit(save)).catalogEntryId).toBe(candidate.catalogEntryId);
  });
  it.each(['cancel', 'failure'] as const)('keeps manual registration available after %s without discarding the draft', async outcome => {
    const details = deferred<typeof candidate>(); mocks.resolve.mockReturnValueOnce(details.promise);
    const save = mount(); await startCatalog();
    if (outcome === 'cancel') {
      act(() => renderer.root.findAllByType('button').find(button => button.props.children === '教材の選択を取り消す')!.props.onClick());
    } else {
      await act(async () => { details.reject(new Error('unexpected details failure')); });
    }
    const draft = await submit(save);
    expect(draft.name).toBe('Book'); expect(draft.catalogEntryId).toBeUndefined();
    if (outcome === 'cancel') {
      await act(async () => { details.resolve(candidate); });
      expect(renderer.root.findByProps({ placeholder: '黄色チャート' }).props.value).toBe('Book');
    }
  });

});
