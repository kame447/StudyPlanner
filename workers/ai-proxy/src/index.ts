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
      ...buildCorsHeaders(request, env),
    },
  });
}

function buildCorsHeaders(request: Request, env: Env): Record<string, string> {
  const requestedOrigin = request.headers.get('Origin') ?? '*';
  const allowedOrigins = (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowOrigin =
    requestedOrigin === '*'
      ? allowedOrigins[0] || '*'
      : allowedOrigins.find((origin) => origin === requestedOrigin) || '';

  return {
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
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
    await verifyFirebaseToken(bearerToken, env.FIREBASE_WEB_API_KEY.trim());
  } catch (error) {
    return jsonResponse(request, env, 401, {
      error:
        error instanceof Error ? error.message : 'Firebase authentication failed.',
    });
  }

  const payload = (await request.json()) as ChatCompletionRequest;

  if (!payload.model?.trim() || !Array.isArray(payload.messages) || payload.messages.length === 0) {
    return jsonResponse(request, env, 400, {
      error: 'Invalid OpenAI chat completion payload.',
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

    try {
      return await handleChatCompletion(request, env);
    } catch (error) {
      return jsonResponse(request, env, 500, {
        error: error instanceof Error ? error.message : 'Unexpected worker error.',
      });
    }
  },
};
