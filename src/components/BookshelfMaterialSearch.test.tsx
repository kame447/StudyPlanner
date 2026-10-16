import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookshelfMaterialSearch } from './BookshelfMaterialSearch';

const mocks = vi.hoisted(() => ({
  searchMaterialMetadata: vi.fn(),
  resolveMaterialMetadataCandidate: vi.fn(),
}));

vi.mock('../services/materialMetadataService', () => ({
  searchMaterialMetadata: mocks.searchMaterialMetadata,
  resolveMaterialMetadataCandidate: mocks.resolveMaterialMetadataCandidate,
}));

afterEach(() => vi.unstubAllGlobals());

describe('BookshelfMaterialSearch', () => {
  beforeEach(() => {
    mocks.searchMaterialMetadata.mockReset();
    mocks.resolveMaterialMetadataCandidate.mockReset();
  });

  it('shows an acquired cover in the search result and falls back cleanly if the image breaks', async () => {
    const candidate = {
      catalogEntryId: 'seed:kintore',
      title: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
      authors: ['TEX加藤'],
      publisher: '朝日新聞出版',
      isbn13: '9784023315686',
      coverImageUrl: 'https://cover.example/9784023315686.jpg',
    };
    mocks.searchMaterialMetadata.mockResolvedValue({
      results: [candidate],
      cacheHit: true,
    });
    mocks.resolveMaterialMetadataCandidate.mockResolvedValue(candidate);

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<BookshelfMaterialSearch onSelect={vi.fn()} />);
    });

    act(() => {
      renderer.root.findByProps({ placeholder: '例: 金フレ / 青チャート / 東京大学 赤本' })
        .props.onChange({ target: { value: '金フレ' } });
    });

    await act(async () => {
      await renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' })
        .props.onClick();
    });

    expect(renderer.root.findAllByType('img')).toHaveLength(1);
    expect(renderer.root.findByType('img').props.src).toBe(candidate.coverImageUrl);
    expect(renderer.root.findAllByProps({ className: 'detail-note material-metadata-search-status' })[0]
      ?.props.children).toContain('1件は表紙も取得しました。');

    act(() => {
      renderer.root.findByType('img').props.onError();
    });

    expect(renderer.root.findAllByType('img')).toHaveLength(0);
  });
});

it('keeps compact source attribution and clears results only after applying a selection', async () => {
  const candidate = { catalogEntryId: 'compact-candidate', title: '教材候補', authors: [], tableOfContents: ['章1'] };
  mocks.searchMaterialMetadata.mockResolvedValue({ results: [candidate] });
  mocks.resolveMaterialMetadataCandidate.mockResolvedValue(candidate);
  const onSelect = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<BookshelfMaterialSearch compact onSelect={onSelect} />); });
  expect(renderer.root.findByProps({ className: 'material-create-attribution' }).props.open).toBeUndefined();
  const summary = renderer.root.findByType('summary');
  expect(summary.findByProps({ href: 'https://ndlsearch.ndl.go.jp/' })).toBeDefined();
  expect(summary.findByProps({ href: 'https://creativecommons.org/licenses/by/4.0/' })).toBeDefined();
  expect(renderer.root.findByProps({ href: 'https://openbd.jp/' })).toBeDefined();
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: '教材' } }));
  await act(async () => { await renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick(); });
  expect(renderer.root.findAllByProps({ className: 'material-metadata-result' })).toHaveLength(1);
  await act(async () => { await renderer.root.findByProps({ className: 'material-metadata-result' }).props.onClick({ currentTarget: undefined }); });
  expect(onSelect).toHaveBeenCalledWith(candidate);
  expect(renderer.root.findAllByProps({ className: 'material-metadata-result' })).toHaveLength(0);
  expect(renderer.root.findByType('input').props.value).toBe('教材');
  act(() => renderer.unmount());
});

it.each([false, true])('returns selected-result focus only when the user has not moved elsewhere (%s)', async moved => {
  const candidate = { catalogEntryId: 'focus-candidate', title: '教材候補', authors: [] };
  const button = {}, body = {}, laterInput = {};
  const document = Object.assign(new EventTarget(), { activeElement: button, body });
  vi.stubGlobal('document', document);
  let resolve!: (value: typeof candidate) => void;
  mocks.searchMaterialMetadata.mockResolvedValue({ results: [candidate] });
  mocks.resolveMaterialMetadataCandidate.mockReturnValue(new Promise(done => { resolve = done; }));
  const onSelectionFocusReturn = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<BookshelfMaterialSearch compact onSelect={vi.fn()} onSelectionFocusReturn={onSelectionFocusReturn} />); });
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: '教材' } }));
  await act(async () => { await renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick(); });
  act(() => renderer.root.findByProps({ className: 'material-metadata-result' }).props.onClick({ currentTarget: button }));
  if (moved) {
    document.activeElement = laterInput;
    const event = new Event('focusin'); Object.defineProperty(event, 'target', { value: laterInput });
    document.dispatchEvent(event);
  }
  await act(async () => { resolve(candidate); });
  expect(onSelectionFocusReturn).toHaveBeenCalledTimes(moved ? 0 : 1);
  act(() => renderer.unmount());
});

it('uses only the current search receipt and resets it for a later result without one', async () => {
  const candidate = { catalogEntryId: 'same-id', title: '教材候補', authors: [] };
  const receipt = vi.fn(async (value: typeof candidate) => ({ ...value, pageCount: 123 }));
  mocks.searchMaterialMetadata.mockResolvedValueOnce({ results: [candidate], resolveSelection: receipt });
  mocks.searchMaterialMetadata.mockResolvedValueOnce({ results: [candidate] });
  mocks.resolveMaterialMetadataCandidate.mockResolvedValue({ ...candidate, pageCount: 456 });
  const onSelect = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<BookshelfMaterialSearch onSelect={onSelect} />); });
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: '教材' } }));
  await act(async () => { renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick(); });
  await act(async () => { renderer.root.findByProps({ className: 'material-metadata-result' }).props.onClick({}); });
  expect(receipt).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ pageCount: 123 }));
  const priorSearches = mocks.searchMaterialMetadata.mock.calls.length;
  await act(async () => { renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick(); });
  expect(mocks.searchMaterialMetadata).toHaveBeenCalledTimes(priorSearches + 1);
  await act(async () => { renderer.root.findByProps({ className: 'material-metadata-result' }).props.onClick({}); });
  expect(receipt).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ pageCount: 456 }));
  act(() => renderer.unmount());
});

it('coalesces same-turn searches and ignores a search response after unmount', async () => {
  let finish!: (value: object) => void;
  mocks.searchMaterialMetadata.mockReset();
  mocks.searchMaterialMetadata.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const onSelect = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<BookshelfMaterialSearch onSelect={onSelect} />); });
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: '教材' } }));
  const search = renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick;
  act(() => { search(); search(); });
  expect(mocks.searchMaterialMetadata).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
  await act(async () => { finish({ results: [{ catalogEntryId: 'late', title: 'late', authors: [] }] }); });
  act(() => search());
  expect(mocks.searchMaterialMetadata).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
});

it.each(['cancel', 'unmount'])('does not apply a result receipt after %s', async stop => {
  const candidate = { catalogEntryId: 'receipt', title: '教材候補', authors: [] };
  mocks.searchMaterialMetadata.mockResolvedValue({ results: [candidate], resolveSelection: async () => candidate });
  const onSelect = vi.fn();
  const onSelectionPendingChange = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<BookshelfMaterialSearch onSelect={onSelect} onSelectionPendingChange={onSelectionPendingChange} />); });
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: '教材' } }));
  await act(async () => { renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick(); });
  act(() => { renderer.root.findByProps({ className: 'material-metadata-result' }).props.onClick({}); });
  act(() => {
    if (stop === 'unmount') renderer.unmount();
    else renderer.root.findAllByType('button').find(button => button.props.children === '教材の選択を取り消す')!.props.onClick();
  });
  await act(async () => { await Promise.resolve(); });
  expect(onSelect).not.toHaveBeenCalled();
  if (stop === 'cancel') {
    expect(onSelectionPendingChange).toHaveBeenLastCalledWith(false);
    act(() => renderer.unmount());
  }
});

it('does not start another search through Enter while a selection is pending', async () => {
  const candidate = { catalogEntryId: 'pending', title: '教材候補', authors: [] };
  let finish!: (value: typeof candidate) => void;
  mocks.searchMaterialMetadata.mockReset().mockResolvedValue({ results: [candidate], resolveSelection: () => new Promise(resolve => { finish = resolve; }) });
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<BookshelfMaterialSearch onSelect={vi.fn()} />); });
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: '教材' } }));
  await act(async () => { renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick(); });
  act(() => { renderer.root.findByProps({ className: 'material-metadata-result' }).props.onClick({}); });
  act(() => { renderer.root.findByType('input').props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() }); });
  expect(mocks.searchMaterialMetadata).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.disabled).toBe(true);
  await act(async () => { finish(candidate); });
  expect(renderer.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.disabled).toBe(false);
  act(() => renderer.unmount());
});
