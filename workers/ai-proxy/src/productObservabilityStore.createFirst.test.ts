import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductObservabilityStore } from './productObservabilityStore';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';

// API-zero diagnostic. Every fetch is intercepted; only the synthetic project
// path is accepted. The token provider returns an inert fixture, never a secret.
const env = { FIREBASE_PROJECT_ID: 'demo-firestore-read-audit', FIREBASE_SERVICE_ACCOUNT_EMAIL: 'unused@example.test', FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused', OBSERVABILITY_IDENTITY_SECRET: 'synthetic-nonsecret-fixture-0123456789', ENVIRONMENT: 'test' };
const root = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/`;
function draft(id = 'activity-read-audit-12345678') {
  return { schemaVersion: 1, eventId: id, eventType: 'product_activity', occurredAt: '2026-10-13T00:00:00.000Z', appVersion: 'test', source: 'web_app', correlation: {}, payload: { action: 'weekly_planning_opened' } };
}
function harness() {
  const docs = new Map<string, {fields: Record<string, unknown>}>();
  const calls: Array<{method: string; collection: string; status: number}> = [];
  let clock = new Date('2026-10-13T00:01:00.000Z');
  type WriteOutcome = 'normal' | 'commit-then-error' | 'error-without-commit' | 'commit-then-network-error' | 'network-error' | 'denied';
  let outcome: WriteOutcome = 'normal';
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (!url.startsWith(root)) throw new Error(`Unexpected external target rejected: ${url}`);
    const suffix = url.slice(root.length), parsed = new URL(url), method = init.method ?? 'GET';
    if (method === 'GET') {
      const key = suffix, value = docs.get(key), status = value ? 200 : 404;
      calls.push({method, collection: key.split('/')[0], status});
      return new Response(value ? JSON.stringify({name: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${key}`, ...value}) : '{}', {status});
    }
    if (method !== 'POST') throw new Error(`Unexpected method ${method}`);
    const collection = suffix.split('?')[0], key = `${collection}/${parsed.searchParams.get('documentId')}`;
    if (!parsed.searchParams.get('documentId')) throw new Error('Unexpected POST, expected immutable create');
    const status = docs.has(key) ? 409 : outcome === 'normal' ? 200 : outcome === 'denied' ? 403 : 503;
    calls.push({method, collection, status});
    if (!docs.has(key) && ['normal', 'commit-then-error', 'commit-then-network-error'].includes(outcome)) {
      docs.set(key, JSON.parse(String(init.body)));
    }
    if (outcome === 'network-error' || outcome === 'commit-then-network-error') {
      throw new TypeError('synthetic response lost');
    }
    return new Response('{}', {status});
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new FirestoreServiceAccountClient(env, { getToken: async () => 'synthetic-inert-token' });
  const store = new ProductObservabilityStore(env, client, crypto, () => clock);
  return {store, docs, calls, setClock: (value: string) => { clock = new Date(value); }, setOutcome: (value: typeof outcome) => {outcome = value;}, reset: () => {calls.length = 0;}, capture: (name: string) => {
    const value = {name, logicalRequests: calls.slice(), eventGets: calls.filter(c=>c.collection === 'observability_events' && c.method === 'GET').length, actorGets: calls.filter(c=>c.collection === 'observability_actor_directory' && c.method === 'GET').length, successfulEventCreates: calls.filter(c=>c.collection === 'observability_events' && c.method === 'POST' && c.status === 200).length};
    return value;
  }};
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('immutable event ingestion read budget', () => {
  it('counts new ingestion, exact replay with a later ingestion time, and changed-payload conflict', async () => {
    const h = harness(); await h.store.resolveActorSubjectId('owner-a'); h.reset();
    await h.store.storeProductActivity('owner-a', draft());
    expect(h.capture('new event').eventGets).toBe(0);
    const stored = JSON.stringify([...h.docs]); h.reset(); h.setClock('2026-10-13T00:02:00.000Z');
    await h.store.storeProductActivity('owner-a', draft());
    expect(h.capture('same event later replay').eventGets).toBe(1);
    expect(JSON.stringify([...h.docs])).toBe(stored);
    h.reset();
    await expect(h.store.storeProductActivity('owner-a', {...draft(), appVersion:'changed'})).rejects.toThrow('idempotency conflict');
    expect(h.capture('changed payload same ID').eventGets).toBe(1);
    expect(JSON.stringify([...h.docs])).toBe(stored);
  });
  it.each(['commit-then-error', 'error-without-commit'] as const)('records the ambiguous %s boundary', async mode => {
    const h = harness(); await h.store.resolveActorSubjectId('owner-a'); h.reset(); h.setOutcome(mode);
    const result = h.store.storeProductActivity('owner-a', draft());
    if (mode === 'commit-then-error') await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toThrow('Firestore immutable write failed: 503');
    expect(h.capture(mode).eventGets).toBe(1);
  });
  it('proves lower immutable create compares its conflicting document once', async () => {
    const h = harness(); await h.store.resolveActorSubjectId('owner-a'); await h.store.storeProductActivity('owner-a', draft());
    const [key, event] = [...h.docs].find(([key])=>key.startsWith('observability_events/'))!;
    const client = new FirestoreServiceAccountClient(env, {getToken:async()=>'synthetic-inert-token'});
    h.reset(); await expect(client.setImmutableDocument('observability_events', key.split('/')[1], {different: true})).rejects.toThrow('immutable document conflict');
    expect(h.capture('lower 409 comparison').eventGets).toBe(1);
    expect(h.docs.get(key)).toEqual(event);
  });
  it('retains actor-scoped canonical event identity for the same client event ID', async () => {
    const h = harness();
    await h.store.resolveActorSubjectId('owner-a');
    await h.store.resolveActorSubjectId('owner-b');
    h.reset();
    await h.store.storeProductActivity('owner-a', draft());
    await h.store.storeProductActivity('owner-b', draft());
    const events = [...h.docs].filter(([key]) => key.startsWith('observability_events/'));
    expect(events).toHaveLength(2);
    expect(events[0][0]).not.toBe(events[1][0]);
    expect(events[0][1].fields.actorSubjectId).not.toEqual(events[1][1].fields.actorSubjectId);
    expect(h.capture('two owners').eventGets).toBe(0);
    expect(JSON.stringify(events)).not.toContain('owner-a');
    expect(JSON.stringify(events)).not.toContain('owner-b');
  });

  it('deduplicates overlapping first deliveries with one create and one collision read', async () => {
    const h = harness();
    await h.store.resolveActorSubjectId('owner-a');
    h.reset();
    await Promise.all([
      h.store.storeProductActivity('owner-a', draft()),
      h.store.storeProductActivity('owner-a', draft()),
    ]);
    expect([...h.docs.keys()].filter(key => key.startsWith('observability_events/'))).toHaveLength(1);
    expect(h.capture('concurrent identical events')).toMatchObject({
      eventGets: 1, actorGets: 2, successfulEventCreates: 1,
    });
  });

  it('rejects overlapping conflicting deliveries without overwriting the successful event', async () => {
    const h = harness();
    await h.store.resolveActorSubjectId('owner-a');
    h.reset();
    const results = await Promise.allSettled([
      h.store.storeProductActivity('owner-a', draft()),
      h.store.storeProductActivity('owner-a', { ...draft(), appVersion: 'different' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect([...h.docs.keys()].filter(key => key.startsWith('observability_events/'))).toHaveLength(1);
    expect(h.capture('concurrent conflicting events')).toMatchObject({ eventGets: 1, successfulEventCreates: 1 });
  });

  it.each(['commit-then-network-error', 'network-error'] as const)(
    'fresh-reads an unknown transport outcome: %s', async outcome => {
      const h = harness();
      await h.store.resolveActorSubjectId('owner-a');
      h.reset();
      h.setOutcome(outcome);
      const pending = h.store.storeProductActivity('owner-a', draft());
      if (outcome === 'commit-then-network-error') await expect(pending).resolves.toBeUndefined();
      else await expect(pending).rejects.toThrow('synthetic response lost');
      expect(h.capture(outcome).eventGets).toBe(1);
    },
  );

  it('does not mistake a 403 write denial for a 409 or report an absent event as saved', async () => {
    const h = harness();
    await h.store.resolveActorSubjectId('owner-a');
    h.reset();
    h.setOutcome('denied');
    await expect(h.store.storeProductActivity('owner-a', draft())).rejects.toThrow('Firestore immutable write failed: 403');
    expect(h.capture('denied event')).toMatchObject({ eventGets: 1, successfulEventCreates: 0 });
    expect([...h.docs.keys()].filter(key => key.startsWith('observability_events/'))).toHaveLength(0);
  });

  it('never accepts a mismatched actor in collision evidence', async () => {
    const h = harness();
    await h.store.storeProductActivity('owner-a', draft());
    const [key, event] = [...h.docs].find(([key]) => key.startsWith('observability_events/'))!;
    event.fields.actorSubjectId = { stringValue: 'different-actor' };
    const original = JSON.stringify(event);
    h.reset();
    await expect(h.store.storeProductActivity('owner-a', draft())).rejects.toThrow('idempotency conflict');
    expect(h.capture('mismatched actor').eventGets).toBe(1);
    expect(JSON.stringify(h.docs.get(key))).toBe(original);
  });

  it('validates untrusted event data before resolving the actor or attempting a create', async () => {
    const h = harness();
    await expect(h.store.storeProductActivity('owner-a', { ...draft(), rawText: 'private-sentinel' })).rejects.toThrow('unknown fields');
    expect(h.calls).toHaveLength(0);
    expect(h.docs.size).toBe(0);
  });

});
