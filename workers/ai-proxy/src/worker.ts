import aiProxyWorker, { AiQuotaDurableObject } from './index';
import {
  handleWeeklyPlanningTraceApi,
  isWeeklyPlanningTracePath,
  type WeeklyPlanningTraceApiEnv,
  type WeeklyPlanningTraceApiSession,
} from './weeklyPlanningTraceApi';

export { AiQuotaDurableObject };

interface Env extends WeeklyPlanningTraceApiEnv {
  FIREBASE_WEB_API_KEY: string;
  ALLOWED_ORIGIN?: string;
}

interface FirebaseLookupResponse {
  users?: Array<{
    localId?: string;
    emailVerified?: boolean;
  }>;
}

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

function responseHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
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
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request, env),
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
    return await aiProxyWorker.fetch(request, env as never);
  },
};
