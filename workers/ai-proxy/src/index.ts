import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_ALLOWED_CHAT_MODELS, resolveChatModel } from './modelPolicy';

interface Env {
  OPENAI_API_KEY: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  FIREBASE_WEB_API_KEY: string;
  OPENAI_BASE_URL?: string;
  ALLOWED_ORIGIN?: string;
  ALLOWED_CHAT_MODELS?: string;
  ALLOWED_GEMINI_MODELS?: string;
  DEBUG_ENDPOINT?: string;
  ENVIRONMENT?: string;
  AI_QUOTA: DurableObjectNamespace<AiQuotaDurableObject>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model?: string;
  purpose?: string;
  temperature?: number;
  messages: ChatMessage[];
  response_format?: Record<string, unknown>;
  max_tokens?: number;
  max_completion_tokens?: number;
}

interface TimetableOcrRequest {
  mimeType?: string;
  base64?: string;
}

interface FirebaseJwtPayload {
  localId?: string;
  email?: string;
  emailVerified?: boolean;
}

type VerifiedFirebaseJwtPayload = FirebaseJwtPayload & { localId: string };

interface VerifiedFirebaseSession {
  uid: string;
  email?: string;
}

type AiQuotaKind = 'chat' | 'ocr';
type AiQuotaSubject = 'uid' | 'ip';

interface QuotaWindowRule {
  name: string;
  limit: number;
  windowId: string;
  resetAt: number;
}

interface QuotaBucketState {
  windowId: string;
  count: number;
  resetAt: number;
}

type QuotaState = Record<string, QuotaBucketState>;

interface AiQuotaCheckRequest {
  rules: QuotaWindowRule[];
}

interface AiQuotaCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  exceededRule?: string;
  limit?: number;
  remaining?: number;
}

const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const MAX_TIMETABLE_OCR_BODY_BYTES = 5 * 1024 * 1024;
const MAX_TIMETABLE_OCR_BASE64_LENGTH = 4_500_000;
const MAX_MESSAGE_COUNT = 20;
const MAX_MESSAGE_CONTENT_LENGTH = 6000;
const MAX_TOTAL_MESSAGE_CONTENT_LENGTH = 16000;
const MINUTE_WINDOW_MS = 60 * 1000;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAILY_QUOTA_OFFSET_MS = 9 * 60 * 60 * 1000;
const CHAT_UID_MINUTE_LIMIT = 5;
const CHAT_UID_DAY_LIMIT = 30;
const OCR_UID_MINUTE_LIMIT = 2;
const OCR_UID_DAY_LIMIT = 5;
const IP_MINUTE_LIMIT = 20;
const CHAT_DEFAULT_OUTPUT_TOKENS = 800;
const CHAT_MAX_OUTPUT_TOKENS = 1200;
const OCR_MAX_OUTPUT_TOKENS = 4096;
// purpose→model policy と既定 allowlist は ./modelPolicy に集約(純ロジックとして単体テスト可能)。
const ALLOWED_MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);
const SERVICE_NAME = 'studyplanner-ai-proxy';
const WORKER_DEBUG_VERSION = 'timetable-ocr-debug-20260429-001';
const SUPPORTED_TIMETABLE_OCR_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
]);
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
const DEFAULT_ALLOWED_GEMINI_MODELS = [DEFAULT_GEMINI_MODEL];
const TIMETABLE_OCR_PROMPT = [
  'あなたは日本語の学校時間割表を読み取るOCRアシスタントです。',
  '画像内の表構造を理解し、曜日列、時限行、左端の時刻、各セルの授業名、教室番号、記号を対応付けてください。',
  '返答はJSONのみです。Markdown、コードフェンス、説明文は絶対に含めないでください。',
  '出力形式は {"periods":[{"periodNumber":1,"startTime":"09:10","endTime":"10:40"}],"items":[{"weekday":"mon","periodNumber":1,"startTime":"09:10","endTime":"10:40","title":"数学②（理系）","subject":"数学","classroom":"402","memo":"＊"}]} です。',
  'weekday は mon, tue, wed, thu, fri, sat, sun のいずれかにしてください。',
  'periodNumber は数値にしてください。時刻は読める場合 HH:mm にし、読めない場合は null にしてください。',
  '空白セルは items に含めないでください。教室番号だけのセルは授業として扱わないでください。',
  '授業名から分かる教科は subject に入れてください。不明なら空文字にしてください。',
  '＊、V、その他の授業名・教室以外の記号は memo に入れてください。',
].join('\n');

function jsonResponse(
  request: Request,
  env: Env,
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-StudyPlanner-Proxy-Version': WORKER_DEBUG_VERSION,
      ...buildCorsHeaders(request, env),
      ...extraHeaders,
    },
  });
}

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveAllowedOrigin(request: Request, env: Env): string {
  const requestedOrigin = request.headers.get('Origin') ?? '*';
  const allowedOrigins = getAllowedOrigins(env);
  const allowOrigin =
    requestedOrigin === '*'
      ? allowedOrigins[0] || '*'
      : allowedOrigins.find((origin) => origin === requestedOrigin) || '';
  return allowOrigin;
}

function buildCorsHeaders(request: Request, env: Env): Record<string, string> {
  const allowOrigin = resolveAllowedOrigin(request, env);

  return {
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'X-StudyPlanner-Proxy-Version': WORKER_DEBUG_VERSION,
  };
}

function validateOrigin(request: Request, env: Env): string | null {
  const requestedOrigin = request.headers.get('Origin');

  if (!requestedOrigin) {
    return null;
  }

  if (!getAllowedOrigins(env).length) {
    return null;
  }

  return resolveAllowedOrigin(request, env)
    ? null
    : 'Origin is not allowed.';
}

function validateRequestShape(payload: ChatCompletionRequest): string | null {
  if (!payload || typeof payload !== 'object') {
    return 'Invalid chat completion payload.';
  }

  const hasModel = typeof payload.model === 'string' && payload.model.trim().length > 0;
  const hasPurpose = typeof payload.purpose === 'string' && payload.purpose.trim().length > 0;

  if (!hasModel && !hasPurpose) {
    return 'Model or purpose is required.';
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return 'At least one message is required.';
  }

  if (payload.messages.length > MAX_MESSAGE_COUNT) {
    return 'Too many messages were supplied.';
  }

  let totalContentLength = 0;

  for (const message of payload.messages) {
    if (
      !message ||
      typeof message !== 'object' ||
      !ALLOWED_MESSAGE_ROLES.has(message.role) ||
      typeof message.content !== 'string'
    ) {
      return 'Invalid chat message payload.';
    }

    if (message.content.length > MAX_MESSAGE_CONTENT_LENGTH) {
      return 'A message was too long.';
    }

    totalContentLength += message.content.length;
  }

  if (totalContentLength > MAX_TOTAL_MESSAGE_CONTENT_LENGTH) {
    return 'Combined message content was too large.';
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
}

function getDeclaredBodyLength(request: Request): number {
  return Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function getMinuteWindow(now: number): { windowId: string; resetAt: number } {
  const start = Math.floor(now / MINUTE_WINDOW_MS) * MINUTE_WINDOW_MS;
  return {
    windowId: String(start),
    resetAt: start + MINUTE_WINDOW_MS,
  };
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
  kind: AiQuotaKind,
  subject: AiQuotaSubject,
  now = Date.now(),
): QuotaWindowRule[] {
  const minute = getMinuteWindow(now);

  if (subject === 'ip') {
    return [
      {
        name: 'ip:minute',
        limit: IP_MINUTE_LIMIT,
        windowId: minute.windowId,
        resetAt: minute.resetAt,
      },
    ];
  }

  const day = getDailyWindow(now);
  const minuteLimit = kind === 'chat' ? CHAT_UID_MINUTE_LIMIT : OCR_UID_MINUTE_LIMIT;
  const dayLimit = kind === 'chat' ? CHAT_UID_DAY_LIMIT : OCR_UID_DAY_LIMIT;

  return [
    {
      name: `${kind}:uid:minute`,
      limit: minuteLimit,
      windowId: minute.windowId,
      resetAt: minute.resetAt,
    },
    {
      name: `${kind}:uid:day`,
      limit: dayLimit,
      windowId: day.windowId,
      resetAt: day.resetAt,
    },
  ];
}

function isQuotaWindowRule(value: unknown): value is QuotaWindowRule {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.windowId === 'string' &&
    value.windowId.trim().length > 0 &&
    typeof value.limit === 'number' &&
    Number.isFinite(value.limit) &&
    value.limit > 0 &&
    typeof value.resetAt === 'number' &&
    Number.isFinite(value.resetAt)
  );
}

function getQuotaSubjectName(subject: AiQuotaSubject, key: string): string {
  const normalizedKey = encodeURIComponent(key.trim() || 'unknown').slice(0, 160);
  return `${subject}:${normalizedKey}`;
}

function getClientIp(request: Request): string {
  const directIp =
    request.headers.get('CF-Connecting-IP')?.trim() ||
    request.headers.get('True-Client-IP')?.trim();

  if (directIp) {
    return directIp;
  }

  const forwardedFor = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  return forwardedFor || 'unknown';
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
    {
      error: 'AI rate limit exceeded.',
      retryAfterSeconds,
    },
    {
      'Retry-After': String(retryAfterSeconds),
    },
  );
}

async function checkQuotaSubject(
  env: Env,
  subject: AiQuotaSubject,
  key: string,
  rules: QuotaWindowRule[],
): Promise<AiQuotaCheckResult> {
  const stub = env.AI_QUOTA.getByName(getQuotaSubjectName(subject, key));
  return await stub.checkAndConsume({ rules });
}

async function enforceAiQuota(
  request: Request,
  env: Env,
  uid: string,
  kind: AiQuotaKind,
): Promise<Response | null> {
  const ip = getClientIp(request);
  const now = Date.now();
  const ipQuota = await checkQuotaSubject(
    env,
    'ip',
    ip,
    buildQuotaRules(kind, 'ip', now),
  );

  if (!ipQuota.allowed) {
    return rateLimitResponse(request, env, ipQuota);
  }

  const uidQuota = await checkQuotaSubject(
    env,
    'uid',
    uid,
    buildQuotaRules(kind, 'uid', now),
  );

  if (!uidQuota.allowed) {
    return rateLimitResponse(request, env, uidQuota);
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

function getAllowedGeminiModels(env: Env): Set<string> {
  const configuredModels = (env.ALLOWED_GEMINI_MODELS ?? '')
    .split(',')
    .map((model) => normalizeGeminiModel(model))
    .filter(Boolean);

  return new Set(
    configuredModels.length > 0
      ? configuredModels
      : DEFAULT_ALLOWED_GEMINI_MODELS,
  );
}

function getChatOutputTokenLimit(payload: ChatCompletionRequest): number {
  const requested =
    typeof payload.max_completion_tokens === 'number' &&
    Number.isFinite(payload.max_completion_tokens)
      ? payload.max_completion_tokens
      : typeof payload.max_tokens === 'number' && Number.isFinite(payload.max_tokens)
        ? payload.max_tokens
        : CHAT_DEFAULT_OUTPUT_TOKENS;

  return Math.max(
    1,
    Math.min(CHAT_MAX_OUTPUT_TOKENS, Math.floor(requested)),
  );
}

function getChatTemperature(payload: ChatCompletionRequest): number {
  if (typeof payload.temperature !== 'number' || !Number.isFinite(payload.temperature)) {
    return 0.2;
  }

  return Math.max(0, Math.min(2, payload.temperature));
}

function isProduction(env: Env): boolean {
  const environment = env.ENVIRONMENT?.trim().toLowerCase();
  return !environment || environment === 'production';
}

function isDebugEndpointEnabled(env: Env): boolean {
  return env.DEBUG_ENDPOINT?.trim().toLowerCase() === 'true';
}

function safeErrorMessage(
  env: Env,
  error: unknown,
  fallbackMessage: string,
): string {
  if (isProduction(env)) {
    return fallbackMessage;
  }

  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallbackMessage;
}

export class AiQuotaDurableObject extends DurableObject<Env> {
  async checkAndConsume(
    request: AiQuotaCheckRequest,
  ): Promise<AiQuotaCheckResult> {
    const rules = Array.isArray(request.rules)
      ? request.rules.filter(isQuotaWindowRule)
      : [];

    if (rules.length === 0) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: 0,
      };
    }

    const now = Date.now();
    const state = (await this.ctx.storage.get<QuotaState>('quota-state')) ?? {};

    for (const rule of rules) {
      const current = state[rule.name];
      const count =
        current && current.windowId === rule.windowId ? current.count : 0;

      if (count >= rule.limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((rule.resetAt - now) / 1000)),
          exceededRule: rule.name,
          limit: rule.limit,
          remaining: 0,
        };
      }
    }

    let lowestRemaining = Number.POSITIVE_INFINITY;

    for (const rule of rules) {
      const current = state[rule.name];
      const count =
        current && current.windowId === rule.windowId ? current.count : 0;
      const nextCount = count + 1;

      state[rule.name] = {
        windowId: rule.windowId,
        count: nextCount,
        resetAt: rule.resetAt,
      };
      lowestRemaining = Math.min(lowestRemaining, rule.limit - nextCount);
    }

    await this.ctx.storage.put('quota-state', state);

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, lowestRemaining),
    };
  }
}

async function requireVerifiedFirebaseSession(
  request: Request,
  env: Env,
): Promise<Response | VerifiedFirebaseSession> {
  if (!env.FIREBASE_WEB_API_KEY?.trim()) {
    return jsonResponse(request, env, 500, {
      error: 'FIREBASE_WEB_API_KEY is not configured.',
    });
  }

  const bearerToken = getBearerToken(request);

  if (!bearerToken) {
    return jsonResponse(request, env, 401, {
      error: 'Missing Firebase ID token.',
    });
  }

  try {
    const firebaseUser = await verifyFirebaseToken(
      bearerToken,
      env.FIREBASE_WEB_API_KEY.trim(),
    );

    if (firebaseUser.emailVerified === false) {
      return jsonResponse(request, env, 403, {
        error: 'Email verification is required before using AI features.',
      });
    }

    return {
      uid: firebaseUser.localId,
      email: firebaseUser.email,
    };
  } catch (error) {
    return jsonResponse(request, env, 401, {
      error:
        error instanceof Error ? error.message : 'Firebase authentication failed.',
    });
  }

}

function validateTimetableOcrPayload(
  payload: TimetableOcrRequest,
): string | null {
  if (!payload || typeof payload !== 'object') {
    return 'Invalid timetable OCR payload.';
  }

  if (
    typeof payload.mimeType !== 'string' ||
    !SUPPORTED_TIMETABLE_OCR_MIME_TYPES.has(payload.mimeType)
  ) {
    return 'Only PNG and JPEG images are supported.';
  }

  if (typeof payload.base64 !== 'string' || !payload.base64.trim()) {
    return 'Image data is required.';
  }

  if (payload.base64.length > MAX_TIMETABLE_OCR_BASE64_LENGTH) {
    return 'Image data was too large.';
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(payload.base64)) {
    return 'Image data was not valid base64.';
  }

  return null;
}

function extractFirstJsonObject(text: string): string | null {
  const trimmed = text.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return trimmed.slice(start, end + 1);
}

function parseGeminiTimetableJson(text: string): unknown {
  const jsonText = extractFirstJsonObject(text);

  if (!jsonText) {
    throw new Error('Gemini response did not contain JSON.');
  }

  const parsed = JSON.parse(jsonText) as unknown;

  if (!isRecord(parsed) || !Array.isArray(parsed.periods) || !Array.isArray(parsed.items)) {
    throw new Error('Gemini response JSON did not match timetable OCR format.');
  }

  return parsed;
}

function normalizeGeminiModel(model: string | undefined): string {
  const trimmed = model?.trim() || DEFAULT_GEMINI_MODEL;

  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
}

function buildDebugBody(
  request: Request,
  pathname: string,
): Record<string, unknown> {
  return {
    ok: true,
    service: SERVICE_NAME,
    hasTimetableOcr: true,
    version: WORKER_DEBUG_VERSION,
    method: request.method,
    pathname,
  };
}

function methodNotAllowedResponse(
  request: Request,
  env: Env,
  pathname: string,
  allowedMethods: string[],
): Response {
  return jsonResponse(request, env, 405, {
    ok: false,
    service: SERVICE_NAME,
    version: WORKER_DEBUG_VERSION,
    method: request.method,
    pathname,
    allowedMethods,
    error: 'Method not allowed.',
  });
}

function notFoundResponse(
  request: Request,
  env: Env,
  pathname: string,
): Response {
  return jsonResponse(request, env, 404, {
    ok: false,
    service: SERVICE_NAME,
    version: WORKER_DEBUG_VERSION,
    method: request.method,
    pathname,
    knownPaths: ['/', '/chat/completions', '/timetable-ocr'],
    error: 'Not found on studyplanner-ai-proxy worker.',
  });
}

async function verifyFirebaseToken(
  token: string,
  webApiKey: string,
): Promise<VerifiedFirebaseJwtPayload> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(webApiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: token,
      }),
    },
  );

  if (!response.ok) {
    throw new Error('Firebase ID token verification failed.');
  }

  const payload = (await response.json()) as {
    users?: FirebaseJwtPayload[];
  };
  const user = payload.users?.[0];

  if (!user?.localId) {
    throw new Error('Firebase user was not found for the supplied token.');
  }

  return user as VerifiedFirebaseJwtPayload;
}

async function handleChatCompletion(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.OPENAI_API_KEY?.trim()) {
    return jsonResponse(request, env, 500, {
      error: 'OPENAI_API_KEY is not configured.',
    });
  }

  const session = await requireVerifiedFirebaseSession(request, env);

  if (session instanceof Response) {
    return session;
  }

  const declaredBodyLength = getDeclaredBodyLength(request);

  if (
    Number.isFinite(declaredBodyLength) &&
    declaredBodyLength > MAX_REQUEST_BODY_BYTES
  ) {
    return jsonResponse(request, env, 413, {
      error: 'Request body was too large.',
    });
  }

  const requestText = await request.text();

  if (getUtf8ByteLength(requestText) > MAX_REQUEST_BODY_BYTES) {
    return jsonResponse(request, env, 413, {
      error: 'Request body was too large.',
    });
  }

  let payload: ChatCompletionRequest;

  try {
    payload = JSON.parse(requestText) as ChatCompletionRequest;
  } catch {
    return jsonResponse(request, env, 400, {
      error: 'Invalid JSON payload.',
    });
  }

  const payloadValidationError = validateRequestShape(payload);

  if (payloadValidationError) {
    return jsonResponse(request, env, 400, {
      error: payloadValidationError,
    });
  }

  const modelResolution = resolveChatModel(payload);

  if ('error' in modelResolution) {
    return jsonResponse(request, env, 400, {
      error: modelResolution.error,
    });
  }

  // purpose 由来 / client 由来のいずれで解決した model も、必ず allowlist を通す(バイパスしない)。
  const model = modelResolution.model;
  const allowedModels = getAllowedChatModels(env);

  if (!allowedModels.has(model)) {
    return jsonResponse(request, env, 400, {
      error: 'Requested model is not allowed.',
    });
  }

  const quotaError = await enforceAiQuota(request, env, session.uid, 'chat');

  if (quotaError) {
    return quotaError;
  }

  const openAiBaseUrl = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const upstreamResponse = await fetch(`${openAiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      model,
      temperature: getChatTemperature(payload),
      messages: payload.messages,
      response_format: payload.response_format,
      max_completion_tokens: getChatOutputTokenLimit(payload),
    }),
  });

  const upstreamText = await upstreamResponse.text();

  if (!upstreamResponse.ok) {
    console.warn('[AI Proxy] OpenAI upstream failed', {
      status: upstreamResponse.status,
    });
    return jsonResponse(request, env, 502, {
      error: 'OpenAI request failed.',
    });
  }

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
}

async function handleTimetableOcr(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.GEMINI_API_KEY?.trim()) {
    return jsonResponse(request, env, 500, {
      error: 'GEMINI_API_KEY is not configured.',
    });
  }

  const session = await requireVerifiedFirebaseSession(request, env);

  if (session instanceof Response) {
    return session;
  }

  const declaredBodyLength = getDeclaredBodyLength(request);

  if (
    Number.isFinite(declaredBodyLength) &&
    declaredBodyLength > MAX_TIMETABLE_OCR_BODY_BYTES
  ) {
    return jsonResponse(request, env, 413, {
      error: 'Image request body was too large.',
    });
  }

  const requestText = await request.text();

  if (getUtf8ByteLength(requestText) > MAX_TIMETABLE_OCR_BODY_BYTES) {
    return jsonResponse(request, env, 413, {
      error: 'Image request body was too large.',
    });
  }

  let payload: TimetableOcrRequest;

  try {
    payload = JSON.parse(requestText) as TimetableOcrRequest;
  } catch {
    return jsonResponse(request, env, 400, {
      error: 'Invalid JSON payload.',
    });
  }

  const payloadError = validateTimetableOcrPayload(payload);

  if (payloadError) {
    return jsonResponse(request, env, 400, { error: payloadError });
  }

  const model = normalizeGeminiModel(env.GEMINI_MODEL);

  if (!getAllowedGeminiModels(env).has(model)) {
    return jsonResponse(request, env, 500, {
      error: 'Timetable OCR model is not configured.',
    });
  }

  const quotaError = await enforceAiQuota(request, env, session.uid, 'ocr');

  if (quotaError) {
    return quotaError;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY.trim())}`;
  const upstreamResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: TIMETABLE_OCR_PROMPT },
            {
              inline_data: {
                mime_type: payload.mimeType,
                data: payload.base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: OCR_MAX_OUTPUT_TOKENS,
      },
    }),
  });

  const upstreamText = await upstreamResponse.text();

  if (!upstreamResponse.ok) {
    return jsonResponse(request, env, upstreamResponse.status, {
      error: 'Gemini timetable OCR request failed.',
    });
  }

  try {
    const upstreamJson = JSON.parse(upstreamText) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    const content = upstreamJson.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!content) {
      return jsonResponse(request, env, 502, {
        error: 'Gemini timetable OCR response was empty.',
      });
    }

    return jsonResponse(request, env, 200, {
      result: parseGeminiTimetableJson(content),
    });
  } catch (error) {
    return jsonResponse(request, env, 502, {
      error: safeErrorMessage(
        env,
        error,
        'Gemini timetable OCR response could not be parsed.',
      ),
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    console.info('[AI Proxy] request', {
      method: request.method,
      pathname,
      version: WORKER_DEBUG_VERSION,
    });

    if (request.method === 'OPTIONS') {
      const originError = validateOrigin(request, env);

      if (originError) {
        return jsonResponse(request, env, 403, { error: originError });
      }

      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(request, env),
      });
    }

    if (pathname === '/__debug') {
      if (!isDebugEndpointEnabled(env)) {
        return notFoundResponse(request, env, pathname);
      }

      if (request.method !== 'GET') {
        return methodNotAllowedResponse(request, env, pathname, ['GET', 'OPTIONS']);
      }

      const originError = validateOrigin(request, env);

      if (originError) {
        return jsonResponse(request, env, 403, { error: originError });
      }

      const session = await requireVerifiedFirebaseSession(request, env);

      if (session instanceof Response) {
        return session;
      }

      return jsonResponse(request, env, 200, buildDebugBody(request, pathname));
    }

    if (pathname === '/timetable-ocr' && request.method !== 'POST') {
      return methodNotAllowedResponse(request, env, pathname, ['POST', 'OPTIONS']);
    }

    if (request.method !== 'POST') {
      return methodNotAllowedResponse(request, env, pathname, ['POST', 'OPTIONS']);
    }

    if (
      pathname !== '/' &&
      pathname !== '/chat/completions' &&
      pathname !== '/timetable-ocr'
    ) {
      return notFoundResponse(request, env, pathname);
    }

    const originError = validateOrigin(request, env);

    if (originError) {
      return jsonResponse(request, env, 403, { error: originError });
    }

    try {
      if (pathname === '/timetable-ocr') {
        return await handleTimetableOcr(request, env);
      }

      return await handleChatCompletion(request, env);
    } catch (error) {
      return jsonResponse(request, env, 500, {
        error: safeErrorMessage(env, error, 'Unexpected worker error.'),
      });
    }
  },
};
