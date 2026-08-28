import { describe, expect, it, vi } from 'vitest';
import type { MaterialMetadataCandidate } from '../../shared/materialMetadataContract';
import {
  buildMaterialMetadataDetailsEndpoint,
  buildMaterialMetadataEndpoint,
  enrichBuiltInMaterialSearchResults,
  isCompatibleAutomaticEnrichment,
} from './materialMetadataService';

describe('material metadata service', () => {
  it('resolves search and details endpoints from supported proxy URLs', () => {
    expect(buildMaterialMetadataEndpoint('https://example.com/chat/completions'))
      .toBe('https://example.com/material-metadata/search');
    expect(buildMaterialMetadataEndpoint('https://example.com/planning-attachment'))
      .toBe('https://example.com/material-metadata/search');
    expect(buildMaterialMetadataEndpoint('https://example.com/'))
      .toBe('https://example.com/material-metadata/search');
    expect(buildMaterialMetadataDetailsEndpoint('https://example.com/chat/completions'))
      .toBe('https://example.com/material-metadata/details');
    expect(buildMaterialMetadataDetailsEndpoint('https://example.com/material-metadata/search'))
      .toBe('https://example.com/material-metadata/details');
  });

  it('enriches confirmed built-in candidates sequentially so covers can appear in search results', async () => {
    const candidates: MaterialMetadataCandidate[] = [
      { catalogEntryId: 'seed:1', title: '教材1の完全版テキスト', authors: [] },
      { catalogEntryId: 'seed:2', title: '教材2の完全版テキスト', authors: [] },
      { catalogEntryId: 'seed:3', title: '教材3の完全版テキスト', authors: [] },
    ];
    const active: string[] = [];
    const callOrder: string[] = [];
    const resolver = vi.fn(async (candidate: MaterialMetadataCandidate) => {
      expect(active).toEqual([]);
      active.push(candidate.catalogEntryId);
      callOrder.push(candidate.catalogEntryId);
      await Promise.resolve();
      active.pop();
      return {
        ...candidate,
        isbn13: `978000000000${callOrder.length}`,
        coverImageUrl: `https://cover.example/${candidate.catalogEntryId}.jpg`,
      };
    });

    const results = await enrichBuiltInMaterialSearchResults(candidates, resolver);

    expect(callOrder).toEqual(['seed:1', 'seed:2', 'seed:3']);
    expect(results.map((candidate) => candidate.coverImageUrl)).toEqual([
      'https://cover.example/seed:1.jpg',
      'https://cover.example/seed:2.jpg',
      'https://cover.example/seed:3.jpg',
    ]);
  });

  it('does not pre-resolve broad discovery candidates or more than four books', async () => {
    const candidates: MaterialMetadataCandidate[] = Array.from({ length: 6 }, (_, index) => ({
      catalogEntryId: `seed:${index + 1}`,
      title: `教材${index + 1}の完全版テキスト`,
      authors: [],
      ...(index === 1 ? { resolutionRequired: true } : {}),
    }));
    const resolver = vi.fn(async (candidate: MaterialMetadataCandidate) => ({
      ...candidate,
      coverImageUrl: `https://cover.example/${candidate.catalogEntryId}.jpg`,
    }));

    const results = await enrichBuiltInMaterialSearchResults(candidates, resolver);

    expect(resolver).toHaveBeenCalledTimes(4);
    expect(results[1]?.coverImageUrl).toBeUndefined();
    expect(results[5]?.coverImageUrl).toBeUndefined();
  });

  it('rejects a cover when bibliography resolution appears to have selected a different book', async () => {
    const source: MaterialMetadataCandidate = {
      catalogEntryId: 'seed:gold',
      title: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
      authors: [],
    };
    const wrongBook: MaterialMetadataCandidate = {
      catalogEntryId: source.catalogEntryId,
      title: 'まったく別の英語参考書 完全版',
      authors: [],
      isbn13: '9784020000000',
      coverImageUrl: 'https://cover.example/wrong.jpg',
    };

    expect(isCompatibleAutomaticEnrichment(source, wrongBook)).toBe(false);
    await expect(enrichBuiltInMaterialSearchResults([source], async () => wrongBook))
      .resolves.toEqual([source]);
  });

  it('accepts edition suffixes when the resolved title still contains the seeded canonical title', () => {
    const source: MaterialMetadataCandidate = {
      catalogEntryId: 'seed:target',
      title: '英単語ターゲット1900',
      authors: [],
    };
    const resolved: MaterialMetadataCandidate = {
      ...source,
      title: '英単語ターゲット1900 7訂版',
      isbn13: '9780000000000',
      coverImageUrl: 'https://cover.example/target.jpg',
    };

    expect(isCompatibleAutomaticEnrichment(source, resolved)).toBe(true);
  });

  it('keeps a local candidate when optional cover enrichment fails', async () => {
    const candidate: MaterialMetadataCandidate = {
      catalogEntryId: 'seed:gold',
      title: '金フレ',
      authors: [],
    };

    const results = await enrichBuiltInMaterialSearchResults(
      [candidate],
      async () => {
        throw new Error('cover provider unavailable');
      },
    );

    expect(results).toEqual([candidate]);
  });
});
