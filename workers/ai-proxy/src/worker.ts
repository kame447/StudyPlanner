import aiProxyWorker, { AiQuotaDurableObject } from './index';
import { DEFAULT_ALLOWED_CHAT_MODELS, resolveChatModel } from './modelPolicy';
import {
  AI_PROXY_CHAT_REQUEST_LIMITS,
  getUtf8ByteLength,
  resolveOpenAiChatTemperature,
} from '../../../shared/aiProxyContract';
import {
  handleWeeklyPlanningTraceApi,
  isWeeklyPlanningTracePath,
  type WeeklyPlanningTraceApiEnv,
  type WeeklyPlanningTraceApiSession,
} from './weeklyPlanningTraceApi';

export { AiQuotaDurableObject };

interface Env extends WeeklyPlanningTraceApiEnv {
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
  FIREBASE_WEB_API_KEY: string;
  ALLOWED_ORIGIN?: string;
  ALLOWED_CHAT_MODELS?: string;
  ENVIRONMENT?: string;
  AI_QUOTA: DurableObjectNamespace<AiQuotaDurableObject>;
}

interface FirebaseLookupResponse {
  users?: Array<{
    localId?: string;
    emailVerified?: boolean;
  }>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model?: string;
  purpose?: string;
  temperature?: number;
  messages?: ChatMessage[];
  response_format?: Record<string, unknown>;
  max_tokens?: number;
  max_completion_tokens?: number;
}

interface AiQuotaWindowRule {
  name: string;
  limit: number;
  windowId: string;
  resetAt: number;
}

interface AiQuotaCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  exceededRule?: string;
  limit?: number;
  remaining?: number;
}

const CHAT_UID_MINUTE_LIMIT = 5;
const CHAT_UID_DAY_LIMIT = 100;
const IP_MINUTE_LIMIT = 20;
const MINUTE_WINDOW_MS = 60 * 1000;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAILY_QUOTA_OFFSET_MS = 9 * 60 * 60 * 1000;
const ALLOWED_MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);
const CHAT_PROXY_VERSION = 'weekly-planning-request-budget-20260723-001';

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGIN ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function corsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin')?.trim();
  if (!origin) return null;
  return allowedOrigins(env).has(origin) ? origin : '';
}

function responseHeaders(
  request: Request,
  env: Env,
  extraHeaders: Record<string, string> = {},
): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-StudyPlanner-Proxy-Version': CHAT_PROXY_VERSION,
    ...extraHeaders,
  });
  const origin = corsOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  return headers;
}

function jsonResponse(
  request: Request,
  env: Env,
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request, env, extraHeaders),
  });
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
}

async function requireFirebaseSession(
  request: Request,
  env: Env,
): Promise<Response | WeeklyPlanningTraceApiSession> {
  const apiKey = env.FIREBASE_WEB_API_KEY?.trim();
  if (!apiKey) {
    return jsonResponse(request, env, 500, {
      ok: false,
      error: 'Firebase認証の設定が不足しています。',
    });
  }

  const token = bearerToken(request);
  if (!token) {
    return jsonResponse(request, env, 401, {
      ok: false,
      error: 'ログイン情報を確認できませんでした。',
    });
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
    return jsonResponse(request, env, 401, {
      ok: false,
      error: 'ログイン情報の有効期限を確認してください。',
    });
  }

  const payload = await response.json() as FirebaseLookupResponse;
  const user = payload.users?.[0];
  if (!user?.localId) {
    return jsonResponse(request, env, 401, {
      ok: false,
      error: 'ログイン済みユーザーを確認できませんでした。',
    });
  }
  if (user.emailVerified === false) {
    return jsonResponse(request, env, 403, {
      ok: false,
      error: 'メール確認を完了してからログインしてください。',
    });
  }

  return { uid: user.localId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateChatRequest(payload: unknown): string | null {
  if (!isRecord(payload)) return 'Invalid chat completion payload.';
  const hasModel = typeof payload.model === 'string' && payload.model.trim().length > 0;
  const hasPurpose = typeof payload.purpose === 'string' && payload.purpose.trim().length > 0;
  if (!hasModel && !hasPurpose) return 'Model or purpose is required.';
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return 'At least one message is required.';
  }
  if (payload.messages.length > AI_PROXY_CHAT_REQUEST_LIMITS.maxMessageCount) {
    return 'Too many messages were supplied.';
  }

  let totalContentLength = 0;
  for (const message of payload.messages) {
    if (
      !isRecord(message)
      || !ALLOWED_MESSAGE_ROLES.has(String(message.role))
      || typeof message.content !== 'string'
    ) {
      return 'Invalid chat message payload.';
    }
    if (message.content.length > AI_PROXY_CHAT_REQUEST_LIMITS.maxMessageContentLength) {
      return 'A message was too long.';
    }
    totalContentLength += message.content.length;
  }
  if (totalContentLength > AI_PROXY_CHAT_REQUEST_LIMITS.maxTotalMessageContentLength) {
    return 'Combined message content was too large.';
  }
  return null;
}

function getAllowedChatModels(env: Env): Set<string> {
  const configuredModels = (env.ALLOWED_CHAT_MODELS ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return new Set(
    configuredModels.length > 0 ? configuredModels : DEFAULT_ALLOWED_CHAT_MODELS,
  );
}

function getChatOutputTokenLimit(payload: ChatCompletionRequest): number {
  const requested =
    typeof payload.max_completion_tokens === 'number'
    && Number.isFinite(payload.max_completion_tokens)
      ? payload.max_completion_tokens
      : typeof payload.max_tokens === 'number' && Number.isFinite(payload.max_tokens)
        ? payload.max_tokens
        : AI_PROXY_CHAT_REQUEST_LIMITS.defaultOutputTokens;
  return Math.max(
    1,
    Math.min(AI_PROXY_CHAT_REQUEST_LIMITS.maxOutputTokens, Math.floor(requested)),
  );
}

function getChatTemperature(payload: ChatCompletionRequest): number {
  if (typeof payload.temperature !== 'number' || !Number.isFinite(payload.temperature)) {
    return 0.2;
  }
  return Math.max(0, Math.min(2, payload.temperature));
}

function getMinuteWindow(now: number): { windowId: string; resetAt: number } {
  const start = Math.floor(now / MINUTE_WINDOW_MS) * MINUTE_WINDOW_MS;
  return { windowId: String(start), resetAt: start + MINUTE_WINDOW_MS };
}

function getDailyWindow(now: number): { windowId: string; resetAt: number } {
  const shiftedNow = now + DAILY_QUOTA_OFFSET_MS;
  const shiftedStart = Math.floor(shiftedNow / DAY_WINDOW_MS) * DAY_WINDOW_MS;
  return {
    windowId: new Date(shiftedStart).toISOString().slice(0, 10),
    resetAt: shiftedStart + DAY_WINDOW_MS - DAILY_QUOTA_OFFSET_MS,
  };
}

function buildQuotaRules(
  subject: 'uid' | 'ip',
  now = Date.now(),
): AiQuotaWindowRule[] {
  const minute = getMinuteWindow(now);
  if (subject === 'ip') {
    return [{
      name: 'ip:minute',
      limit: IP_MINUTE_LIMIT,
      windowId: minute.windowId,
      resetAt: minute.resetAt,
    }];
  }
  const day = getDailyWindow(now);
  return [
    {
      name: 'chat:uid:minute',
      limit: CHAT_UID_MINUTE_LIMIT,
      windowId: minute.windowId,
      resetAt: minute.resetAt,
    },
    {
      name: 'chat:uid:day',
      limit: CHAT_UID_DAY_LIMIT,
      windowId: day.windowId,
      resetAt: day.resetAt,
    },
  ];
}

function quotaSubjectName(subject: 'uid' | 'ip', key: string): string {
  const normalizedKey = encodeURIComponent(key.trim() || 'unknown').slice(0, 160);
  return `${subject}:${normalizedKey}`;
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')?.trim()
    || request.headers.get('True-Client-IP')?.trim()
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

async function checkQuota(
  env: Env,
  subject: 'uid' | 'ip',
  key: string,
): Promise<AiQuotaCheckResult> {
  const stub = env.AI_QUOTA.getByName(quotaSubjectName(subject, key));
  return await stub.checkAndConsume({ rules: buildQuotaRules(subject) });
}

function rateLimitResponse(
  request: Request,
  env: Env,
  result: AiQuotaCheckResult,
): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterSeconds));
  return jsonResponse(
    request,
    env,
    429,
    { error: 'AI rate limit exceeded.', retryAfterSeconds },
    { 'Retry-After': String(retryAfterSeconds) },
  );
}

async function enforceChatQuota(
  request: Request,
  env: Env,
  uid: string,
): Promise<Response | null> {
  const ipResult = await checkQuota(env, 'ip', clientIp(request));
  if (!ipResult.allowed) return rateLimitResponse(request, env, ipResult);
  const uidResult = await checkQuota(env, 'uid', uid);
  return uidResult.allowed ? null : rateLimitResponse(request, env, uidResult);
}

function bodyTooLargeResponse(
  request: Request,
  env: Env,
  actualBytes: number,
): Response {
  return jsonResponse(request, env, 413, {
    error: 'Request body was too large.',
    errorCode: 'chat_request_body_too_large',
    limitBytes: AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes,
    actualBytes,
  });
}

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY?.trim()) {
    return jsonResponse(request, env, 500, {
      error: 'OPENAI_API_KEY is not configured.',
    });
  }

  const session = await requireFirebaseSession(request, env);
  if (session instanceof Response) return session;

  const declaredBytes = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (
    Number.isFinite(declaredBytes)
    && declaredBytes > AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes
  ) {
    return bodyTooLargeResponse(request, env, declaredBytes);
  }

  const requestText = await request.text();
  const requestBytes = getUtf8ByteLength(requestText);
  if (requestBytes > AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes) {
    return bodyTooLargeResponse(request, env, requestBytes);
  }

  let payload: ChatCompletionRequest;
  try {
    payload = JSON.parse(requestText) as ChatCompletionRequest;
  } catch {
    return jsonResponse(request, env, 400, { error: 'Invalid JSON payload.' });
  }
  const validationError = validateChatRequest(payload);
  if (validationError) {
    return jsonResponse(request, env, 400, { error: validationError });
  }

  const modelResolution = resolveChatModel(payload);
  if ('error' in modelResolution) {
    return jsonResponse(request, env, 400, { error: modelResolution.error });
  }
  if (!getAllowedChatModels(env).has(modelResolution.model)) {
    return jsonResponse(request, env, 400, { error: 'Requested model is not allowed.' });
  }

  const quotaError = await enforceChatQuota(request, env, session.uid);
  if (quotaError) return quotaError;

  const openAiBaseUrl = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1')
    .replace(/\/$/, '');
  const upstreamTemperature = resolveOpenAiChatTemperature(
    modelResolution.model,
    getChatTemperature(payload),
  );
  const upstreamResponse = await fetch(`${openAiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      model: modelResolution.model,
      ...(upstreamTemperature === undefined ? {} : { temperature: upstreamTemperature }),
      messages: payload.messages,
      response_format: payload.response_format,
      max_completion_tokens: getChatOutputTokenLimit(payload),
    }),
  });
  const upstreamText = await upstreamResponse.text();
  if (!upstreamResponse.ok) {
    console.warn('[AI Proxy] OpenAI upstream failed', { status: upstreamResponse.status });
    return jsonResponse(request, env, 502, { error: 'OpenAI request failed.' });
  }

  try {
    const upstreamJson = JSON.parse(upstreamText) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = upstreamJson.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return jsonResponse(request, env, 502, {
        error: 'OpenAI response content was empty.',
      });
    }
    return jsonResponse(request, env, 200, { content });
  } catch {
    return jsonResponse(request, env, 502, {
      error: 'OpenAI response could not be parsed.',
    });
  }
}

async function handleTraceRequest(request: Request, env: Env): Promise<Response> {
  const origin = corsOrigin(request, env);
  if (origin === '') {
    return jsonResponse(request, env, 403, {
      ok: false,
      error: 'この送信元からは利用できません。',
    });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: responseHeaders(request, env),
    });
  }

  const session = await requireFirebaseSession(request, env);
  if (session instanceof Response) return session;

  const result = await handleWeeklyPlanningTraceApi(request, env, session);
  return jsonResponse(request, env, result.status, result.body);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (isWeeklyPlanningTracePath(pathname)) {
      return await handleTraceRequest(request, env);
    }

    if (pathname === '/' || pathname === '/chat/completions') {
      const origin = corsOrigin(request, env);
      if (origin === '') {
        return jsonResponse(request, env, 403, {
          error: 'Origin is not allowed.',
        });
      }
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: responseHeaders(request, env),
        });
      }
      if (request.method !== 'POST') {
        return jsonResponse(request, env, 405, { error: 'Method not allowed.' });
      }
      try {
        return await handleChatRequest(request, env);
      } catch (error) {
        console.error('[AI Proxy] unexpected chat handler failure', error);
        return jsonResponse(request, env, 500, { error: 'Unexpected worker error.' });
      }
    }

    return await aiProxyWorker.fetch(request, env as never);
  },
};
