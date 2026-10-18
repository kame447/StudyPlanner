import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRODUCT_OBSERVABILITY_EVENTS_PATH,
  handleProductObservabilityApi,
  isProductObservabilityPath,
  type ProductObservabilityApiEnv,
} from './productObservabilityApi';

import { ProductObservabilityStore } from './productObservabilityStore';
import { projectSemanticCensusMetadata } from '../../../shared/semanticTurnCensus';

const baseEnv: ProductObservabilityApiEnv = {
  FIREBASE_WEB_API_KEY: 'web-api-key',
  FIREBASE_PROJECT_ID: 'project-id',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'private-key',
  OBSERVABILITY_IDENTITY_SECRET: '0123456789abcdef0123456789abcdef',
  ALLOWED_ORIGIN: 'https://studyplanner.example',
  ENVIRONMENT: 'test',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('product observability API boundary', () => {
  it('admits strict client census only after existing authentication and explicit enablement', async () => {
    const persisted = vi.spyOn(ProductObservabilityStore.prototype, 'storeSemanticCensus').mockResolvedValue();
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ users: [{ localId: 'private-user', emailVerified: true }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const event = { version: 1, kind: 'start', domain: 'weekly-planning', turnId: crypto.randomUUID(), occurredAt: new Date().toISOString(), metadata: projectSemanticCensusMetadata(null) };
    const request = (payload: unknown, auth = true) => new Request(`https://worker.example${PRODUCT_OBSERVABILITY_EVENTS_PATH}`, {
      method: 'POST', headers: { Origin: 'https://studyplanner.example', 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer session-token' } : {}) }, body: JSON.stringify(payload),
    });
    expect((await handleProductObservabilityApi(request(event, false), { ...baseEnv, SEMANTIC_CENSUS_MODE: 'typed' })).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled(); expect(persisted).not.toHaveBeenCalled();
    expect((await handleProductObservabilityApi(request(event), baseEnv)).status).toBe(400);
    expect((await handleProductObservabilityApi(request({ ...event, rawText: 'private-text', secret: 'private-secret' }), { ...baseEnv, SEMANTIC_CENSUS_MODE: 'typed' })).status).toBe(400);
    expect(persisted).not.toHaveBeenCalled();
    const response = await handleProductObservabilityApi(request(event), { ...baseEnv, SEMANTIC_CENSUS_MODE: 'typed' });
    expect(response.status).toBe(202); expect(persisted).toHaveBeenCalledExactlyOnceWith('private-user', event);
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('https://identitytoolkit.googleapis.com/'))).toBe(true);
    expect(JSON.stringify(await response.json())).not.toContain(event.turnId);
  });
  it('rejects forged client-side provider counts even when the census switch is enabled', async () => {
    const persisted = vi.spyOn(ProductObservabilityStore.prototype, 'storeSemanticCensus').mockResolvedValue();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ users: [{ localId: 'private-user' }] }))));
    const payload = { version: 1, kind: 'request', domain: 'weekly-planning', turnId: crypto.randomUUID(), requestId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
      joined: true, stage: 'initial', integrity: 'complete', route: 'rejected', outcome: 'failure', latencyMs: 1, lateWork: false,
      lunaDispatches: 0, jevDispatches: 0, observedLunaDispatches: 0, observedJevDispatches: 0, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, dispatches: [] };
    const response = await handleProductObservabilityApi(new Request(`https://worker.example${PRODUCT_OBSERVABILITY_EVENTS_PATH}`, { method: 'POST', headers: { Authorization: 'Bearer token' }, body: JSON.stringify(payload) }), { ...baseEnv, SEMANTIC_CENSUS_MODE: 'typed' });
    expect(response.status).toBe(400); expect(persisted).not.toHaveBeenCalled();
  });

  it('recognizes only the observability event ingestion path', () => {
    expect(isProductObservabilityPath(PRODUCT_OBSERVABILITY_EVENTS_PATH)).toBe(true);
    expect(isProductObservabilityPath('/observability')).toBe(false);
  });

  it('rejects disallowed origins before authentication or storage work', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await handleProductObservabilityApi(new Request(
      `https://worker.example${PRODUCT_OBSERVABILITY_EVENTS_PATH}`,
      {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    ), baseEnv);

    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('supports CORS preflight without requiring a Firebase session', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await handleProductObservabilityApi(new Request(
      `https://worker.example${PRODUCT_OBSERVABILITY_EVENTS_PATH}`,
      {
        method: 'OPTIONS',
        headers: { Origin: 'https://studyplanner.example' },
      },
    ), baseEnv);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin'))
      .toBe('https://studyplanner.example');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when telemetry storage is not configured', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await handleProductObservabilityApi(new Request(
      `https://worker.example${PRODUCT_OBSERVABILITY_EVENTS_PATH}`,
      {
        method: 'POST',
        headers: {
          Origin: 'https://studyplanner.example',
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    ), {
      ...baseEnv,
      OBSERVABILITY_IDENTITY_SECRET: '',
    });

    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires authentication before accepting event JSON', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await handleProductObservabilityApi(new Request(
      `https://worker.example${PRODUCT_OBSERVABILITY_EVENTS_PATH}`,
      {
        method: 'POST',
        headers: {
          Origin: 'https://studyplanner.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    ), baseEnv);

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
