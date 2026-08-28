import {
  isMaterialMetadataCandidate,
  type MaterialMetadataCandidate,
  type MaterialMetadataDetailsResponse,
  type MaterialMetadataSearchResponse,
} from '../../shared/materialMetadataContract';
import { getCloudflareAiProxyUrl } from '../lib/aiConfig';
import { getFirebaseAuth } from '../lib/firebaseClient';
import { searchBuiltInMaterialCatalog } from './builtInMaterialCatalog';

interface WorkerResponse {
  results?: unknown;
  candidate?: unknown;
  cacheHit?: unknown;
  error?: string;
}

function materialMetadataBaseUrl(proxyUrl: string): string {
  return proxyUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/timetable-ocr$/, '')
    .replace(/\/planning-attachment$/, '')
    .replace(/\/planning-transcription$/, '')
    .replace(/\/material-metadata\/(?:search|details)$/, '');
}

export function buildMaterialMetadataEndpoint(proxyUrl: string): string {
  return `${materialMetadataBaseUrl(proxyUrl)}/material-metadata/search`;
}

export function buildMaterialMetadataDetailsEndpoint(proxyUrl: string): string {
  return `${materialMetadataBaseUrl(proxyUrl)}/material-metadata/details`;
}

function normalizeWorkerResponse(value: WorkerResponse): MaterialMetadataSearchResponse | null {
  if (!Array.isArray(value.results)) return null;
  const results = value.results.filter(isMaterialMetadataCandidate);
  return {
    results,
    cacheHit: value.cacheHit === true,
  };
}

function normalizeDetailsResponse(value: WorkerResponse): MaterialMetadataDetailsResponse | null {
  return isMaterialMetadataCandidate(value.candidate)
    ? { candidate: value.candidate }
    : null;
}

async function workerRequest(endpoint: string, query: string): Promise<WorkerResponse> {
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth?.currentUser) {
    throw new Error('教材検索にはログインが必要です。手入力で登録できます。');
  }

  const idToken = await firebaseAuth.currentUser.getIdToken();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ query }),
  });
  const payload = (await response.json()) as WorkerResponse;
  if (!response.ok) {
    throw new Error(
      payload.error || '教材情報を一時的に利用できません。手入力で登録できます。',
    );
  }
  return payload;
}

export async function searchMaterialMetadata(
  query: string,
): Promise<MaterialMetadataSearchResponse> {
  const builtInResults = searchBuiltInMaterialCatalog(query);
  if (builtInResults.length > 0) {
    return {
      results: builtInResults,
      cacheHit: true,
    };
  }

  const proxyUrl = getCloudflareAiProxyUrl();
  if (!proxyUrl) {
    throw new Error('教材検索の接続先が設定されていません。手入力で登録できます。');
  }

  const payload = await workerRequest(buildMaterialMetadataEndpoint(proxyUrl), query);
  const normalized = normalizeWorkerResponse(payload);
  if (!normalized) {
    throw new Error('教材検索の結果を読み取れませんでした。手入力で登録できます。');
  }
  return normalized;
}

export async function resolveMaterialMetadataCandidate(
  candidate: MaterialMetadataCandidate,
): Promise<MaterialMetadataCandidate> {
  const proxyUrl = getCloudflareAiProxyUrl();
  if (!proxyUrl) return candidate;

  const query = candidate.isbn13 ?? candidate.isbn10 ?? candidate.title;
  try {
    const payload = await workerRequest(buildMaterialMetadataDetailsEndpoint(proxyUrl), query);
    const normalized = normalizeDetailsResponse(payload);
    return normalized?.candidate ?? candidate;
  } catch {
    return candidate;
  }
}

export type { MaterialMetadataCandidate };
