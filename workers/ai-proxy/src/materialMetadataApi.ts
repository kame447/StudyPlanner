import {
  classifyMaterialMetadataQuery,
  isMaterialMetadataCandidate,
  normalizeIsbn,
  normalizeMaterialCatalogTitle,
  type MaterialMetadataCandidate,
  type MaterialMetadataDetailsResponse,
  type MaterialMetadataSearchResponse,
} from '../../../shared/materialMetadataContract';
import {
  FirestoreServiceAccountClient,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';

export interface MaterialMetadataApiEnv extends FirestoreServiceAccountEnv {
  FIREBASE_WEB_API_KEY: string;
  ALLOWED_ORIGIN?: string;
}

interface CatalogRecord extends MaterialMetadataCandidate {
  schemaVersion: 2;
  normalizedTitle: string;
  sourceProvider: 'ndl-search';
  sourceRecordId?: string;
  cachedAt: string;
}

interface FirebaseLookupResponse {
  users?: Array<{ localId?: string; emailVerified?: boolean }>;
}

interface OpenBdRecord {
  summary?: {
    isbn?: string;
    cover?: string;
  };
}

const SEARCH_PATH = '/material-metadata/search';
const DETAILS_PATH = '/material-metadata/details';
const CATALOG_COLLECTION = 'material_metadata_catalog';
const NDL_OPENSEARCH_URL = 'https://ndlsearch.ndl.go.jp/api/opensearch';
const NDL_SRU_URL = 'https://ndlsearch.ndl.go.jp/api/sru';
const NDL_DATA_PROVIDER_ID = 'iss-ndl-opac-national';
const OPENBD_GET_URL = 'https://api.openbd.jp/v1/get';
const MAX_QUERY_BODY_BYTES = 2048;
const MAX_RESULTS = 8;
const MAX_TOC_ITEMS = 80;

export function isMaterialMetadataPath(pathname: string): boolean {
  return pathname === SEARCH_PATH || pathname === DETAILS_PATH;
}

function allowedOrigins(env: MaterialMetadataApiEnv): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGIN ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function corsOrigin(request: Request, env: MaterialMetadataApiEnv): string | null {
  const origin = request.headers.get('Origin')?.trim();
  if (!origin) return null;
  return allowedOrigins(env).has(origin) ? origin : '';
}

function responseHeaders(request: Request, env: MaterialMetadataApiEnv): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  const origin = corsOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return headers;
}

function jsonResponse(
  request: Request,
  env: MaterialMetadataApiEnv,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request, env),
  });
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
}

async function requireFirebaseUser(
  request: Request,
  env: MaterialMetadataApiEnv,
): Promise<Response | string> {
  const apiKey = env.FIREBASE_WEB_API_KEY?.trim();
  if (!apiKey) {
    return jsonResponse(request, env, 500, { error: 'Firebase認証の設定が不足しています。' });
  }
  const token = bearerToken(request);
  if (!token) {
    return jsonResponse(request, env, 401, { error: 'ログイン情報を確認できませんでした。' });
  }
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    },
  );
  if (!response.ok) {
    return jsonResponse(request, env, 401, { error: 'ログイン情報の有効期限を確認してください。' });
  }
  const payload = await response.json() as FirebaseLookupResponse;
  const user = payload.users?.[0];
  if (!user?.localId) {
    return jsonResponse(request, env, 401, { error: 'ログイン済みユーザーを確認できませんでした。' });
  }
  if (user.emailVerified === false) {
    return jsonResponse(request, env, 403, { error: 'メール確認を完了してから利用してください。' });
  }
  return user.localId;
}

function serviceAccountConfigured(env: MaterialMetadataApiEnv): boolean {
  return Boolean(
    env.FIREBASE_PROJECT_ID?.trim()
      && env.FIREBASE_SERVICE_ACCOUNT_EMAIL?.trim()
      && env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim(),
  );
}

function catalogClient(env: MaterialMetadataApiEnv): FirestoreServiceAccountClient | null {
  return serviceAccountConfigured(env) ? new FirestoreServiceAccountClient(env) : null;
}

function catalogDocumentId(candidate: MaterialMetadataCandidate): string {
  return candidate.catalogEntryId.replace(/[^A-Za-z0-9_-]/g, '_');
}

function asCatalogCandidate(value: Record<string, unknown> | null): MaterialMetadataCandidate | null {
  if (!value || !isMaterialMetadataCandidate(value)) return null;
  return {
    catalogEntryId: value.catalogEntryId,
    title: value.title,
    authors: value.authors,
    ...(typeof value.publisher === 'string' ? { publisher: value.publisher } : {}),
    ...(Number.isInteger(value.publishedYear) ? { publishedYear: value.publishedYear as number } : {}),
    ...(typeof value.edition === 'string' ? { edition: value.edition } : {}),
    ...(typeof value.isbn10 === 'string' ? { isbn10: value.isbn10 } : {}),
    ...(typeof value.isbn13 === 'string' ? { isbn13: value.isbn13 } : {}),
    ...(Number.isInteger(value.pageCount) ? { pageCount: value.pageCount as number } : {}),
    ...(Array.isArray(value.tableOfContents)
      ? { tableOfContents: value.tableOfContents.filter((item): item is string => typeof item === 'string') }
      : {}),
  };
}

async function lookupCatalog(
  client: FirestoreServiceAccountClient | null,
  query: ReturnType<typeof classifyMaterialMetadataQuery>,
): Promise<MaterialMetadataCandidate[]> {
  if (!client || !query) return [];
  try {
    if (query.kind === 'isbn') {
      const directId = query.value.length === 13
        ? `isbn13_${query.value}`
        : `isbn10_${query.value}`;
      const direct = asCatalogCandidate(await client.getDocument(CATALOG_COLLECTION, directId));
      if (direct) return [direct];
      const field = query.value.length === 13 ? 'isbn13' : 'isbn10';
      const matches = await client.queryDocuments(CATALOG_COLLECTION, [
        { field, value: query.value },
      ], MAX_RESULTS);
      return matches.flatMap((item) => {
        const candidate = asCatalogCandidate(item);
        return candidate ? [candidate] : [];
      });
    }

    const normalizedTitle = normalizeMaterialCatalogTitle(query.value);
    const matches = await client.queryDocuments(CATALOG_COLLECTION, [
      { field: 'normalizedTitle', value: normalizedTitle },
    ], MAX_RESULTS);
    return matches.flatMap((item) => {
      const candidate = asCatalogCandidate(item);
      return candidate ? [candidate] : [];
    });
  } catch (error) {
    console.warn('[Material Metadata] catalog lookup failed; using provider fallback', {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(value: string): string {
  const withoutCdataMarkers = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeXmlEntities(withoutCdataMarkers.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTagFragments(fragment: string, localName: string): string[] {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${localName}>`,
    'gi',
  );
  return Array.from(fragment.matchAll(pattern)).map((match) => match[1] ?? '');
}

function extractTagValues(fragment: string, localName: string): string[] {
  return extractTagFragments(fragment, localName)
    .map(stripTags)
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isbnFromIdentifiers(values: string[], length: 10 | 13): string | undefined {
  for (const value of values) {
    const matches = value.match(/[0-9Xx][0-9Xx\-\s]{8,20}/g) ?? [];
    for (const match of matches) {
      const normalized = normalizeIsbn(match);
      if (normalized?.length === length) return normalized;
    }
  }
  return undefined;
}

function publishedYearFromValues(values: string[]): number | undefined {
  for (const value of values) {
    const match = value.match(/(?:^|\D)(1\d{3}|20\d{2}|21\d{2})(?:\D|$)/);
    if (!match) continue;
    const year = Number(match[1]);
    if (Number.isInteger(year)) return year;
  }
  return undefined;
}

function pageCountFromExtent(values: string[]): number | undefined {
  for (const value of values) {
    const pageMatch = value.match(/(?:^|\D)(\d{1,5})\s*(?:p\b|pages?\b|ページ)/i);
    if (!pageMatch) continue;
    const pages = Number(pageMatch[1]);
    if (Number.isInteger(pages) && pages > 0) return pages;
  }
  return undefined;
}

function tableOfContentsFromXml(xml: string): string[] {
  const values = extractTagFragments(xml, 'tableOfContents').flatMap((fragment) => {
    const titles = extractTagValues(fragment, 'title');
    if (titles.length > 0) return titles;
    const text = stripTags(fragment);
    return text ? [text] : [];
  });
  return unique(values).slice(0, MAX_TOC_ITEMS);
}

export function parseNdlOpenSearchXml(xml: string): MaterialMetadataCandidate[] {
  const items = Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi));
  const candidates = items.flatMap((match) => {
    const item = match[1] ?? '';
    const title = extractTagValues(item, 'title')[0];
    if (!title) return [];
    const identifiers = extractTagValues(item, 'identifier');
    const isbn13 = isbnFromIdentifiers(identifiers, 13);
    const isbn10 = isbnFromIdentifiers(identifiers, 10);
    if (!isbn13 && !isbn10) return [];
    const catalogEntryId = isbn13 ? `isbn13:${isbn13}` : `isbn10:${isbn10}`;
    const authors = unique(extractTagValues(item, 'creator'));
    const publisher = extractTagValues(item, 'publisher')[0];
    const publishedYear = publishedYearFromValues(extractTagValues(item, 'date'));
    return [{
      catalogEntryId,
      title,
      authors,
      ...(publisher ? { publisher } : {}),
      ...(publishedYear ? { publishedYear } : {}),
      ...(isbn10 ? { isbn10 } : {}),
      ...(isbn13 ? { isbn13 } : {}),
    } satisfies MaterialMetadataCandidate];
  });

  return Array.from(
    new Map(candidates.map((candidate) => [candidate.catalogEntryId, candidate])).values(),
  ).slice(0, MAX_RESULTS);
}

export function buildNdlOpenSearchUrl(
  query: NonNullable<ReturnType<typeof classifyMaterialMetadataQuery>>,
): string {
  const url = new URL(NDL_OPENSEARCH_URL);
  url.searchParams.set('dpid', NDL_DATA_PROVIDER_ID);
  url.searchParams.set('cnt', String(MAX_RESULTS));
  url.searchParams.set(query.kind === 'isbn' ? 'isbn' : 'title', query.value);
  return url.toString();
}

export function buildNdlSruDetailsUrl(isbn: string): string {
  const normalized = normalizeIsbn(isbn);
  if (!normalized) throw new Error('A valid ISBN is required for NDL details lookup.');
  const url = new URL(NDL_SRU_URL);
  url.searchParams.set('operation', 'searchRetrieve');
  url.searchParams.set('version', '1.2');
  url.searchParams.set('recordSchema', 'dcndl_v3');
  url.searchParams.set('recordPacking', 'xml');
  url.searchParams.set('onlyBib', 'true');
  url.searchParams.set('maximumRecords', '1');
  url.searchParams.set(
    'query',
    `dpid="${NDL_DATA_PROVIDER_ID}" AND isbn="${normalized}"`,
  );
  return url.toString();
}

export function parseNdlSruDetailsXml(
  xml: string,
  candidate: MaterialMetadataCandidate,
): MaterialMetadataCandidate {
  const pageCount = pageCountFromExtent(extractTagValues(xml, 'extent'));
  const edition = extractTagValues(xml, 'edition')[0];
  const tableOfContents = tableOfContentsFromXml(xml);
  return {
    ...candidate,
    ...(edition ? { edition } : {}),
    ...(pageCount ? { pageCount } : {}),
    ...(tableOfContents.length > 0 ? { tableOfContents } : {}),
  };
}

async function searchNdl(
  query: NonNullable<ReturnType<typeof classifyMaterialMetadataQuery>>,
): Promise<MaterialMetadataCandidate[]> {
  const response = await fetch(buildNdlOpenSearchUrl(query), {
    headers: {
      Accept: 'application/xml,text/xml,application/rss+xml;q=0.9,*/*;q=0.1',
      'User-Agent': 'StudyPlanner material metadata lookup',
    },
  });
  if (!response.ok) {
    throw new Error(`NDL Search request failed: ${response.status}`);
  }
  return parseNdlOpenSearchXml(await response.text());
}

async function enrichNdlDetails(
  candidate: MaterialMetadataCandidate,
): Promise<MaterialMetadataCandidate> {
  const isbn = candidate.isbn13 ?? candidate.isbn10;
  if (!isbn) return candidate;
  if (candidate.pageCount && candidate.tableOfContents?.length) return candidate;
  const response = await fetch(buildNdlSruDetailsUrl(isbn), {
    headers: {
      Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
      'User-Agent': 'StudyPlanner material metadata details',
    },
  });
  if (!response.ok) return candidate;
  return parseNdlSruDetailsXml(await response.text(), candidate);
}

function parseOpenBdCoverMap(payload: unknown): Map<string, string> {
  const covers = new Map<string, string>();
  if (!Array.isArray(payload)) return covers;
  payload.forEach((value) => {
    if (!value || typeof value !== 'object') return;
    const summary = (value as OpenBdRecord).summary;
    const isbn = typeof summary?.isbn === 'string' ? normalizeIsbn(summary.isbn) : null;
    const cover = typeof summary?.cover === 'string' ? summary.cover.trim() : '';
    if (isbn && cover && /^https?:\/\//i.test(cover)) covers.set(isbn, cover);
  });
  return covers;
}

async function enrichCoverUrls(
  candidates: MaterialMetadataCandidate[],
): Promise<MaterialMetadataCandidate[]> {
  const isbns = unique(
    candidates.flatMap((candidate) => {
      const isbn = candidate.isbn13 ?? candidate.isbn10;
      return isbn ? [isbn] : [];
    }),
  );
  if (isbns.length === 0) return candidates;

  try {
    const url = new URL(OPENBD_GET_URL);
    url.searchParams.set('isbn', isbns.join(','));
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'StudyPlanner material cover lookup',
      },
    });
    if (!response.ok) return candidates;
    const covers = parseOpenBdCoverMap(await response.json());
    return candidates.map((candidate) => {
      const isbn = candidate.isbn13 ?? candidate.isbn10;
      const coverImageUrl = isbn ? covers.get(isbn) : undefined;
      return coverImageUrl ? { ...candidate, coverImageUrl } : candidate;
    });
  } catch (error) {
    console.warn('[Material Metadata] cover enrichment failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return candidates;
  }
}

function cacheableCandidate(candidate: MaterialMetadataCandidate): MaterialMetadataCandidate {
  const { coverImageUrl: _coverImageUrl, ...rest } = candidate;
  return rest;
}

async function cacheCandidates(
  client: FirestoreServiceAccountClient | null,
  candidates: MaterialMetadataCandidate[],
): Promise<void> {
  if (!client || candidates.length === 0) return;
  const cachedAt = new Date().toISOString();
  const writes = candidates.map(async (sourceCandidate) => {
    const candidate = cacheableCandidate(sourceCandidate);
    const value: CatalogRecord = {
      schemaVersion: 2,
      ...candidate,
      normalizedTitle: normalizeMaterialCatalogTitle(candidate.title),
      sourceProvider: 'ndl-search',
      cachedAt,
    };
    await client.setDocument(CATALOG_COLLECTION, catalogDocumentId(candidate), value);
  });
  const results = await Promise.allSettled(writes);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.warn('[Material Metadata] catalog cache write failed', {
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });
}

function pickCandidateForDetails(
  candidates: MaterialMetadataCandidate[],
  query: NonNullable<ReturnType<typeof classifyMaterialMetadataQuery>>,
): MaterialMetadataCandidate | null {
  if (candidates.length === 0) return null;
  if (query.kind === 'isbn') return candidates[0] ?? null;
  const normalizedTitle = normalizeMaterialCatalogTitle(query.value);
  return candidates.find(
    (candidate) => normalizeMaterialCatalogTitle(candidate.title) === normalizedTitle,
  ) ?? candidates[0] ?? null;
}

async function resolveCandidateForDetails(
  client: FirestoreServiceAccountClient | null,
  query: NonNullable<ReturnType<typeof classifyMaterialMetadataQuery>>,
): Promise<MaterialMetadataCandidate | null> {
  const cached = await lookupCatalog(client, query);
  let candidate = pickCandidateForDetails(cached, query);
  if (!candidate) {
    const searched = await searchNdl(query);
    await cacheCandidates(client, searched);
    candidate = pickCandidateForDetails(searched, query);
  }
  if (!candidate) return null;
  const enriched = await enrichNdlDetails(candidate);
  await cacheCandidates(client, [enriched]);
  return (await enrichCoverUrls([enriched]))[0] ?? enriched;
}

async function readQueryPayload(
  request: Request,
  env: MaterialMetadataApiEnv,
): Promise<Response | NonNullable<ReturnType<typeof classifyMaterialMetadataQuery>>> {
  const declaredLength = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_QUERY_BODY_BYTES) {
    return jsonResponse(request, env, 413, { error: '検索条件が長すぎます。' });
  }
  const requestText = await request.text();
  if (new TextEncoder().encode(requestText).byteLength > MAX_QUERY_BODY_BYTES) {
    return jsonResponse(request, env, 413, { error: '検索条件が長すぎます。' });
  }

  let payload: { query?: unknown };
  try {
    payload = JSON.parse(requestText) as { query?: unknown };
  } catch {
    return jsonResponse(request, env, 400, { error: '検索条件を読み取れませんでした。' });
  }
  if (typeof payload.query !== 'string') {
    return jsonResponse(request, env, 400, { error: 'ISBNまたは教材名を入力してください。' });
  }
  const query = classifyMaterialMetadataQuery(payload.query);
  if (!query) {
    return jsonResponse(request, env, 400, { error: 'ISBNまたは2文字以上の教材名を入力してください。' });
  }
  return query;
}

export async function handleMaterialMetadataApi(
  request: Request,
  env: MaterialMetadataApiEnv,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (!isMaterialMetadataPath(pathname)) {
    return jsonResponse(request, env, 404, { error: 'Not found.' });
  }
  const origin = corsOrigin(request, env);
  if (origin === '') {
    return jsonResponse(request, env, 403, { error: 'Origin is not allowed.' });
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders(request, env) });
  }
  if (request.method !== 'POST') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed.' });
  }
  const user = await requireFirebaseUser(request, env);
  if (user instanceof Response) return user;

  const query = await readQueryPayload(request, env);
  if (query instanceof Response) return query;
  const client = catalogClient(env);

  if (pathname === DETAILS_PATH) {
    try {
      const candidate = await resolveCandidateForDetails(client, query);
      if (!candidate) {
        return jsonResponse(request, env, 404, {
          error: '詳しい教材情報が見つかりませんでした。基本情報のまま登録できます。',
        });
      }
      const body: MaterialMetadataDetailsResponse = { candidate };
      return jsonResponse(request, env, 200, body as unknown as Record<string, unknown>);
    } catch (error) {
      console.warn('[Material Metadata] details lookup failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return jsonResponse(request, env, 502, {
        error: '詳しい教材情報を取得できませんでした。基本情報のまま登録できます。',
      });
    }
  }

  const cached = await lookupCatalog(client, query);
  if (cached.length > 0) {
    const results = await enrichCoverUrls(cached);
    const body: MaterialMetadataSearchResponse = { results, cacheHit: true };
    return jsonResponse(request, env, 200, body as unknown as Record<string, unknown>);
  }

  try {
    const providerResults = await searchNdl(query);
    await cacheCandidates(client, providerResults);
    const results = await enrichCoverUrls(providerResults);
    const body: MaterialMetadataSearchResponse = { results, cacheHit: false };
    return jsonResponse(request, env, 200, body as unknown as Record<string, unknown>);
  } catch (error) {
    console.warn('[Material Metadata] provider search failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(request, env, 502, {
      error: '教材検索を一時的に利用できません。手入力で教材を登録できます。',
    });
  }
}
