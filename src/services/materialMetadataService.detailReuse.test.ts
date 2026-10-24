import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createElement } from 'react';
import { BookshelfMaterialSearch } from '../components/BookshelfMaterialSearch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialMetadataCandidate } from '../../shared/materialMetadataContract';
import { searchMaterialMetadata, resolveMaterialMetadataCandidate } from './materialMetadataService';

const mocks = vi.hoisted(() => ({ auth: { currentUser: null as null | { getIdToken: () => Promise<string> } }, candidates: [] as MaterialMetadataCandidate[] }));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => mocks.auth }));
vi.mock('../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: () => 'https://metadata.example.test' }));
vi.mock('./builtInMaterialCatalog', () => ({ searchBuiltInMaterialCatalog: () => mocks.candidates }));

const candidate = (id: string): MaterialMetadataCandidate => ({ catalogEntryId: `seed:${id}`, title: `Detailed material ${id}`, authors: [] });
const response = (value: MaterialMetadataCandidate) => ({ ok: true, json: async () => ({ candidate: { ...value, pageCount: 100, tableOfContents: ['First chapter'] } }) });
const selectFrom = (result: Awaited<ReturnType<typeof searchMaterialMetadata>>) => result.resolveSelection ?? resolveMaterialMetadataCandidate;

// Auth and HTTP are synthetic. No Firebase or provider endpoint is contacted.
describe('material search selection detail receipt', () => {
  beforeEach(() => {
    mocks.auth.currentUser = { getIdToken: async () => 'synthetic-token' };
    mocks.candidates = [candidate('one'), candidate('two'), candidate('three')];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const query = JSON.parse(options.body as string).query;
      return response(mocks.candidates.find(item => item.title === query)!);
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('does not repeat a successful details request after choosing a search result', async () => {
    const result = await searchMaterialMetadata('series');
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(selectFrom(result)(result.results[1])).resolves.toBe(result.results[1]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.results[1]).toMatchObject({ pageCount: 100, tableOfContents: ['First chapter'] });
  });

  it('measures search and selection dependency latency using a fixed 120 ms HTTP mock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ordinaryFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 120));
      return ordinaryFetch(...args);
    });
    const searching = searchMaterialMetadata('series');
    await vi.runAllTimersAsync();
    const result = await searching;
    const searchMilliseconds = Date.now();
    const selected = selectFrom(result)(result.results[1]);
    await vi.runAllTimersAsync();
    await selected;
    const metrics = { candidates: 3, perRequestMilliseconds: 120, searchMilliseconds,
      selectionMilliseconds: Date.now() - searchMilliseconds, detailHttpRequests: vi.mocked(fetch).mock.calls.length };
    console.info('MATERIAL_SEARCH_DETAIL_METRICS', JSON.stringify(metrics));
    expect(metrics).toEqual({ candidates: 3, perRequestMilliseconds: 120,
      searchMilliseconds: 360, selectionMilliseconds: 0, detailHttpRequests: 3 });
  });

  it.each(['owner-switch', 'same-owner-new-session', 'signed-out'])('never reuses a receipt after %s', async mode => {
    const result = await searchMaterialMetadata('series');
    mocks.auth.currentUser = mode === 'signed-out' ? null : { getIdToken: async () => 'new-synthetic-token' };
    await selectFrom(result)(result.results[0]);
    expect(fetch).toHaveBeenCalledTimes(mode === 'signed-out' ? 3 : 4);
    if (mode !== 'signed-out') expect(vi.mocked(fetch).mock.lastCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer new-synthetic-token' });
  });

  it.each(['http', 'malformed', 'incompatible'])('retries details on selection after %s enrichment failure', async failure => {
    mocks.candidates = [candidate('one')];
    if (failure === 'http') vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'synthetic unavailable' }) } as Response);
    if (failure === 'malformed') vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ candidate: { title: 'missing required fields' } }) } as Response);
    if (failure === 'incompatible') vi.mocked(fetch).mockResolvedValueOnce(response({ ...candidate('wrong'), title: 'Completely unrelated textbook' }) as Response);
    const result = await searchMaterialMetadata('one');
    expect(result.results).toEqual(mocks.candidates);
    await expect(selectFrom(result)(result.results[0])).resolves.toMatchObject({ pageCount: 100 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resolves broad discovery and candidates beyond the four-enrichment cap only when selected', async () => {
    mocks.candidates = Array.from({ length: 6 }, (_, index) => ({ ...candidate(String(index)), ...(index === 1 ? { resolutionRequired: true } : {}) }));
    const result = await searchMaterialMetadata('series');
    expect(fetch).toHaveBeenCalledTimes(4);
    await selectFrom(result)(result.results[1]);
    await selectFrom(result)(result.results[5]);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(result.results.map(item => item.catalogEntryId)).toEqual(mocks.candidates.map(item => item.catalogEntryId));
  });

  it('does not reuse a prior search result or an edited candidate in another receipt', async () => {
    const previous = await searchMaterialMetadata('series');
    const current = await searchMaterialMetadata('series');
    expect(fetch).toHaveBeenCalledTimes(6);
    await selectFrom(current)(previous.results[0]);
    await selectFrom(current)({ ...current.results[1], coverImageUrl: undefined });
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it('retains normal remote-search details lookup instead of assuming search data is complete', async () => {
    mocks.candidates = [];
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ results: [candidate('external')], cacheHit: true }) } as Response);
    const result = await searchMaterialMetadata('unknown title');
    vi.mocked(fetch).mockResolvedValueOnce(response(candidate('external')) as Response);
    await expect(selectFrom(result)(result.results[0])).resolves.toMatchObject({ pageCount: 100 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.lastCall?.[0]).toBe('https://metadata.example.test/material-metadata/details');
  });

  it('does not reuse a response if the auth owner changes while acquiring its token', async () => {
    mocks.candidates = [candidate('one')];
    let tokenReady!: (token: string) => void;
    mocks.auth.currentUser = { getIdToken: () => new Promise(resolve => { tokenReady = resolve; }) };
    const searching = searchMaterialMetadata('one');
    expect(fetch).not.toHaveBeenCalled();
    mocks.auth.currentUser = { getIdToken: async () => 'other-synthetic-token' };
    tokenReady('original-synthetic-token');
    const result = await searching;
    expect(vi.mocked(fetch).mock.lastCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer original-synthetic-token' });
    await selectFrom(result)(result.results[0]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.lastCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer other-synthetic-token' });
  });

  it('attributes a pending detail response to the auth owner that issued it', async () => {
    mocks.candidates = [candidate('one')];
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const searching = searchMaterialMetadata('one');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    mocks.auth.currentUser = { getIdToken: async () => 'other-synthetic-token' };
    finish(response(candidate('one')) as Response);
    const result = await searching;
    await selectFrom(result)(result.results[0]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('uses the successful search receipt through the rendered selection control', async () => {
    const onSelect = vi.fn();
    let view!: ReactTestRenderer;
    act(() => { view = create(createElement(BookshelfMaterialSearch, { onSelect })); });
    act(() => { view.root.findByType('input').props.onChange({ target: { value: 'series' } }); });
    await act(async () => { view.root.findByProps({ className: 'ghost-button material-metadata-search-button' }).props.onClick(); });
    expect(view.root.findAllByProps({ className: 'material-metadata-result' })).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(async () => { view.root.findAllByProps({ className: 'material-metadata-result' })[1].props.onClick({ currentTarget: undefined }); });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ catalogEntryId: 'seed:two', pageCount: 100 }));
    expect(fetch).toHaveBeenCalledTimes(3);
    act(() => view.unmount());
  });

});
