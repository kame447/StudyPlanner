import { describe, expect, it, vi } from 'vitest';
import worker from './traceWorker';
import { AiQuotaDurableObject } from './aiQuotaDurableObject';

describe('account deletion production wiring', () => {
  it('dispatches preflight in the wrangler production entry with the configured origin', async () => {
    const response = await worker.fetch(new Request('https://worker.test/account/delete', {
      method: 'OPTIONS', headers: { Origin: 'https://app.example.test' },
    }), { ALLOWED_ORIGIN: 'https://app.example.test' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
  });

  it('clears per-user quota durable storage through the server-only RPC', async () => {
    const deleteAll = vi.fn(async () => {});
    const quota = new AiQuotaDurableObject({ storage: { deleteAll } } as never, {});
    await quota.clearForAccountDeletion();
    await quota.clearForAccountDeletion();
    expect(deleteAll).toHaveBeenCalledTimes(2);
  });
});
