import { describe, expect, it } from 'vitest';
import { createConversationSync, type ConversationLocalRecord, type ConversationLocalStore, type ConversationRemoteStore,
  type ConversationOperation, type ConversationSnapshot, type ConversationScope } from './weeklyPlanningConversationSync';

const scope: ConversationScope = { ownerId: 'owner', chatId: 'ai-chat-test', weekStartDate: '2026-11-02', conversationId: 'conversation-test' };
const payload = (text: string) => ({ core: null, ui: text, title: text });
function localStore(): ConversationLocalStore {
  const records = new Map<string, ConversationLocalRecord>();
  return {
    read: async s => structuredClone(records.get(JSON.stringify(s)) ?? null),
    update: async (s, change) => {
      const key = JSON.stringify(s);
      const next = change(structuredClone(records.get(key) ?? null));
      records.set(key, structuredClone(next));
      return structuredClone(next);
    },
  };
}
function cloud() {
  let current: ConversationSnapshot | null = null;
  let writes = 0;
  const store: ConversationRemoteStore = {
    read: async () => structuredClone(current),
    commit: async (op: ConversationOperation) => {
      if (current?.operationId === op.operationId) return { status: 'accepted', snapshot: structuredClone(current) };
      if ((current?.revision ?? 0) !== op.baseRevision || current?.deleted) return { status: 'conflict', snapshot: structuredClone(current) };
      current = { scope: op.scope, revision: op.baseRevision + 1, operationId: op.operationId, deleted: op.payload === null, payload: op.payload };
      writes++;
      return { status: 'accepted', snapshot: structuredClone(current) };
    },
  };
  return { store, get writes() { return writes; }, get current() { return current; } };
}
let sequence = 0;
function replica(remote: ConversationRemoteStore, local = localStore(), active = () => true) {
  return { local, sync: createConversationSync({ local, remote, ownerId: 'owner', active,
    operationId: () => `operation-${++sequence}`, validatePayload: () => true }) };
}

describe('VNext conversation shared revisions and durable outbox', () => {
  it('restores a committed conversation into a genuinely independent device', async () => {
    const remote = cloud(); const a = replica(remote.store); const b = replica(remote.store);
    await a.sync.stage(scope, payload('数学を60分'), 0);
    expect((await a.sync.flush(scope)).status).toBe('synced');
    expect((await b.sync.refresh(scope)).working).toEqual(payload('数学を60分'));
    expect((await b.local.read(scope))?.confirmed?.revision).toBe(1);
    expect(remote.writes).toBe(1);
  });
  it('keeps both versions when two devices modify the same shared revision', async () => {
    const remote = cloud(); const a = replica(remote.store); const b = replica(remote.store);
    await a.sync.stage(scope, payload('元'), 0); await a.sync.flush(scope); await b.sync.refresh(scope);
    await a.sync.stage(scope, payload('端末A'), (await a.local.read(scope))!.generation);
    await b.sync.stage(scope, payload('端末B'), (await b.local.read(scope))!.generation);
    await a.sync.flush(scope);
    expect((await b.sync.flush(scope)).status).toBe('conflict');
    const record = (await b.local.read(scope))!;
    expect(record.working).toEqual(payload('端末B'));
    expect(record.conflict?.payload).toEqual(payload('端末A'));
    expect(remote.current?.payload).toEqual(payload('端末A'));
    expect((await b.sync.flush(scope)).status).toBe('conflict');
    expect(remote.writes).toBe(2);
  });
  it('survives offline, reload and reconnect without inventing a successful cloud save', async () => {
    const remote = cloud(); let offline = true;
    const transport = { ...remote.store, commit: async (op: ConversationOperation) => {
      if (offline) throw new Error('offline'); return remote.store.commit(op);
    } };
    const a = replica(transport); await a.sync.stage(scope, payload('未送信'), 0);
    await expect(a.sync.flush(scope)).rejects.toThrow('offline');
    const pending = (await a.local.read(scope))!.pending;
    expect(pending).not.toBeNull(); expect(remote.writes).toBe(0);
    offline = false;
    const reloaded = replica(transport, a.local);
    expect((await reloaded.sync.flush(scope)).status).toBe('synced');
    expect(remote.current?.operationId).toBe(pending!.operationId);
    expect(remote.writes).toBe(1);
  });
  it('reuses the same immutable operation after a committed response is lost', async () => {
    const remote = cloud(); let lose = true;
    const a = replica({ ...remote.store, commit: async op => {
      const result = await remote.store.commit(op); if (lose) { lose = false; throw new Error('response lost'); } return result;
    } });
    await a.sync.stage(scope, payload('保存済みだが応答なし'), 0);
    await expect(a.sync.flush(scope)).rejects.toThrow('response lost');
    for (let i = 0; i < 100; i++) expect((await a.sync.flush(scope)).status).toBe('synced');
    expect(remote.writes).toBe(1);
  });
  it('does not clear a newer local edit when an older commit returns', async () => {
    const remote = cloud(); let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const a = replica({ ...remote.store, commit: async op => { await held; return remote.store.commit(op); } });
    await a.sync.stage(scope, payload('先の変更'), 0);
    const saving = a.sync.flush(scope);
    await Promise.resolve(); await Promise.resolve();
    const generation = (await a.local.read(scope))!.generation;
    await a.sync.stage(scope, payload('後の変更'), generation);
    release();
    expect((await saving).status).toBe('pending');
    expect((await a.local.read(scope))!.working).toEqual(payload('後の変更'));
    expect((await a.sync.flush(scope)).status).toBe('synced');
    expect(remote.current?.payload).toEqual(payload('後の変更'));
  });
  it('rejects a stale local editor before it can overwrite another local transaction', async () => {
    const a = replica(cloud().store);
    await a.sync.stage(scope, payload('先に保存'), 0);
    await expect(a.sync.stage(scope, payload('古い画面'), 0)).rejects.toThrow('local-revision-conflict');
    expect((await a.local.read(scope))!.working).toEqual(payload('先に保存'));
  });
  it('never applies a late result to a changed account or sends another owner data', async () => {
    const remote = cloud(); let active = true;
    const a = replica({ ...remote.store, commit: async op => { const result = await remote.store.commit(op); active = false; return result; } }, localStore(), () => active);
    await a.sync.stage(scope, payload('owner'), 0);
    await expect(a.sync.flush(scope)).rejects.toThrow('owner-changed');
    expect((await a.local.read(scope))!.pending).not.toBeNull();
    await expect(a.sync.stage({ ...scope, ownerId: 'another' }, payload('bad'), 0)).rejects.toThrow('owner-changed');
  });
  it('uses a tombstone so an old offline device cannot resurrect a deleted chat', async () => {
    const remote = cloud(); const a = replica(remote.store); const b = replica(remote.store);
    await a.sync.stage(scope, payload('old'), 0); await a.sync.flush(scope); await b.sync.refresh(scope);
    await a.sync.stage(scope, null, (await a.local.read(scope))!.generation); await a.sync.flush(scope);
    await b.sync.stage(scope, payload('offline edit'), (await b.local.read(scope))!.generation);
    expect((await b.sync.flush(scope)).status).toBe('conflict');
    expect(remote.current?.deleted).toBe(true);
    expect((await b.local.read(scope))!.working).toEqual(payload('offline edit'));
  });
  it('keeps local changes and a missing-server error instead of recreating deleted history', async () => {
    const remote = cloud(); const a = replica(remote.store);
    await a.sync.stage(scope, payload('old'), 0); await a.sync.flush(scope);
    const reload = replica({ ...remote.store, read: async () => null }, a.local);
    await expect(reload.sync.refresh(scope)).rejects.toThrow('remote-state-missing');
    expect((await a.local.read(scope))!.working).toEqual(payload('old'));
  });
  it('coalesces concurrent flushes without creating additional operations', async () => {
    const remote = cloud(); const a = replica(remote.store);
    await a.sync.stage(scope, payload('once'), 0);
    await Promise.all([a.sync.flush(scope), a.sync.flush(scope), a.sync.flush(scope)]);
    expect(remote.writes).toBe(1);
  });
});
