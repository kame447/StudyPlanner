import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import type { MaterialMetadataCandidate } from '../services/materialMetadataService';
import type { StudyMaterial, StudySubject } from '../types/domain';
import { BookshelfMaterialDialog } from './BookshelfMaterialDialog';

const mocks = vi.hoisted(() => ({ search: vi.fn(), resolve: vi.fn() }));
vi.mock('../services/materialMetadataService', () => ({
  searchMaterialMetadata: mocks.search,
  resolveMaterialMetadataCandidate: mocks.resolve,
}));
const subject: StudySubject = { id: 'subject', userId: 'owner', name: 'Math', color: '#000000', createdAt: '', updatedAt: '' };
const material: StudyMaterial = { id: 'material', userId: 'owner', name: 'Saved book', subjectId: subject.id, subjectName: subject.name, color: subject.color, status: 'active', createdAt: '', updatedAt: '' };
const candidate: MaterialMetadataCandidate = { catalogEntryId: 'catalog', title: 'Catalog book', authors: [], aliases: ['Alias'] };
let renderer: ReactTestRenderer;

function mount() {
  const save = vi.fn().mockResolvedValue(material);
  function Harness() {
    const [open, setOpen] = useState(true);
    const [owner, setOwner] = useState('owner');
    return <>
      <button type="button" onClick={() => setOwner('other-owner')}>Switch owner</button>
      {open
        ? <BookshelfMaterialDialog userId={owner} material={null} subjects={[{ ...subject, userId: owner }]} onClose={() => setOpen(false)} onSave={save} onDelete={vi.fn()} />
        : <button type="button" onClick={() => setOpen(true)}>Reopen</button>}
    </>;
  }
  act(() => { renderer = create(<Harness />); });
  rename('Manual book');
  return save;
}
function nameInput() { return renderer.root.findByProps({ placeholder: '黄色チャート' }); }
function rename(value: string) { act(() => nameInput().props.onChange({ target: { value } })); }
function click(label: string) {
  act(() => renderer.root.findAllByType('button').find(button => button.props.children === label)!.props.onClick());
}
async function selectCatalog(doubleClick = false) {
  act(() => renderer.root.findByProps({ placeholder: '例: 金フレ / 青チャート / 東京大学 赤本' }).props.onChange({ target: { value: 'Book' } }));
  await act(async () => { renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick(); });
  const select = renderer.root.findByProps({ className: 'material-metadata-result' }).props.onClick;
  act(() => { select(); if (doubleClick) select(); });
}
async function submit() {
  await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
}
beforeEach(() => { vi.clearAllMocks(); mocks.search.mockResolvedValue({ results: [candidate] }); });
afterEach(() => { act(() => renderer?.unmount()); });

describe('material name selection order', () => {
  it.each(['Renamed while loading', ''])("keeps the later manual name '%s' when older catalogue details arrive", async name => {
    const details = deferred<MaterialMetadataCandidate>();
    mocks.resolve.mockReturnValueOnce(details.promise);
    const save = mount();
    await selectCatalog();
    rename(name);
    expect(nameInput().props.value).toBe(name);
    await act(async () => { details.resolve(candidate); });
    expect(nameInput().props.value).toBe(name);
    await submit();
    if (name) {
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ name, catalogEntryId: candidate.catalogEntryId, catalogTitle: candidate.title }), undefined, undefined);
    } else {
      expect(save).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    }
  });

  it('preserves an explicit edit that returns to the name present at selection start', async () => {
    const details = deferred<MaterialMetadataCandidate>();
    mocks.resolve.mockReturnValueOnce(details.promise);
    mount(); await selectCatalog();
    rename('Temporary name'); rename('Manual book');
    await act(async () => { details.resolve(candidate); });
    expect(nameInput().props.value).toBe('Manual book');
  });

  it('applies the catalogue title when the selection is newer than the last manual edit', async () => {
    const details = deferred<MaterialMetadataCandidate>();
    mocks.resolve.mockReturnValueOnce(details.promise);
    const save = mount(); await selectCatalog();
    await act(async () => { details.resolve(candidate); });
    expect(nameInput().props.value).toBe(candidate.title);
    await submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: candidate.title, catalogEntryId: candidate.catalogEntryId }), undefined, undefined);
  });

  it.each(['failure', 'cancel'] as const)('keeps the edited draft after selection %s and lets a later selection replace it', async outcome => {
    const old = deferred<MaterialMetadataCandidate>();
    const next = deferred<MaterialMetadataCandidate>();
    mocks.resolve.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    mount(); await selectCatalog(); rename('Kept manual name');
    if (outcome === 'cancel') click('教材の選択を取り消す');
    else await act(async () => { old.reject(new Error('Synthetic details failure')); });
    expect(nameInput().props.value).toBe('Kept manual name');
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
    await selectCatalog();
    if (outcome === 'cancel') await act(async () => { old.resolve({ ...candidate, title: 'Cancelled title' }); });
    expect(nameInput().props.value).toBe('Kept manual name');
    await act(async () => { next.resolve({ ...candidate, title: 'New selection' }); });
    expect(nameInput().props.value).toBe('New selection');
  });

  it('ignores repeated selection clicks and blocks saving until the selected details settle', async () => {
    const details = deferred<MaterialMetadataCandidate>();
    mocks.resolve.mockReturnValueOnce(details.promise);
    const save = mount(); await selectCatalog(true); rename('Manual latest');
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    await submit(); expect(save).not.toHaveBeenCalled();
    await act(async () => { details.resolve(candidate); });
    const submitHandler = renderer.root.findByType('form').props.onSubmit;
    await act(async () => { await Promise.all([submitHandler({ preventDefault: vi.fn() }), submitHandler({ preventDefault: vi.fn() })]); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Manual latest' }), undefined, undefined);
  });

  it('does not carry a pending title or edit revision into a different owner session', async () => {
    const old = deferred<MaterialMetadataCandidate>();
    const next = deferred<MaterialMetadataCandidate>();
    mocks.resolve.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const save = mount(); await selectCatalog(); rename('Old owner edit');
    click('Switch owner'); rename('New owner draft');
    await act(async () => { old.resolve({ ...candidate, title: 'Old owner catalogue' }); });
    expect(nameInput().props.value).toBe('New owner draft');
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
    await selectCatalog();
    await act(async () => { next.resolve({ ...candidate, title: 'New owner selection' }); });
    expect(nameInput().props.value).toBe('New owner selection');
    await submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'other-owner', name: 'New owner selection' }), undefined, undefined);
  });

  it.each(['success', 'failure'] as const)('keeps a reopened draft when the closed editor receives a late %s', async outcome => {
    const details = deferred<MaterialMetadataCandidate>();
    mocks.resolve.mockReturnValueOnce(details.promise);
    const save = mount(); await selectCatalog(); click('閉じる'); click('Reopen'); rename('Reopened draft');
    await act(async () => {
      if (outcome === 'success') details.resolve(candidate);
      else details.reject(new Error('Synthetic closed-editor failure'));
    });
    expect(nameInput().props.value).toBe('Reopened draft');
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
    await submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Reopened draft', catalogEntryId: undefined }), undefined, undefined);
  });
});
