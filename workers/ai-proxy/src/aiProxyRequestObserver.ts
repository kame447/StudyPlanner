import { getUtf8ByteLength } from '../../../shared/aiProxyContract';
import type {
  AiRequestMetricPayload,
  AiRequestMetricStatus,
} from '../../../shared/productObservabilityContract';
import { resolveChatModel } from './modelPolicy';
import {
  createAiRequestId,
  isAiRequestObservabilityConfigured,
  recordAiRequestMetricBestEffort,
  resolveAiRequestPhase,
  type AiRequestUsage,
} from './aiRequestObservability';
import type { ProductObservabilityEnv } from './productObservabilityStore';

export interface AiProxyRequestObserverEnv extends ProductObservabilityEnv {
  FIREBASE_WEB_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
}

interface FirebaseLookupResponse {
  users?: Array<{
    localId?: string;
    emailVerified?: boolean;
  }>;
}

interface ObservedOperation {
  operationKind: AiRequestMetricPayload['operationKind'];
  provider: AiRequestMetricPayload['provider'];
  purpose: string;
  phase: AiRequestMetricPayload['phase'];
  model: string;
}

const AI_REQUEST_ID_HEADER = 'X-StudyPlanner-AI-Request-Id';
const APP_VERSION_HEADER = 'X-StudyPlanner-App-Version';
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
const OBSERVABLE_PATHS = new Set([
  '/',
  '/chat/completions',
  '/planning-attachment',
  '/timetable-ocr',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
}

function validRequestId(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(normalized) ? normalized : null;
}

export function isObservableAiProxyPath(pathname: string): boolean {
  return OBSERVABLE_PATHS.has(pathname);
}

async function resolveFirebaseUid(
  request: Request,
  env: AiProxyRequestObserverEnv,
): Promise<string | null> {
  const apiKey = env.FIREBASE_WEB_API_KEY?.trim() ?? '';
  const token = bearerToken(request);
  if (!apiKey || !token) return null;

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      },
    );
    if (!response.ok) return null;
    const payload = await response.json() as FirebaseLookupResponse;
    const user = payload.users?.[0];
    if (!user?.localId || user.emailVerified === false) return null;
    return user.localId;
  } catch {
    return null;
  }
}

function resolvedChatOperation(payload: Record<string, unknown>): ObservedOperation | null {
  const purpose = typeof payload.purpose === 'string' && payload.purpose.trim()
    ? payload.purpose.trim()
    : 'general';
  const resolution = resolveChatModel({
    purpose: typeof payload.purpose === 'string' ? payload.purpose : undefined,
    model: typeof payload.model === 'string' ? payload.model : undefined,
  });
  if ('error' in resolution) return null;
  const messages = Array.isArray(payload.messages)
    ? payload.messages.filter(isRecord).map((message) => ({
        role: typeof message.role === 'string' ? message.role : undefined,
        content: typeof message.content === 'string' ? message.content : undefined,
      }))
    : [];
  return {
    operationKind: 'chat_completion',
    provider: 'openai',
    purpose,
    phase: resolveAiRequestPhase(
      typeof payload.purpose === 'string' ? payload.purpose : undefined,
      messages,
    ),
    model: resolution.model,
  };
}

export function describeAiProxyOperation(
  pathname: string,
  payload: unknown,
  env: Pick<AiProxyRequestObserverEnv, 'GEMINI_MODEL'>,
): ObservedOperation | null {
  if (pathname === '/' || pathname === '/chat/completions') {
    return isRecord(payload) ? resolvedChatOperation(payload) : null;
  }
  if (pathname === '/planning-attachment') {
    const resolution = resolveChatModel({ purpose: 'weekly_planning_attachment' });
    return 'error' in resolution ? null : {
      operationKind: 'planning_attachment',
      provider: 'openai',
      purpose: 'weekly_planning_attachment',
      phase: 'single',
      model: resolution.model,
    };
  }
  if (pathname === '/timetable-ocr') {
    return {
      operationKind: 'timetable_ocr',
      provider: 'gemini',
      purpose: 'timetable_ocr',
      phase: 'single',
      model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    };
  }
  return null;
}

export function classifyAiProxyMetricStatus(
  responseStatus: number,
  responsePayload: unknown,
): AiRequestMetricStatus | null {
  if (responseStatus >= 200 && responseStatus < 300) return 'success';
  if (responseStatus === 429) return 'quota_rejected';
  if (responseStatus === 502) {
    const error = isRecord(responsePayload) && typeof responsePayload.error === 'string'
      ? responsePayload.error.toLowerCase()
      : '';
    if (error.includes('empty')) return 'empty_response';
    if (error.includes('parse') || error.includes('could not be parsed')) {
      return 'invalid_response';
    }
    return 'provider_error';
  }
  if (responseStatus >= 500) return 'unknown_failure';
  return null;
}

async function parseJsonOrNull(text: string): Promise<unknown> {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function observeAiProxyRequest(params: {
  request: Request;
  response: Response;
  env: AiProxyRequestObserverEnv;
  startedAtMs: number;
  occurredAt: string;
  usage?: AiRequestUsage | null;
  onError?: (error: unknown) => void;
}): Promise<void> {
  if (!isAiRequestObservabilityConfigured(params.env)) return;
  if (params.request.method !== 'POST') return;
  const pathname = new URL(params.request.url).pathname;
  if (!isObservableAiProxyPath(pathname)) return;

  const requestText = await params.request.text();
  const requestPayload = await parseJsonOrNull(requestText);
  const operation = describeAiProxyOperation(pathname, requestPayload, params.env);
  if (!operation) return;

  const responseText = await params.response.text();
  const responsePayload = await parseJsonOrNull(responseText);
  const status = classifyAiProxyMetricStatus(params.response.status, responsePayload);
  if (!status) return;

  const firebaseUid = await resolveFirebaseUid(params.request, params.env);
  if (!firebaseUid) return;

  const requestId = validRequestId(params.request.headers.get(AI_REQUEST_ID_HEADER))
    ?? createAiRequestId();
  const appVersion = params.request.headers.get(APP_VERSION_HEADER)?.trim() || 'unknown';

  await recordAiRequestMetricBestEffort({
    env: params.env,
    firebaseUid,
    requestId,
    occurredAt: params.occurredAt,
    appVersion,
    operationKind: operation.operationKind,
    purpose: operation.purpose,
    phase: operation.phase,
    provider: operation.provider,
    model: operation.model,
    status,
    requestBytes: getUtf8ByteLength(requestText),
    responseBytes: getUtf8ByteLength(responseText),
    usage: params.usage ?? null,
    startedAtMs: params.startedAtMs,
    onError: params.onError,
  });
}
