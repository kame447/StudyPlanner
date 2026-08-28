import { describe, expect, it, vi } from 'vitest';
import type { MaterialMetadataCandidate } from '../../shared/materialMetadataContract';
import {
  buildMaterialMetadataDetailsEndpoint,
  buildMaterialMetadataEndpoint,
  enrichBuiltInMaterialSearchResults,
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
      { catalogEntryId: 'seed:1', title: '教材1', authors: [] },
      { catalogEntryId: 'seed:2', title: '教材2', authors: [] },
      { catalogEntryId: 'seed:3', title: '教材3', authors: [] },
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
      title: `教材${index + 1}`,
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
