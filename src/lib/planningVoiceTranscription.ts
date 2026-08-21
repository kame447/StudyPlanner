import { getCloudflareAiProxyUrl } from './aiConfig';
import { getFirebaseAuth } from './firebaseClient';

interface PlanningVoiceTranscriptionWorkerResponse {
  result?: unknown;
  error?: string;
}

interface PlanningVoiceTranscriptionResult {
  text: string;
}

export const MAX_PLANNING_VOICE_CONTEXT_LENGTH = 4000;
export const MAX_PLANNING_VOICE_BYTES = 4 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizePlanningVoiceTranscriptionResult(
  value: unknown,
): PlanningVoiceTranscriptionResult {
  if (!isRecord(value) || typeof value.text !== 'string') {
    return { text: '' };
  }

  return {
    text: value.text.trim().slice(0, MAX_PLANNING_VOICE_CONTEXT_LENGTH),
  };
}

export function buildPlanningVoiceTranscriptionEndpoint(proxyUrl: string): string {
  const baseUrl = proxyUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/timetable-ocr$/, '')
    .replace(/\/planning-attachment$/, '')
    .replace(/\/planning-transcription$/, '');

  return `${baseUrl}/planning-transcription`;
}

function normalizeAudioMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() || 'audio/webm';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function parseWorkerResponse(text: string): PlanningVoiceTranscriptionWorkerResponse {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed as PlanningVoiceTranscriptionWorkerResponse : {};
  } catch {
    return {};
  }
}

export async function transcribePlanningVoice(
  blob: Blob,
): Promise<PlanningVoiceTranscriptionResult> {
  if (blob.size <= 0) {
    throw new Error('録音された音声が空でした。もう一度お試しください。');
  }
  if (blob.size > MAX_PLANNING_VOICE_BYTES) {
    throw new Error('音声が長すぎます。短く区切ってもう一度お試しください。');
  }

  const proxyUrl = getCloudflareAiProxyUrl();
  if (!proxyUrl) {
    throw new Error('音声入力用のAI Proxy URLが設定されていません。VITE_CLOUDFLARE_AI_PROXY_URLを確認してください。');
  }

  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth?.currentUser) {
    throw new Error('ログイン済みユーザーのFirebaseセッションが見つかりません。再ログインしてから試してください。');
  }

  const idToken = await firebaseAuth.currentUser.getIdToken();
  const endpoint = buildPlanningVoiceTranscriptionEndpoint(proxyUrl);
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        mimeType: normalizeAudioMimeType(blob.type),
        base64: await blobToBase64(blob),
      }),
    });
  } catch {
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '現在の送信元';
    throw new Error(
      `音声文字起こしAPIへ接続できませんでした。${currentOrigin} がWorkerのALLOWED_ORIGINに含まれているか、HTTPSで開いているか確認してください。`,
    );
  }

  const responseText = await response.text();
  const result = parseWorkerResponse(responseText);

  if (!response.ok) {
    const detail = result.error?.trim();
    throw new Error(
      detail
        ? `音声文字起こしに失敗しました (${response.status}): ${detail}`
        : `音声文字起こしに失敗しました (${response.status})。Workerのデプロイ状態を確認してください。`,
    );
  }
  if (!result.result) {
    throw new Error('音声文字起こしAPIから結果が返りませんでした。');
  }

  const normalized = normalizePlanningVoiceTranscriptionResult(result.result);
  if (!normalized.text) {
    throw new Error('音声から文字を認識できませんでした。もう一度お試しください。');
  }

  return normalized;
}
