import { describe, expect, it, vi } from 'vitest';
import { createLocalScheduleEventAuthority } from '../../../src/repositories/localScheduleEventAuthority';
import { createLocalPlannerStorageGateway } from '../../../src/repositories/localStorageGateway';
import { ScheduleEventCommitError, type CommitScheduleEvent } from '../../../src/features/mcp/commitScheduleEvent';
import { createGatedCommit, createMcpOwnerCommitGateClass, type McpOwnerCommitGateNamespace } from './mcpOwnerCommitGate';
import { createMcpReadWorker } from './mcpReadWorker';

const OWNER = 'owner-a';
const range = { startDate: '2026-11-01', endDate: '2026-11-30' };
const candidate = (n: number) => ({ title: `予定${n}`, start: { date: '2026-11-09', time: `${String(8 + n).padStart(2, '0')}:00` },
  end: { date: '2026-11-09', time: `${String(8 + n).padStart(2, '0')}:30` }, timeZone: 'Asia/Tokyo' });
const request = (n: number, key = `request-${n}-0001`) => ({ ...candidate(n), idempotencyKey: key });
const timetable = { getScheduleTemplates: async () => [], getTimetableTerms: async () => [] };

async function sharedStore() {
  const values = new Map<string, string>();
  const storage: Storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }, clear: () => values.clear() };
  const authority = createLocalScheduleEventAuthority(createLocalPlannerStorageGateway(storage), storage);
  await authority.ensureMigrated(OWNER, async () => ({ plans: [], monthEvents: [] }));
  // Slow reads and writes make an unserialized read-then-write interleave.
  const rawUpsert = authority.upsertMonthEvent.bind(authority);
  const rawSnapshot = authority.getScheduleSnapshot.bind(authority);
  vi.spyOn(authority, 'getScheduleSnapshot').mockImplementation(async id => { await new Promise(r => setTimeout(r, 1)); return rawSnapshot(id); });
  vi.spyOn(authority, 'upsertMonthEvent').mockImplementation(async event => { await new Promise(r => setTimeout(r, 20)); return rawUpsert(event); });
  const saved = async () => (await rawSnapshot(OWNER)).monthEvents.filter(event => event.id.startsWith('mcp-'));
  return { authority, saved };
}

/** Each call of `isolate()` is a fresh module graph, i.e. its own per-owner queue, as in a separate Worker isolate. */
async function isolate(authority: Awaited<ReturnType<typeof sharedStore>>['authority'], dailyLimit: number) {
  vi.resetModules();
  const { createScheduleEventCommitter } = await import('../../../src/features/mcp/commitScheduleEvent');
  const gate = await import('./mcpOwnerCommitGate'); // same module graph, so the gate sees the committer's error classes
  const commit: CommitScheduleEvent = createScheduleEventCommitter({ ownerId: OWNER, timeZone: 'Asia/Tokyo', range, authority, timetable, dailyLimit,
    now: () => '2026-11-08T00:00:00.000Z', audit: () => undefined });
  return { commit, createGateClass: gate.createMcpOwnerCommitGateClass };
}

/** A Durable Object namespace: one instance per name, whatever the number of callers. */
function namespace(compose: () => CommitScheduleEvent, createGateClass = createMcpOwnerCommitGateClass) {
  const Gate = createGateClass<Record<string, never>>(compose);
  const instances = new Map<string, InstanceType<typeof Gate>>();
  const ns: McpOwnerCommitGateNamespace = {
    idFromName: name => name,
    get: id => ({ fetch: request => {
      const name = id as string;
      if (!instances.has(name)) instances.set(name, new Gate({}, {}));
      return instances.get(name)!.fetch(request);
    } }),
  };
  return { ns, instances };
}

describe('MCP owner commit gate', () => {
  it('control: without the gate, two isolates both pass the daily check and exceed the limit', async () => {
    const { authority, saved } = await sharedStore();
    const [a, b] = [(await isolate(authority, 1)).commit, (await isolate(authority, 1)).commit];
    await Promise.allSettled([a(OWNER, request(1)), b(OWNER, request(2))]);
    expect((await saved()).length).toBe(2); // limit is 1
  });

  it('stops exactly at the limit when callers in two isolates reach the same owner gate', async () => {
    const { authority, saved } = await sharedStore();
    const owner = await isolate(authority, 2); // the gate's single isolate
    const { ns, instances } = namespace(() => owner.commit, owner.createGateClass);
    const callerA = createGatedCommit(ns);
    const callerB = createGatedCommit(ns);
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(n => (n % 2 ? callerA : callerB)(OWNER, request(n))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(3);
    for (const r of rejected) expect(r.reason).toMatchObject({ code: 'daily_limit_exceeded' });
    expect(rejected[0].reason).toBeInstanceOf(ScheduleEventCommitError);
    expect(await saved()).toHaveLength(2);
    expect(instances.size).toBe(1);
  });

  it('routes different owners to different objects', async () => {
    const { ns, instances } = namespace(() => vi.fn(async () => { throw new ScheduleEventCommitError('invalid_commit'); }));
    const commit = createGatedCommit(ns);
    await expect(commit('owner-a', {})).rejects.toMatchObject({ code: 'invalid_commit' });
    await expect(commit('owner-b', {})).rejects.toMatchObject({ code: 'invalid_commit' });
    expect([...instances.keys()].sort()).toEqual(['owner-a', 'owner-b']);
  });

  it('a resend through the gate is idempotent', async () => {
    const { authority, saved } = await sharedStore();
    const owner = await isolate(authority, 5);
    const gated = namespace(() => owner.commit, owner.createGateClass);
    const commit = createGatedCommit(gated.ns);
    const first = await commit(OWNER, request(1, 'same-key-0001'));
    const again = await createGatedCommit(gated.ns)(OWNER, request(1, 'same-key-0001'));
    expect(first.status).toBe('saved');
    expect(again).toMatchObject({ status: 'already_saved', event: first.event });
    expect(await saved()).toHaveLength(1);
  });

  it('saves nothing and reports an unconfirmed outcome when the gate fails', async () => {
    const { authority, saved } = await sharedStore();
    const failing = createGatedCommit({ idFromName: n => n, get: () => ({ fetch: async () => { throw new Error('gate down'); } }) });
    await expect(failing(OWNER, request(1))).rejects.toThrow('gate down');
    const unconfigured = namespace(() => { throw new Error('Authority composition is not configured'); });
    await expect(createGatedCommit(unconfigured.ns)(OWNER, request(1))).rejects.toThrow('commit gate unavailable (500)');
    expect(await saved()).toHaveLength(0);
    void authority;

    const worker = createMcpReadWorker({ authenticate: async () => ({ ownerId: OWNER, scopes: ['schedule:read', 'schedule:commit'] }),
      commitScheduleEvent: createGatedCommit(unconfigured.ns) });
    const response = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', Authorization: 'Bearer x' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'commit_schedule_event', arguments: request(1) } }) }), { MCP_READ_ENABLED: 'true', MCP_COMMIT_ENABLED: 'true' });
    const body = await response.json() as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('Not confirmed saved');
    expect(await saved()).toHaveLength(0);
  });

  it('refuses a request for a different owner than the one the object serves', async () => {
    const { ns } = namespace(() => vi.fn(async () => { throw new ScheduleEventCommitError('invalid_commit'); }));
    const stub = ns.get('shared-name');
    const post = (ownerId: string) => stub.fetch(new Request('https://gate/commit', { method: 'POST', body: JSON.stringify({ ownerId, input: {} }) }));
    expect((await post('owner-a')).status).toBe(200);
    expect(await (await post('owner-b')).json()).toMatchObject({ ok: false, kind: 'range', code: 'owner_mismatch' });
  });
});
