import { getCloudflareAiProxyUrl } from './aiConfig';
import {
  createAiImageFilePayload,
  type AiImageFilePayload,
} from './aiImageAttachment';
import { getFirebaseAuth } from './firebaseClient';

interface PlanningImageAttachmentWorkerResponse {
  result?: unknown;
  error?: string;
}

interface PlanningImageAttachmentResult {
  text: string;
}

export const MAX_PLANNING_IMAGE_CONTEXT_LENGTH = 1800;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizePlanningImageAttachmentResult(
  value: unknown,
): PlanningImageAttachmentResult {
  if (!isRecord(value) || typeof value.text !== 'string') {
    return { text: '' };
  }

  return {
    text: value.text.trim().slice(0, MAX_PLANNING_IMAGE_CONTEXT_LENGTH),
  };
}

export function buildPlanningImageAttachmentEndpoint(proxyUrl: string): string {
  const baseUrl = proxyUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/timetable-ocr$/, '')
    .replace(/\/planning-attachment$/, '');

  return `${baseUrl}/planning-attachment`;
}

export async function requestPlanningImageAttachment(
  payload: AiImageFilePayload,
): Promise<PlanningImageAttachmentResult> {
  const proxyUrl = getCloudflareAiProxyUrl();

  if (!proxyUrl) {
    throw new Error('AI proxy URL が設定されていません。');
  }

  const firebaseAuth = getFirebaseAuth();

  if (!firebaseAuth?.currentUser) {
    throw new Error('ログイン済みユーザーの Firebase セッションが見つかりません。');
  }

  const idToken = await firebaseAuth.currentUser.getIdToken();
  const response = await fetch(buildPlanningImageAttachmentEndpoint(proxyUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      mimeType: payload.mimeType,
      base64: payload.base64,
    }),
  });
  const result = (await response.json()) as PlanningImageAttachmentWorkerResponse;

  if (!response.ok || !result.result) {
    throw new Error(
      result.error || '画像を読み取れませんでした。画像を確認してもう一度お試しください。',
    );
  }

  const normalized = normalizePlanningImageAttachmentResult(result.result);

  if (!normalized.text) {
    throw new Error('画像から計画に使える情報を読み取れませんでした。');
  }

  return normalized;
}

export async function extractPlanningImageAttachment(
  file: File,
): Promise<PlanningImageAttachmentResult> {
  const payload = await createAiImageFilePayload(file);
  return requestPlanningImageAttachment(payload);
}
