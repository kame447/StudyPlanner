import { ProductObservabilityStore, type ProductObservabilityEnv } from './productObservabilityStore';

export const PRODUCT_OBSERVABILITY_EVENTS_PATH = '/observability/events';

export interface ProductObservabilityApiEnv extends ProductObservabilityEnv {
  FIREBASE_WEB_API_KEY: string;
  ALLOWED_ORIGIN?: string;
}

interface FirebaseLookupResponse {
  users?: Array<{
    localId?: string;
    emailVerified?: boolean;
  }>;
}

const MAX_EVENT_REQUEST_BYTES = 16 * 1024;

function allowedOrigins(env: ProductObservabilityApiEnv): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGIN ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function allowedOrigin(request: Request, env: ProductObservabilityApiEnv): string | null {
  const origin = request.headers.get('Origin')?.trim();
  if (!origin) return null;
  return allowedOrigins(env).has(origin) ? origin : '';
}

function responseHeaders(
  request: Request,
  env: ProductObservabilityApiEnv,
): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  const origin = allowedOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return headers;
}

function jsonResponse(
  request: Request,
  env: ProductObservabilityApiEnv,
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

async function authenticatedUid(
  request: Request,
  env: ProductObservabilityApiEnv,
): Promise<string | Response> {
  const apiKey = env.FIREBASE_WEB_API_KEY?.trim();
  if (!apiKey) {
    return jsonResponse(request, env, 503, { error: 'Telemetry authentication is unavailable.' });
  }
  const token = bearerToken(request);
  if (!token) {
    return jsonResponse(request, env, 401, { error: 'Authentication is required.' });
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
    return jsonResponse(request, env, 401, { error: 'Authentication could not be verified.' });
  }

  const payload = await response.json() as FirebaseLookupResponse;
  const user = payload.users?.[0];
  if (!user?.localId) {
    return jsonResponse(request, env, 401, { error: 'Authenticated user was not found.' });
  }
  if (user.emailVerified === false) {
    return jsonResponse(request, env, 403, { error: 'Email verification is required.' });
  }
  return user.localId;
}

function isConfigured(env: ProductObservabilityApiEnv): boolean {
  return Boolean(
    env.OBSERVABILITY_IDENTITY_SECRET?.trim()
      && env.FIREBASE_PROJECT_ID?.trim()
      && env.FIREBASE_SERVICE_ACCOUNT_EMAIL?.trim()
      && env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim(),
  );
}

export function isProductObservabilityPath(pathname: string): boolean {
  return pathname === PRODUCT_OBSERVABILITY_EVENTS_PATH;
}

export async function handleProductObservabilityApi(
  request: Request,
  env: ProductObservabilityApiEnv,
): Promise<Response> {
  const origin = allowedOrigin(request, env);
  if (origin === '') {
    return jsonResponse(request, env, 403, { error: 'Origin is not allowed.' });
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
  if (!isConfigured(env)) {
    return jsonResponse(request, env, 503, { error: 'Telemetry storage is not configured.' });
  }

  const declaredBytes = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_EVENT_REQUEST_BYTES) {
    return jsonResponse(request, env, 413, { error: 'Telemetry payload was too large.' });
  }

  const uid = await authenticatedUid(request, env);
  if (uid instanceof Response) return uid;

  const requestText = await request.text();
  if (new TextEncoder().encode(requestText).byteLength > MAX_EVENT_REQUEST_BYTES) {
    return jsonResponse(request, env, 413, { error: 'Telemetry payload was too large.' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(requestText) as unknown;
  } catch {
    return jsonResponse(request, env, 400, { error: 'Telemetry payload was not valid JSON.' });
  }

  try {
    await new ProductObservabilityStore(env).storeProductActivity(uid, payload);
    return jsonResponse(request, env, 202, { accepted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Telemetry payload was rejected.';
    const validationFailure = message.startsWith('Telemetry ');
    if (validationFailure) {
      return jsonResponse(request, env, 400, { error: message });
    }
    console.warn('[Product Observability] telemetry persistence failed', {
      error: message,
    });
    return jsonResponse(request, env, 503, { error: 'Telemetry storage is temporarily unavailable.' });
  }
}
