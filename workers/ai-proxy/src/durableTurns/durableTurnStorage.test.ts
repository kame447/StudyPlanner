import { describe, expect, it } from 'vitest';
import { DURABLE_TURN_LIMITS, type DurableTurnRecord } from './durableTurnJob';
import { encodeDurableTurnRecord, MAX_DURABLE_TURN_VALUE_BYTES, createDurableTurnStorage } from './durableTurnStorage';

const base: DurableTurnRecord = {
  identity: { ownerId: 'owner', conversationId: 'chat', requestId: 'request', baseRevision: 0, startedAt: 1 },
  fingerprint: 'fingerprint', acceptedAt: 1, expiresAt: 2, status: 'running',
};
describe('SQLite Durable Object turn field storage', () => {
  it('stores bounded fields below the per-value limit even when the whole job exceeds it', () => {
    const value = encodeDurableTurnRecord({ ...base, payload: 'a'.repeat(DURABLE_TURN_LIMITS.inputBytes),
      journal: Array.from({ length: 6 }, (_, i) => ({ fingerprint: String(i), status: 'completed', response: 'b'.repeat(DURABLE_TURN_LIMITS.responseBytes) })),
    });
    expect(Object.values(value).reduce((sum, text) => sum + new TextEncoder().encode(text).length, 0)).toBeGreaterThan(2 * 1024 * 1024);
    for (const [key, text] of Object.entries(value)) expect(new TextEncoder().encode(key + text).length).toBeLessThan(MAX_DURABLE_TURN_VALUE_BYTES);
    const final = encodeDurableTurnRecord({ ...base, status: 'completed', result: 'x'.repeat(DURABLE_TURN_LIMITS.outputBytes) });
    expect(Object.values(final).every((text) => text.length < MAX_DURABLE_TURN_VALUE_BYTES)).toBe(true);
  });
  it('counts Unicode bytes and rejects oversize field values', () => {
    expect(() => encodeDurableTurnRecord({ ...base, result: 'あ'.repeat(MAX_DURABLE_TURN_VALUE_BYTES / 2) })).toThrow('storage limit');
  });
  it('commits content, cleanup and alarm atomically and round-trips the current record', async () => {
    let data = new Map<string, string>(); let alarm: number | undefined; let fail = false;
    const storage = {
      get: async (keys: string[]) => new Map(keys.filter((key) => data.has(key)).map((key) => [key, data.get(key)!])),
      transaction: async (work: (tx: unknown) => Promise<void>) => {
        const pending = new Map(data); let nextAlarm = alarm;
        await work({ delete: async (keys: string[]) => keys.forEach((key) => pending.delete(key)),
          put: async (values: Record<string, string>) => Object.entries(values).forEach(([key, value]) => pending.set(key, value)),
          setAlarm: async (timestamp: number) => { nextAlarm = timestamp; },
        });
        if (fail) throw new Error('transaction rollback'); data = pending; alarm = nextAlarm;
      },
      setAlarm: async (time: number) => { alarm = time; },
    } as unknown as DurableObjectStorage;
    const adapter = createDurableTurnStorage(storage);
    const running = { ...base, payload: 'secret input', journal: [{ fingerprint: 'f', status: 'completed' as const, response: 'secret response' }] };
    await adapter.write(running, 5); expect(await adapter.read()).toEqual(running); expect(alarm).toBe(5);
    fail = true; await expect(adapter.write({ ...base, status: 'completed', result: 'reply' }, 10)).rejects.toThrow();
    expect(await adapter.read()).toEqual(running); expect(alarm).toBe(5);
    fail = false; const final = { ...base, status: 'completed' as const, result: 'reply' };
    await adapter.write(final, 10); expect(await adapter.read()).toEqual(final);
    expect([...data.keys()].sort()).toEqual(['turn:meta', 'turn:output']); expect(alarm).toBe(10);
    await adapter.write({ ...base, status: 'expired' }); expect([...data.keys()]).toEqual(['turn:meta']);
  });
});
