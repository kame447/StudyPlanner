import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_HEADERS,
  WEEKLY_PLANNING_TRACE_WORKER_REVISION,
  WEEKLY_PLANNING_TRACE_STORAGE_LAYOUT_VERSION,
} from '../shared/weeklyPlanningTraceContract';
import { handleWeeklyPlanningTraceApi } from '../workers/ai-proxy/src/weeklyPlanningTraceApi';
import { verifyDeployedTraceContract } from './verify-weekly-planning-trace-deployed-contract.mjs';

const correlationId = 'deployed-contract-regression-123';
const token = 'synthetic-token-must-not-appear-in-errors';
const input = { baseUrl: 'https://worker.invalid/', idToken: token, correlationId };

function healthyBody() {
  return {
    ok: true, contractVersion: WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
    workerRevision: WEEKLY_PLANNING_TRACE_WORKER_REVISION,
    correlationId, storageLayoutVersion: WEEKLY_PLANNING_TRACE_STORAGE_LAYOUT_VERSION,
  };
}

function response(body = healthyBody(), headers = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe('deployed trace contract verification', () => {
  it('accepts the real current Worker health contract instead of stale duplicated versions', async () => {
    const tokenProvider = { getAccessToken: vi.fn(() => { throw new Error('unexpected storage access'); }) };
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe('https://worker.invalid/weekly-planning-trace/health');
      expect(init.redirect).toBe('error');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${token}`,
        [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]: WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
        [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: correlationId,
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const result = await handleWeeklyPlanningTraceApi(new Request(url, init), {
        FIREBASE_PROJECT_ID: 'synthetic-project',
        FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.invalid',
        FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-test-key',
        WEEKLY_PLANNING_TRACE_HMAC_SECRETS: '{}',
      }, { uid: 'synthetic-contract-owner' }, tokenProvider);
      return new Response(JSON.stringify(result.body), { status: result.status, headers: result.headers });
    });
    expect(await verifyDeployedTraceContract({ ...input, fetchImpl })).toEqual(healthyBody());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(tokenProvider.getAccessToken).not.toHaveBeenCalled();
  });

  it('supports the existing body fallback when contract headers are absent', async () => {
    expect(await verifyDeployedTraceContract({ ...input, fetchImpl: async () => response() })).toEqual(healthyBody());
  });

  it.each([
    ['contractVersion', WEEKLY_PLANNING_TRACE_HEADERS.contractVersion, 'contract'],
    ['workerRevision', WEEKLY_PLANNING_TRACE_HEADERS.workerRevision, 'worker revision'],
    ['correlationId', WEEKLY_PLANNING_TRACE_HEADERS.correlationId, 'correlation'],
  ])('rejects stale or conflicting %s without echoing server values', async (field, header, label) => {
    for (const [body, headers] of [
      [healthyBody(), { [header]: token }],
      [{ ...healthyBody(), [field]: token }, { [header]: healthyBody()[field] }],
      [{ ...healthyBody(), [field]: undefined }, {}],
    ]) {
      await expect(verifyDeployedTraceContract({
        ...input, fetchImpl: async () => response(body, headers),
      })).rejects.toThrow(`trace ${label} mismatch`);
    }
  });

  it.each([null, [], {}, { ...healthyBody(), ok: false }, { ...healthyBody(), ok: undefined }])(
    'rejects malformed success bodies: %j', async (body) => {
      await expect(verifyDeployedTraceContract({
        ...input, fetchImpl: async () => response(body),
      })).rejects.toThrow('invalid success response');
    },
  );

  it('rejects an incompatible storage layout', async () => {
    await expect(verifyDeployedTraceContract({
      ...input, fetchImpl: async () => response({ ...healthyBody(), storageLayoutVersion: 1 }),
    })).rejects.toThrow('trace storage layout mismatch');
  });

  it('reports authentication failure without dumping the response body', async () => {
    const error = await verifyDeployedTraceContract({
      ...input, fetchImpl: async () => new Response(JSON.stringify({ secret: token }), { status: 401 }),
    }).catch((failure) => failure);
    expect(error.message).toBe('deployed trace health failed: HTTP 401');
    expect(String(error)).not.toContain(token);
  });

  it('rejects non-JSON responses without echoing their content', async () => {
    const error = await verifyDeployedTraceContract({
      ...input, fetchImpl: async () => new Response(token),
    }).catch((failure) => failure);
    expect(error.message).toBe('deployed trace health returned invalid JSON');
    expect(String(error)).not.toContain(token);
  });

  it('sanitizes transport failure messages', async () => {
    const error = await verifyDeployedTraceContract({
      ...input, fetchImpl: async () => { throw new Error(token); },
    }).catch((failure) => failure);
    expect(error.message).toBe('deployed trace health request failed');
    expect(String(error)).not.toContain(token);
  });

  it.each(['http://worker.invalid', 'https://user:password@worker.invalid', 'https://worker.invalid/?token=private', 'not-a-url'])(
    'does not send credentials to an invalid or insecure endpoint: %s', async (baseUrl) => {
      const fetchImpl = vi.fn();
      await expect(verifyDeployedTraceContract({ ...input, baseUrl, fetchImpl })).rejects.toThrow('TRACE_BASE_URL');
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('fails before fetching when required configuration is missing', async () => {
    const fetchImpl = vi.fn();
    await expect(verifyDeployedTraceContract({ ...input, idToken: '', fetchImpl })).rejects.toThrow('are required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('can be imported by the pinned Node runtime without executing the live verifier', () => {
    const url = new URL('./verify-weekly-planning-trace-deployed-contract.mjs', import.meta.url).href;
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(url)});`], {
      encoding: 'utf8', env: { ...process.env, TRACE_BASE_URL: '', TRACE_ID_TOKEN: '' }, timeout: 10_000,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe('');
  });

  it('still runs as a CLI and exits unsuccessfully without required configuration', () => {
    const script = fileURLToPath(new URL('./verify-weekly-planning-trace-deployed-contract.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script], {
      encoding: 'utf8', env: { ...process.env, TRACE_BASE_URL: '', TRACE_ID_TOKEN: token }, timeout: 10_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('TRACE_BASE_URL and TRACE_ID_TOKEN are required');
    expect(run.stderr).not.toContain(token);
  });
});
