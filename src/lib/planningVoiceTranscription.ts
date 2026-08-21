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
    throw new Error('AI proxy URL が設定されていません。');
  }

  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth?.currentUser) {
    throw new Error('ログイン済みユーザーの Firebase セッションが見つかりません。');
  }

  const idToken = await firebaseAuth.currentUser.getIdToken();
  const response = await fetch(buildPlanningVoiceTranscriptionEndpoint(proxyUrl), {
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
  const result = (await response.json()) as PlanningVoiceTranscriptionWorkerResponse;

  if (!response.ok || !result.result) {
    throw new Error(
      result.error || '音声を文字起こしできませんでした。もう一度お試しください。',
    );
  }

  const normalized = normalizePlanningVoiceTranscriptionResult(result.result);
  if (!normalized.text) {
    throw new Error('音声から文字を認識できませんでした。もう一度お試しください。');
  }

  return normalized;
}
