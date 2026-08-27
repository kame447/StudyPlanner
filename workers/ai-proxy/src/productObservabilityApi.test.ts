import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRODUCT_OBSERVABILITY_EVENTS_PATH,
  handleProductObservabilityApi,
  isProductObservabilityPath,
  type ProductObservabilityApiEnv,
} from './productObservabilityApi';

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
});

describe('product observability API boundary', () => {
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
