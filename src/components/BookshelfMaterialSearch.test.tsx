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
