interface Env {
  OPENAI_API_KEY: string;
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

interface FirebaseJwtPayload {
  localId?: string;
  email?: string;
  emailVerified?: boolean;
}

const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const MAX_MESSAGE_COUNT = 20;
const MAX_MESSAGE_CONTENT_LENGTH = 6000;
const MAX_TOTAL_MESSAGE_CONTENT_LENGTH = 16000;
const ALLOWED_MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  if (!env.FIREBASE_WEB_API_KEY?.trim()) {
    return jsonResponse(request, env, 500, {
      error: 'FIREBASE_WEB_API_KEY is not configured.',
    });
  }

  const authorization = request.headers.get('Authorization') ?? '';
  const bearerToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';

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

  const declaredBodyLength = Number.parseInt(
    request.headers.get('Content-Length') ?? '',
    10,
  );

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      const originError = validateOrigin(request, env);

      if (originError) {
        return jsonResponse(request, env, 403, { error: originError });
      }

      return new Response(null, {
        headers: buildCorsHeaders(request, env),
      });
    }

    const { pathname } = new URL(request.url);

    if (request.method !== 'POST') {
      return jsonResponse(request, env, 405, {
        error: 'Method not allowed.',
      });
    }

    if (pathname !== '/' && pathname !== '/chat/completions') {
      return jsonResponse(request, env, 404, {
        error: 'Not found.',
      });
    }

    const originError = validateOrigin(request, env);

    if (originError) {
      return jsonResponse(request, env, 403, { error: originError });
    }

    try {
      return await handleChatCompletion(request, env);
    } catch (error) {
      return jsonResponse(request, env, 500, {
        error: error instanceof Error ? error.message : 'Unexpected worker error.',
      });
    }
  },
};
