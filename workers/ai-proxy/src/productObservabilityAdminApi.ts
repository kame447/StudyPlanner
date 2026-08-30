import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import type { FirestoreOrderedCursor } from './firestoreServiceAccountClient';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';
import { ProductObservabilityAdminAnalysisService } from './productObservabilityAdminAnalysisService';
import { ProductObservabilityAdminPlanningAnalysisService } from './productObservabilityAdminPlanningAnalysisService';
import {
  ProductObservabilityReadModelService,
  type ProductObservabilityReadModelEnv,
} from './productObservabilityReadModelService';

export const PRODUCT_OBSERVABILITY_ADMIN_OVERVIEW_PATH = '/observability/admin/overview';
export const PRODUCT_OBSERVABILITY_ADMIN_USERS_PATH = '/observability/admin/users';
export const PRODUCT_OBSERVABILITY_ADMIN_USER_IDENTITY_PATH = '/observability/admin/user-identity';
export const PRODUCT_OBSERVABILITY_ADMIN_AI_PATH = '/observability/admin/ai';
export const PRODUCT_OBSERVABILITY_ADMIN_PLANNING_PATH = '/observability/admin/planning';

export interface ProductObservabilityAdminApiEnv extends ProductObservabilityReadModelEnv {
  FIREBASE_WEB_API_KEY: string;
  ALLOWED_ORIGIN?: string;
  ENVIRONMENT?: string;
}

interface FirebaseLookupResponse {
  users?: Array<{
    localId?: string;
    emailVerified?: boolean;
  }>;
}

const CLIENT_VALIDATION_ERRORS = new Set([
  'observability_date_range_invalid',
  'observability_date_range_too_large',
  'observability_actor_subject_invalid',
  'observability_cursor_invalid',
  'observability_limit_invalid',
  'observability_environment_invalid',
  'observability_identity_search_invalid',
]);

function allowedOrigins(env: ProductObservabilityAdminApiEnv): Set<string> {
  return new Set((env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
}

function corsOrigin(request: Request, env: ProductObservabilityAdminApiEnv): string | null {
  const origin = request.headers.get('Origin')?.trim();
  if (!origin) return null;
  return allowedOrigins(env).has(origin) ? origin : '';
}

function responseHeaders(request: Request, env: ProductObservabilityAdminApiEnv): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  const origin = corsOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  return headers;
}

function jsonResponse(
  request: Request,
  env: ProductObservabilityAdminApiEnv,
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

async function authenticatedAdminUid(
  request: Request,
  env: ProductObservabilityAdminApiEnv,
): Promise<string | null> {
  const apiKey = env.FIREBASE_WEB_API_KEY?.trim();
  const token = bearerToken(request);
  if (!apiKey || !token) return null;
  const response = await globalThis.fetch(
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
  const admin = await new FirestoreServiceAccountClient(env).getDocument('admins', user.localId);
  return admin?.enabled === true ? user.localId : null;
}

function parseEnvironment(value: string | undefined): ObservabilityEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'production') return 'production';
  if (normalized === 'preview' || normalized === 'development' || normalized === 'test') {
    return normalized;
  }
  throw new Error('observability_environment_invalid');
}

function environmentFrom(
  value: string | null,
  env: ProductObservabilityAdminApiEnv,
): ObservabilityEnvironment {
  return parseEnvironment(value?.trim() || env.ENVIRONMENT);
}

function encodeCursor(cursor: FirestoreOrderedCursor | null): string | null {
  if (!cursor) return null;
  const encoded = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = '';
  encoded.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value: string | null): FirestoreOrderedCursor | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{8,1024}$/.test(value)) throw new Error('observability_cursor_invalid');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('observability_cursor_invalid');
  const record = parsed as Record<string, unknown>;
  if (typeof record.orderedValue !== 'string' || typeof record.documentName !== 'string') {
    throw new Error('observability_cursor_invalid');
  }
  return {
    orderedValue: record.orderedValue,
    documentName: record.documentName,
  };
}

function requestedLimit(value: string | null): number {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('observability_limit_invalid');
  return Math.min(100, parsed);
}

export function isProductObservabilityAdminPath(pathname: string): boolean {
  return pathname === PRODUCT_OBSERVABILITY_ADMIN_OVERVIEW_PATH
    || pathname === PRODUCT_OBSERVABILITY_ADMIN_USERS_PATH
    || pathname === PRODUCT_OBSERVABILITY_ADMIN_USER_IDENTITY_PATH
    || pathname === PRODUCT_OBSERVABILITY_ADMIN_AI_PATH
    || pathname === PRODUCT_OBSERVABILITY_ADMIN_PLANNING_PATH;
}

export async function handleProductObservabilityAdminApi(
  request: Request,
  rawEnv: Record<string, unknown>,
): Promise<Response> {
  const env = rawEnv as unknown as ProductObservabilityAdminApiEnv;
  const origin = corsOrigin(request, env);
  if (origin === '') return jsonResponse(request, env, 403, { error: 'Origin is not allowed.' });
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders(request, env) });
  }
  if (request.method !== 'GET') {
    return jsonResponse(request, env, 405, { error: 'Method not allowed.' });
  }
  const adminUid = await authenticatedAdminUid(request, env);
  if (!adminUid) return jsonResponse(request, env, 403, { error: 'Admin access is required.' });

  const url = new URL(request.url);
  const readModel = new ProductObservabilityReadModelService(env);
  const analysis = new ProductObservabilityAdminAnalysisService(env);
  const planningAnalysis = new ProductObservabilityAdminPlanningAnalysisService(env);
  try {
    if (url.pathname === PRODUCT_OBSERVABILITY_ADMIN_OVERVIEW_PATH) {
      const fromDate = url.searchParams.get('from')?.trim() ?? '';
      const toDate = url.searchParams.get('to')?.trim() ?? '';
      const result = await readModel.getOverview({
        environment: environmentFrom(url.searchParams.get('environment'), env),
        fromDate,
        toDate,
      });
      return jsonResponse(request, env, 200, { ok: true, result });
    }

    if (url.pathname === PRODUCT_OBSERVABILITY_ADMIN_AI_PATH) {
      const fromDate = url.searchParams.get('from')?.trim() ?? '';
      const toDate = url.searchParams.get('to')?.trim() ?? '';
      const result = await analysis.getAiAnalysis({
        environment: environmentFrom(url.searchParams.get('environment'), env),
        fromDate,
        toDate,
      });
      return jsonResponse(request, env, 200, { ok: true, result });
    }

    if (url.pathname === PRODUCT_OBSERVABILITY_ADMIN_PLANNING_PATH) {
      const fromDate = url.searchParams.get('from')?.trim() ?? '';
      const toDate = url.searchParams.get('to')?.trim() ?? '';
      const result = await planningAnalysis.getPlanningAnalysis({
        environment: environmentFrom(url.searchParams.get('environment'), env),
        fromDate,
        toDate,
      });
      return jsonResponse(request, env, 200, { ok: true, result });
    }

    if (url.pathname === PRODUCT_OBSERVABILITY_ADMIN_USER_IDENTITY_PATH) {
      const matches = await analysis.resolveUserIdentity(url.searchParams.get('q') ?? '');
      return jsonResponse(request, env, 200, { ok: true, matches });
    }

    if (url.pathname === PRODUCT_OBSERVABILITY_ADMIN_USERS_PATH) {
      const environment = environmentFrom(url.searchParams.get('environment'), env);
      const actorSubjectId = url.searchParams.get('actor')?.trim() ?? '';
      if (actorSubjectId) {
        const result = await analysis.getUserInvestigation({
          actorSubjectId,
          environment,
          cursor: decodeCursor(url.searchParams.get('cursor')),
          limit: requestedLimit(url.searchParams.get('limit')),
        });
        return jsonResponse(request, env, 200, {
          ok: true,
          result: {
            ...result,
            nextCursor: encodeCursor(result.nextCursor),
          },
        });
      }

      const page = await analysis.listUsers({
        environment,
        cursor: decodeCursor(url.searchParams.get('cursor')),
        limit: requestedLimit(url.searchParams.get('limit')),
      });
      return jsonResponse(request, env, 200, {
        ok: true,
        users: page.users,
        nextCursor: encodeCursor(page.nextCursor),
      });
    }
    return jsonResponse(request, env, 404, { error: 'Not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'observability_read_failed';
    const validationFailure = CLIENT_VALIDATION_ERRORS.has(message);
    if (!validationFailure) {
      console.error('[Product Observability] admin read failed', { message });
    }
    return jsonResponse(request, env, validationFailure ? 400 : 503, {
      error: validationFailure ? message : 'Observability read model is temporarily unavailable.',
    });
  }
}
