import {
  classifyMaterialMetadataQuery,
  isMaterialMetadataCandidate,
  normalizeIsbn,
  normalizeMaterialCatalogTitle,
  type MaterialMetadataCandidate,
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
  schemaVersion: 1;
  normalizedTitle: string;
  sourceProvider: 'ndl-search';
  sourceRecordId?: string;
  cachedAt: string;
}

interface FirebaseLookupResponse {
  users?: Array<{ localId?: string; emailVerified?: boolean }>;
}

const SEARCH_PATH = '/material-metadata/search';
const CATALOG_COLLECTION = 'material_metadata_catalog';
const NDL_OPENSEARCH_URL = 'https://ndlsearch.ndl.go.jp/api/opensearch';
const NDL_DATA_PROVIDER_ID = 'iss-ndl-opac-national';
const MAX_QUERY_BODY_BYTES = 2048;
const MAX_RESULTS = 8;

export function isMaterialMetadataPath(pathname: string): boolean {
  return pathname === SEARCH_PATH;
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
    ...(typeof value.isbn10 === 'string' ? { isbn10: value.isbn10 } : {}),
    ...(typeof value.isbn13 === 'string' ? { isbn13: value.isbn13 } : {}),
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

function extractTagValues(fragment: string, localName: string): string[] {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${localName}>`,
    'gi',
  );
  return Array.from(fragment.matchAll(pattern))
    .map((match) => stripTags(match[1] ?? ''))
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

async function cacheCandidates(
  client: FirestoreServiceAccountClient | null,
  candidates: MaterialMetadataCandidate[],
): Promise<void> {
  if (!client || candidates.length === 0) return;
  const cachedAt = new Date().toISOString();
  const writes = candidates.map(async (candidate) => {
    const value: CatalogRecord = {
      schemaVersion: 1,
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

  const client = catalogClient(env);
  const cached = await lookupCatalog(client, query);
  if (cached.length > 0) {
    const body: MaterialMetadataSearchResponse = { results: cached, cacheHit: true };
    return jsonResponse(request, env, 200, body as unknown as Record<string, unknown>);
  }

  try {
    const results = await searchNdl(query);
    await cacheCandidates(client, results);
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
