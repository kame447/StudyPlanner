import {
  isMaterialMetadataCandidate,
  type MaterialMetadataCandidate,
  type MaterialMetadataSearchResponse,
} from '../../shared/materialMetadataContract';
import { getCloudflareAiProxyUrl } from '../lib/aiConfig';
import { getFirebaseAuth } from '../lib/firebaseClient';
import { searchBuiltInMaterialCatalog } from './builtInMaterialCatalog';

interface WorkerResponse {
  results?: unknown;
  cacheHit?: unknown;
  error?: string;
}

export function buildMaterialMetadataEndpoint(proxyUrl: string): string {
  const baseUrl = proxyUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/timetable-ocr$/, '')
    .replace(/\/planning-attachment$/, '')
    .replace(/\/planning-transcription$/, '')
    .replace(/\/material-metadata\/search$/, '');
  return `${baseUrl}/material-metadata/search`;
}

function normalizeWorkerResponse(value: WorkerResponse): MaterialMetadataSearchResponse | null {
  if (!Array.isArray(value.results)) return null;
  const results = value.results.filter(isMaterialMetadataCandidate);
  return {
    results,
    cacheHit: value.cacheHit === true,
  };
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

  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth?.currentUser) {
    throw new Error('教材検索にはログインが必要です。手入力で登録できます。');
  }

  const idToken = await firebaseAuth.currentUser.getIdToken();
  const response = await fetch(buildMaterialMetadataEndpoint(proxyUrl), {
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
      payload.error || '教材検索を一時的に利用できません。手入力で登録できます。',
    );
  }

  const normalized = normalizeWorkerResponse(payload);
  if (!normalized) {
    throw new Error('教材検索の結果を読み取れませんでした。手入力で登録できます。');
  }
  return normalized;
}

export type { MaterialMetadataCandidate };
