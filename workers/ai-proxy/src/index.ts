interface Env {
  OPENAI_API_KEY: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  FIREBASE_WEB_API_KEY: string;
  OPENAI_BASE_URL?: string;
  ALLOWED_ORIGIN?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  temperature?: number;
  messages: ChatMessage[];
  response_format?: Record<string, unknown>;
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

const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const MAX_TIMETABLE_OCR_BODY_BYTES = 5 * 1024 * 1024;
const MAX_TIMETABLE_OCR_BASE64_LENGTH = 4_500_000;
const MAX_MESSAGE_COUNT = 20;
const MAX_MESSAGE_CONTENT_LENGTH = 6000;
const MAX_TOTAL_MESSAGE_CONTENT_LENGTH = 16000;
const ALLOWED_MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);
const SERVICE_NAME = 'studyplanner-ai-proxy';
const WORKER_DEBUG_VERSION = 'timetable-ocr-debug-20260429-001';
const SUPPORTED_TIMETABLE_OCR_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
]);
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
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
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-StudyPlanner-Proxy-Version': WORKER_DEBUG_VERSION,
      ...buildCorsHeaders(request, env),
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
  if (!payload.model?.trim()) {
    return 'Model is required.';
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

async function requireVerifiedFirebaseSession(
  request: Request,
  env: Env,
): Promise<Response | null> {
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
  } catch (error) {
    return jsonResponse(request, env, 401, {
      error:
        error instanceof Error ? error.message : 'Firebase authentication failed.',
    });
  }

  return null;
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
    knownPaths: ['/', '/chat/completions', '/timetable-ocr', '/__debug'],
    error: 'Not found on studyplanner-ai-proxy worker.',
  });
}

async function verifyFirebaseToken(
  token: string,
  webApiKey: string,
): Promise<FirebaseJwtPayload> {
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

  return user;
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

  const sessionError = await requireVerifiedFirebaseSession(request, env);

  if (sessionError) {
    return sessionError;
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

  const payload = (await request.json()) as ChatCompletionRequest;
  const payloadValidationError = validateRequestShape(payload);

  if (payloadValidationError) {
    return jsonResponse(request, env, 400, {
      error: payloadValidationError,
    });
  }

  const openAiBaseUrl = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const upstreamResponse = await fetch(`${openAiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      model: payload.model,
      temperature: payload.temperature ?? 0.2,
      messages: payload.messages,
      response_format: payload.response_format,
    }),
  });

  const upstreamText = await upstreamResponse.text();

  if (!upstreamResponse.ok) {
    return jsonResponse(request, env, upstreamResponse.status, {
      error: upstreamText || 'OpenAI request failed.',
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

  const sessionError = await requireVerifiedFirebaseSession(request, env);

  if (sessionError) {
    return sessionError;
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

  if (requestText.length > MAX_TIMETABLE_OCR_BODY_BYTES) {
    return jsonResponse(request, env, 413, {
      error: 'Image request body was too large.',
    });
  }

  const payload = JSON.parse(requestText) as TimetableOcrRequest;
  const payloadError = validateTimetableOcrPayload(payload);

  if (payloadError) {
    return jsonResponse(request, env, 400, { error: payloadError });
  }

  const model = normalizeGeminiModel(env.GEMINI_MODEL);
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
      error:
        error instanceof Error
          ? error.message
          : 'Gemini timetable OCR response could not be parsed.',
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
      if (request.method !== 'GET') {
        return methodNotAllowedResponse(request, env, pathname, ['GET', 'OPTIONS']);
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
        error: error instanceof Error ? error.message : 'Unexpected worker error.',
      });
    }
  },
};
