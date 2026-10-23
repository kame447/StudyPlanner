import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyMaterialMetadataQuery,
  type MaterialMetadataCandidate,
} from '../../../shared/materialMetadataContract';
import {
  buildNdlOpenSearchUrl,
  buildNdlSruDetailsUrl,
  handleMaterialMetadataApi,
  parseNdlOpenSearchXml,
  parseNdlSruDetailsXml,
} from './materialMetadataApi';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const catalogCandidate: MaterialMetadataCandidate = {
  catalogEntryId: 'isbn13:9784023315686',
  title: '教材',
  authors: ['著者'],
  publisher: '出版社',
  publishedYear: 2023,
  isbn13: '9784023315686',
};
const coverImageUrl = 'https://cover.openbd.jp/9784023315686.jpg';
const catalogDocument = {
  name: 'projects/test-project/databases/(default)/documents/material_metadata_catalog/isbn13_9784023315686',
  fields: {
    catalogEntryId: { stringValue: catalogCandidate.catalogEntryId },
    title: { stringValue: catalogCandidate.title },
    authors: { arrayValue: { values: [{ stringValue: '著者' }] } },
    publisher: { stringValue: '出版社' },
    publishedYear: { integerValue: '2023' },
    isbn13: { stringValue: catalogCandidate.isbn13 },
  },
};
const searchXml = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item>
  <title>教材</title><dc:creator>著者</dc:creator><dc:publisher>出版社</dc:publisher>
  <dc:date>2023</dc:date><dc:identifier>9784023315686</dc:identifier>
</item></channel></rss>`;

function mockCatalogFlow(options: {
  cache?: 'hit' | 'miss' | 'read-failure';
  writeFailure?: boolean;
  provider?: 'success' | 'empty' | 'failure' | 'network-failure';
  providerXml?: string;
  details?: 'http-failure' | 'network-failure' | 'body-failure' | 'parse-failure' | 'aborted';
} = {}) {
  const operations: string[] = [];
  const writes: Array<{ fields: Record<string, unknown> }> = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      operations.push('auth');
      return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
    }
    if (url.hostname === 'firestore.googleapis.com') {
      if (init?.method === 'PATCH') {
        operations.push('catalog-write');
        writes.push(JSON.parse(String(init.body)));
        return new Response(null, { status: options.writeFailure ? 503 : 200 });
      }
      if (url.pathname.endsWith(':runQuery')) {
        operations.push('catalog-query');
        return Response.json(options.cache === 'hit' ? [{ document: catalogDocument }] : []);
      }
      operations.push('catalog-get');
      if (options.cache === 'read-failure') return new Response(null, { status: 503 });
      return options.cache === 'hit'
        ? Response.json(catalogDocument)
        : new Response(null, { status: 404 });
    }
    if (url.hostname === 'ndlsearch.ndl.go.jp' && url.pathname === '/api/opensearch') {
      operations.push('ndl-search');
      if (options.provider === 'network-failure') throw new TypeError('Search network failure');
      return new Response(options.provider === 'empty' ? '<rss><channel /></rss>' : options.providerXml ?? searchXml, {
        status: options.provider === 'failure' ? 503 : 200,
      });
    }
    if (url.hostname === 'ndlsearch.ndl.go.jp' && url.pathname === '/api/sru') {
      operations.push('ndl-details');
      if (options.details === 'http-failure') return new Response(null, { status: 503 });
      if (options.details === 'network-failure') throw new TypeError('Details network failure');
      if (options.details === 'aborted') throw new DOMException('Details cancelled', 'AbortError');
      if (options.details === 'body-failure') {
        return new Response(new ReadableStream({
          start(controller) { controller.error(new TypeError('Details body read failure')); },
        }));
      }
      if (options.details === 'parse-failure') return new Response('<edition>&#99999999;</edition>');
      return new Response('<record><edition>改訂版</edition><extent>381p</extent></record>');
    }
    if (url.hostname === 'api.openbd.jp') {
      operations.push('cover');
      return Response.json([{ summary: { isbn: '9784023315686', cover: coverImageUrl } }]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  return { operations, writes };
}

function requestMetadata(endpoint: 'search' | 'details', query = '9784023315686') {
  return handleMaterialMetadataApi(
    new Request(`https://worker.example/material-metadata/${endpoint}`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.example',
        Authorization: 'Bearer test-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }),
    {
      FIREBASE_WEB_API_KEY: 'test-api-key',
      ALLOWED_ORIGIN: 'https://app.example',
      FIREBASE_PROJECT_ID: 'test-project',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-test-key',
    },
    { getToken: async () => 'test-service-token' },
  );
}

describe.each(['search', 'details'] as const)('material metadata %s catalog policy', (endpoint) => {
  const enrichment = endpoint === 'details' ? ['ndl-details', 'catalog-write', 'cover'] : ['cover'];

  it.each(['9784023315686', '教材'])('uses a catalog hit without repeating NDL search for %s', async (query) => {
    const { operations } = mockCatalogFlow({ cache: 'hit' });
    const response = await requestMetadata(endpoint, query);

    expect(response.status).toBe(200);
    expect(operations).toEqual(['auth', query === '教材' ? 'catalog-query' : 'catalog-get', ...enrichment]);
    expect(await response.json()).toEqual(endpoint === 'search'
      ? { results: [{ ...catalogCandidate, coverImageUrl }], cacheHit: true }
      : { candidate: { ...catalogCandidate, edition: '改訂版', pageCount: 381, coverImageUrl } });
  });

  it.each([
    { cache: 'miss' as const, writeFailure: false },
    { cache: 'read-failure' as const, writeFailure: false },
    { cache: 'miss' as const, writeFailure: true },
  ])('preserves provider fallback and best-effort writes for $cache / write failure $writeFailure', async (options) => {
    const { operations, writes } = mockCatalogFlow(options);
    const response = await requestMetadata(endpoint);

    expect(response.status).toBe(200);
    expect(operations).toEqual([
      'auth', 'catalog-get', ...(options.cache === 'miss' ? ['catalog-query'] : []),
      'ndl-search', 'catalog-write', ...enrichment,
    ]);
    expect(await response.json()).toEqual(endpoint === 'search'
      ? { results: [{ ...catalogCandidate, coverImageUrl }], cacheHit: false }
      : { candidate: { ...catalogCandidate, edition: '改訂版', pageCount: 381, coverImageUrl } });
    expect(writes).toHaveLength(endpoint === 'details' ? 2 : 1);
    for (const write of writes) {
      expect(write.fields).toMatchObject({
        schemaVersion: { integerValue: '2' },
        normalizedTitle: { stringValue: '教材' },
        sourceProvider: { stringValue: 'ndl-search' },
      });
      expect(write.fields).not.toHaveProperty('coverImageUrl');
    }
  });

  it('does not write or enrich empty provider results', async () => {
    const { operations, writes } = mockCatalogFlow({ provider: 'empty' });
    const response = await requestMetadata(endpoint);

    expect(operations).toEqual(['auth', 'catalog-get', 'catalog-query', 'ndl-search']);
    expect(writes).toEqual([]);
    expect(response.status).toBe(endpoint === 'search' ? 200 : 404);
    expect(await response.json()).toEqual(endpoint === 'search'
      ? { results: [], cacheHit: false }
      : { error: '詳しい教材情報が見つかりませんでした。基本情報のまま登録できます。' });
  });

  it('preserves the endpoint-specific fallback message when NDL fails', async () => {
    const { operations } = mockCatalogFlow({ provider: 'failure' });
    const response = await requestMetadata(endpoint);

    expect(response.status).toBe(502);
    expect(operations).toEqual(['auth', 'catalog-get', 'catalog-query', 'ndl-search']);
    expect(await response.json()).toEqual({ error: endpoint === 'search'
      ? '教材検索を一時的に利用できません。手入力で教材を登録できます。'
      : '詳しい教材情報を取得できませんでした。基本情報のまま登録できます。' });
  });
});

describe.each(['hit', 'miss'] as const)('material detail enrichment with a catalog %s', (cache) => {
  it.each(['http-failure', 'network-failure', 'body-failure', 'parse-failure'] as const)(
    'retains the acquired bibliography and continues cover enrichment after %s',
    async (details) => {
      const { operations, writes } = mockCatalogFlow({ cache, details });
      const response = await requestMetadata('details');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ candidate: { ...catalogCandidate, coverImageUrl } });
      expect(operations).toEqual([
        'auth', 'catalog-get',
        ...(cache === 'miss' ? ['catalog-query', 'ndl-search', 'catalog-write'] : []),
        'ndl-details', 'catalog-write', 'cover',
      ]);
      expect(writes).toHaveLength(cache === 'miss' ? 2 : 1);
      for (const write of writes) {
        expect(write.fields.isbn13).toEqual({ stringValue: catalogCandidate.isbn13 });
        expect(write.fields).not.toHaveProperty('pageCount');
        expect(write.fields).not.toHaveProperty('edition');
        expect(write.fields).not.toHaveProperty('coverImageUrl');
      }
    },
  );
});

describe('material detail enrichment failure boundaries', () => {
  it('does not treat cancelled enrichment as a successful lookup', async () => {
    const { operations } = mockCatalogFlow({ cache: 'hit', details: 'aborted' });
    const response = await requestMetadata('details');

    expect(response.status).toBe(502);
    expect(operations).toEqual(['auth', 'catalog-get', 'ndl-details']);
  });

  it('does not suppress an invalid catalog ISBN when building the details query', async () => {
    const { operations } = mockCatalogFlow({ cache: 'hit' });
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).hostname === 'firestore.googleapis.com') {
        return Response.json({
          ...catalogDocument,
          fields: { ...catalogDocument.fields, isbn13: { stringValue: 'invalid-isbn' } },
        });
      }
      return originalFetch(input, init);
    }));
    const response = await requestMetadata('details');

    expect(response.status).toBe(502);
    expect(operations).toEqual(['auth']);
  });

  it.each(['search', 'details'] as const)('preserves the %s error when initial NDL search fails', async (endpoint) => {
    const { operations } = mockCatalogFlow({ provider: 'network-failure' });
    const response = await requestMetadata(endpoint);

    expect(response.status).toBe(502);
    expect(operations).toEqual(['auth', 'catalog-get', 'catalog-query', 'ndl-search']);
    expect(await response.json()).toEqual({ error: endpoint === 'search'
      ? '教材検索を一時的に利用できません。手入力で教材を登録できます。'
      : '詳しい教材情報を取得できませんでした。基本情報のまま登録できます。' });
  });

  it.each(['search', 'details'] as const)('rejects an invalid %s query before provider access', async (endpoint) => {
    const { operations } = mockCatalogFlow();
    const response = await requestMetadata(endpoint, '');

    expect(response.status).toBe(400);
    expect(operations).toEqual(['auth']);
  });

  it.each([401, 403])('preserves authentication rejection %s before provider access', async (status) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => status === 401
      ? new Response(null, { status: 401 })
      : Response.json({ users: [{ localId: 'user-1', emailVerified: false }] }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await requestMetadata('details');

    expect(response.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('identitytoolkit.googleapis.com');
  });
});

it('caches all provider candidates before enriching the exact-title details candidate', async () => {
  const otherItem = searchXml
    .replace('<title>教材</title>', '<title>別の教材</title>')
    .replace('9784023315686', '9784010345467')
    .match(/<item>[\s\S]*<\/item>/)![0];
  const { operations, writes } = mockCatalogFlow({
    providerXml: searchXml.replace('<channel>', `<channel>${otherItem}`),
  });
  const response = await requestMetadata('details', '教材');

  expect(response.status).toBe(200);
  expect(operations).toEqual([
    'auth', 'catalog-query', 'ndl-search', 'catalog-write', 'catalog-write',
    'ndl-details', 'catalog-write', 'cover',
  ]);
  expect(writes.map((write) => write.fields.isbn13)).toEqual([
    { stringValue: '9784010345467' }, { stringValue: '9784023315686' }, { stringValue: '9784023315686' },
  ]);
  expect(await response.json()).toEqual({
    candidate: { ...catalogCandidate, edition: '改訂版', pageCount: 381, coverImageUrl },
  });
});

describe('material metadata NDL adapter', () => {
  it('builds licensed national-bibliography ISBN and title queries', () => {
    const isbn = classifyMaterialMetadataQuery('978-4-02-331568-6');
    const title = classifyMaterialMetadataQuery(' 金のフレーズ ');

    expect(isbn).toEqual({ kind: 'isbn', value: '9784023315686' });
    expect(title).toEqual({ kind: 'title', value: '金のフレーズ' });

    const isbnUrl = new URL(buildNdlOpenSearchUrl(isbn!));
    const titleUrl = new URL(buildNdlOpenSearchUrl(title!));
    expect(isbnUrl.searchParams.get('dpid')).toBe('iss-ndl-opac-national');
    expect(isbnUrl.searchParams.get('isbn')).toBe('9784023315686');
    expect(isbnUrl.searchParams.get('cnt')).toBe('8');
    expect(titleUrl.searchParams.get('dpid')).toBe('iss-ndl-opac-national');
    expect(titleUrl.searchParams.get('title')).toBe('金のフレーズ');
  });

  it('builds a DC-NDL v3 SRU query for selected-book details', () => {
    const url = new URL(buildNdlSruDetailsUrl('978-4-02-331568-6'));

    expect(url.origin + url.pathname).toBe('https://ndlsearch.ndl.go.jp/api/sru');
    expect(url.searchParams.get('recordSchema')).toBe('dcndl_v3');
    expect(url.searchParams.get('recordPacking')).toBe('xml');
    expect(url.searchParams.get('onlyBib')).toBe('true');
    expect(url.searchParams.get('maximumRecords')).toBe('1');
    expect(url.searchParams.get('query')).toBe(
      'dpid="iss-ndl-opac-national" AND isbn="9784023315686"',
    );
  });

  it('normalizes book metadata and ignores records without ISBN identity', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <channel>
          <item>
            <title><![CDATA[TOEIC L&amp;R TEST 出る単特急 金のフレーズ]]></title>
            <dc:creator>TEX加藤</dc:creator>
            <dc:publisher>朝日新聞出版</dc:publisher>
            <dc:date>2023-02</dc:date>
            <dc:identifier xsi:type="dcndl:ISBN">978-4-02-331568-6</dc:identifier>
          </item>
          <item>
            <title>ISBNのない資料</title>
            <dc:creator>誰か</dc:creator>
          </item>
        </channel>
      </rss>`;

    expect(parseNdlOpenSearchXml(xml)).toEqual([
      {
        catalogEntryId: 'isbn13:9784023315686',
        title: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
        authors: ['TEX加藤'],
        publisher: '朝日新聞出版',
        publishedYear: 2023,
        isbn13: '9784023315686',
      },
    ]);
  });

  it('extracts edition, page count and table of contents from DC-NDL v3 details', () => {
    const xml = `<?xml version="1.0"?>
      <searchRetrieveResponse xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcndl="http://ndl.go.jp/dcndl/terms/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <records>
          <record>
            <recordData>
              <rdf:RDF>
                <dcndl:BibResource>
                  <dcndl:edition>改訂版</dcndl:edition>
                  <dcterms:extent>381p ; 19cm</dcterms:extent>
                  <dcterms:tableOfContents>
                    <rdf:Description>
                      <dcterms:title>第1章 基礎</dcterms:title>
                      <dcterms:title>第2章 実践</dcterms:title>
                    </rdf:Description>
                  </dcterms:tableOfContents>
                </dcndl:BibResource>
              </rdf:RDF>
            </recordData>
          </record>
        </records>
      </searchRetrieveResponse>`;

    expect(parseNdlSruDetailsXml(xml, {
      catalogEntryId: 'isbn13:9784023315686',
      title: '教材',
      authors: [],
      isbn13: '9784023315686',
    })).toEqual({
      catalogEntryId: 'isbn13:9784023315686',
      title: '教材',
      authors: [],
      isbn13: '9784023315686',
      edition: '改訂版',
      pageCount: 381,
      tableOfContents: ['第1章 基礎', '第2章 実践'],
    });
  });

  it('adds an openBD cover URL to an NDL search result without persisting provider image data', async () => {
    const ndlXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <channel>
          <item>
            <title>TOEIC L&amp;R TEST 出る単特急 金のフレーズ</title>
            <dc:creator>TEX加藤</dc:creator>
            <dc:publisher>朝日新聞出版</dc:publisher>
            <dc:identifier xsi:type="dcndl:ISBN">978-4-02-331568-6</dc:identifier>
          </item>
        </channel>
      </rss>`;
    const coverUrl = 'https://cover.openbd.jp/9784023315686.jpg';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return new Response(JSON.stringify({
          users: [{ localId: 'user-1', emailVerified: true }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('https://ndlsearch.ndl.go.jp/api/opensearch')) {
        return new Response(ndlXml, { status: 200 });
      }
      if (url.startsWith('https://api.openbd.jp/v1/get')) {
        return new Response(JSON.stringify([
          { summary: { isbn: '9784023315686', cover: coverUrl } },
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleMaterialMetadataApi(
      new Request('https://worker.example/material-metadata/search', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
          Origin: 'https://app.example',
        },
        body: JSON.stringify({ query: '9784023315686' }),
      }),
      {
        FIREBASE_WEB_API_KEY: 'test-key',
        ALLOWED_ORIGIN: 'https://app.example',
        FIREBASE_PROJECT_ID: '',
        FIREBASE_SERVICE_ACCOUNT_EMAIL: '',
        FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: '',
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      results: Array<{ coverImageUrl?: string; isbn13?: string }>;
    };
    expect(payload.results[0]).toMatchObject({
      isbn13: '9784023315686',
      coverImageUrl: coverUrl,
    });
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).startsWith('https://api.openbd.jp/v1/get?isbn=9784023315686')))
      .toBe(true);
  });
});
