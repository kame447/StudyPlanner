import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookshelfMaterialSearch } from './BookshelfMaterialSearch';

const mocks = vi.hoisted(() => ({
  searchMaterialMetadata: vi.fn(),
  resolveMaterialMetadataCandidate: vi.fn(),
}));

vi.mock('../services/materialMetadataService', () => ({
  searchMaterialMetadata: mocks.searchMaterialMetadata,
  resolveMaterialMetadataCandidate: mocks.resolveMaterialMetadataCandidate,
}));

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
