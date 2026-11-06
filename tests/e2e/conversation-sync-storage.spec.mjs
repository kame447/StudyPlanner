import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = buildSync({
  stdin: { contents: `export { createIndexedDbConversationStore } from './src/features/weeklyPlanning/vnext/sync/weeklyPlanningConversationIndexedDb';
    export { createConversationSync } from './src/features/weeklyPlanning/vnext/sync/weeklyPlanningConversationSync';`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2020',
}).outputFiles[0].text;
const origin = 'http://127.0.0.1:19473';

test.beforeEach(async ({ page }) => {
  // The browser executes the actual IndexedDB adapter. All fixture requests are intercepted;
  // there is no production endpoint, saved user profile or fake IndexedDB implementation.
  await page.route(`${origin}/**`, route => route.fulfill({
    contentType: route.request().url().endsWith('/sync.js') ? 'text/javascript' : 'text/html',
    body: route.request().url().endsWith('/sync.js') ? bundle : '<!doctype html><title>Conversation persistence fixture</title>',
  }));
  await page.goto(origin);
});

test('native IndexedDB survives offline, page reload and reconnect with the identical operation', async ({ page }) => {
  const pending = await page.evaluate(async () => {
    const { createIndexedDbConversationStore, createConversationSync } = await import('/sync.js');
    const local = createIndexedDbConversationStore();
    const scope = { ownerId: 'owner', chatId: 'ai-chat-native', weekStartDate: '2026-11-02', conversationId: 'conversation' };
    const sync = createConversationSync({ local, ownerId: 'owner', active: () => true, operationId: () => 'same-operation', validatePayload: () => true,
      remote: { read: async () => null, commit: async () => { throw new Error('offline'); } } });
    await sync.stage(scope, { core: null, ui: '数学を60分', title: '数学' }, 0);
    let error;
    try { await sync.flush(scope); } catch (caught) { error = caught.message; }
    const record = await local.read(scope); await local.close();
    return { error, pending: record.pending };
  });
  expect(pending.error).toBe('offline');
  expect(pending.pending.operationId).toBe('same-operation');
  await page.reload();
  const result = await page.evaluate(async () => {
    const { createIndexedDbConversationStore, createConversationSync } = await import('/sync.js');
    const local = createIndexedDbConversationStore(); const calls = [];
    const scope = { ownerId: 'owner', chatId: 'ai-chat-native', weekStartDate: '2026-11-02', conversationId: 'conversation' };
    const sync = createConversationSync({ local, ownerId: 'owner', active: () => true, operationId: () => 'must-not-be-used', validatePayload: () => true,
      remote: { read: async () => null, commit: async op => { calls.push(op); return { status: 'accepted', snapshot: {
        scope: op.scope, revision: op.baseRevision + 1, operationId: op.operationId, payload: op.payload, deleted: op.payload === null,
      } }; } } });
    const saved = await sync.flush(scope); const record = await local.read(scope); await local.close();
    return { status: saved.status, calls, record };
  });
  expect(result.status).toBe('synced');
  expect(result.calls).toEqual([pending.pending]);
  expect(result.record.pending).toBeNull();
  expect(result.record.working.ui).toBe('数学を60分');
});

test('two connections serialize the local generation check without a lost update', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createIndexedDbConversationStore, createConversationSync } = await import('/sync.js');
    const a = createIndexedDbConversationStore(); const b = createIndexedDbConversationStore();
    const scope = { ownerId: 'owner', chatId: 'ai-chat-race', weekStartDate: '2026-11-02', conversationId: 'conversation' };
    const make = local => createConversationSync({ local, ownerId: 'owner', active: () => true, operationId: () => 'unused', validatePayload: () => true,
      remote: { read: async () => null, commit: async () => { throw new Error('not-called'); } } });
    const outcomes = await Promise.allSettled([
      make(a).stage(scope, { core: null, ui: 'A', title: 'A' }, 0), make(b).stage(scope, { core: null, ui: 'B', title: 'B' }, 0),
    ]);
    const record = await a.read(scope); await a.close(); await b.close();
    return { outcomes: outcomes.map(row => ({ status: row.status, error: row.status === 'rejected' ? row.reason.message : null })), record };
  });
  expect(result.outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  expect(result.outcomes.filter(row => row.error === 'local-revision-conflict')).toHaveLength(1);
  expect(result.record.generation).toBe(1);
  expect(['A', 'B']).toContain(result.record.working.ui);
});

test('an aborted local transaction leaves previous bytes and outbox intact', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createIndexedDbConversationStore, createConversationSync } = await import('/sync.js');
    const local = createIndexedDbConversationStore();
    const scope = { ownerId: 'owner', chatId: 'ai-chat-abort', weekStartDate: '2026-11-02', conversationId: 'conversation' };
    const sync = createConversationSync({ local, ownerId: 'owner', active: () => true, operationId: () => 'pending', validatePayload: () => true,
      remote: { read: async () => null, commit: async () => { throw new Error('offline'); } } });
    await sync.stage(scope, { core: null, ui: 'keep', title: 'keep' }, 0);
    try { await sync.flush(scope); } catch { /* Deliberate offline fixture. */ }
    const before = await local.read(scope); let error;
    try { await local.update(scope, () => { throw new Error('abort-this-transaction'); }); } catch (caught) { error = caught.message; }
    const after = await local.read(scope); await local.close(); return { before, after, error };
  });
  expect(result.error).toBe('abort-this-transaction');
  expect(result.after).toEqual(result.before);
  expect(result.after.pending.operationId).toBe('pending');
});

test('account cleanup removes only that owner including pending operations', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createIndexedDbConversationStore, createConversationSync } = await import('/sync.js');
    const local = createIndexedDbConversationStore();
    const scope = ownerId => ({ ownerId, chatId: 'ai-chat-owned', weekStartDate: '2026-11-02', conversationId: 'conversation' });
    for (const ownerId of ['A', 'B']) {
      const sync = createConversationSync({ local, ownerId, active: () => true, operationId: () => ownerId, validatePayload: () => true,
        remote: { read: async () => null, commit: async () => { throw new Error('offline'); } } });
      await sync.stage(scope(ownerId), { core: null, ui: ownerId, title: ownerId }, 0);
      try { await sync.flush(scope(ownerId)); } catch { /* Deliberate offline fixture. */ }
    }
    await local.removeOwner('A'); const a = await local.read(scope('A')); const b = await local.read(scope('B'));
    await local.close(); return { a, b };
  });
  expect(result.a).toBeNull();
  expect(result.b.working.ui).toBe('B');
  expect(result.b.pending.operationId).toBe('B');
});
