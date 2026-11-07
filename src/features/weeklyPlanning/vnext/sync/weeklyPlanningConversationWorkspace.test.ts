import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createConversationWorkspace } from './weeklyPlanningConversationWorkspace';
import { conversationSyncFakeServer, conversationSyncMemoryStore, syncTestPayload, SYNC_TEST_NOW } from './conversationSyncTestFixture';
import type { ConversationScope } from './weeklyPlanningConversationSync';

const scope: ConversationScope = { ownerId: 'owner', chatId: 'ai-chat-test', weekStartDate: '2026-11-02', conversationId: 'conversation-test' };
const prefix = `studyplanner.weeklyPlanning.vnext.${scope.ownerId}.${scope.weekStartDate}.${scope.chatId}`;
let restore: () => void;
let storage: ReturnType<typeof createMemoryStorageHarness>;
beforeEach(() => { storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage); });
afterEach(() => restore());
function fixture(server = conversationSyncFakeServer(), local = conversationSyncMemoryStore()) {
  let busy = false; let active = true; let online = true;
  const installed = vi.fn();
  const changed = vi.fn();
  const workspace = createConversationWorkspace({ ownerId: scope.ownerId, local, remote: server.remote, legacy: storage.storage,
    legacyKeys: () => [...storage.values.keys()], active: () => active, busy: () => busy, changed, installed,
    online: () => online, now: () => SYNC_TEST_NOW });
  const write = (text: string) => workspace.storage.setItem(`${prefix}.ui`, syncTestPayload(scope, text).ui);
  return { workspace, local, server, write, installed, changed, setBusy(value: boolean) { busy = value; }, setActive(value: boolean) { active = value; },
    setOnline(value: boolean) { online = value; server.setOffline(!value); } };
}

describe('conversation workspace migration and reconciliation', () => {
  it('does not invalidate an admitted conversation turn for a no-op persistence check', async () => {
    const a = fixture();
    await a.workspace.open();
    await a.workspace.synchronize();
    a.changed.mockClear();
    await a.workspace.persist();
    await a.workspace.synchronize();
    expect(a.workspace.view.status).toBe('synced');
    expect(a.changed).not.toHaveBeenCalled();
  });

  it('migrates without altering legacy bytes and restores canonical IDB state after reload', async () => {
    const raw = syncTestPayload(scope, '以前の会話').ui; storage.storage.setItem(`${prefix}.ui`, raw);
    const a = fixture(); await a.workspace.open(); a.write('変更後'); await a.workspace.persist();
    expect(storage.storage.getItem(`${prefix}.ui`)).toBe(raw);
    expect(await a.workspace.synchronize()).toBe(true);
    const reloaded = fixture(a.server, a.local); await reloaded.workspace.open();
    expect(JSON.parse(reloaded.workspace.storage.getItem(`${prefix}.ui`)!).payload.state.messages[0].content).toBe('変更後');
    expect(storage.storage.getItem(`${prefix}.ui`)).toBe(raw);
  });
  it('rebuilds a fresh device chat index from a remote conversation without registering any plans', async () => {
    const a = fixture(); await a.workspace.open(); a.write('端末Aの会話'); await a.workspace.persist(); await a.workspace.synchronize();
    storage.values.clear();
    const b = fixture(a.server); await b.workspace.open(); await b.workspace.synchronize();
    const index = JSON.parse(storage.storage.getItem('studyplanner.aiPlanning.chats.v1.owner')!);
    expect(index.activeChatId).toBe(scope.chatId);
    expect(index.chats).toEqual([expect.objectContaining({ id: scope.chatId, title: '端末Aの会話' })]);
    expect(b.workspace.storage.getItem(`${prefix}.ui`)).toBe(syncTestPayload(scope, '端末Aの会話').ui);
    expect(a.server.writes).toBe(1);
  });
  it('preserves both devices until explicit conflict resolution and does not loop on retry', async () => {
    const a = fixture(); await a.workspace.open(); a.write('元'); await a.workspace.persist(); await a.workspace.synchronize();
    const b = fixture(a.server); await b.workspace.open(); await b.workspace.synchronize();
    a.write('A'); await a.workspace.persist(); await a.workspace.synchronize();
    b.write('B'); await b.workspace.persist(); expect(await b.workspace.synchronize()).toBe(false);
    expect(b.workspace.view.status).toBe('conflict'); expect(b.workspace.view.conflict?.working?.title).toBe('B');
    expect(b.workspace.view.conflict?.conflict?.payload?.title).toBe('A');
    await b.workspace.synchronize(); expect(a.server.writes).toBe(2);
    expect(await b.workspace.resolve('local')).toBe(true);
    expect((await a.server.remote.read(scope))?.payload?.title).toBe('B');
  });
  it('keeps an immutable outbox across a lost reply and a later local edit', async () => {
    const a = fixture(); await a.workspace.open(); a.write('一度目'); await a.workspace.persist(); a.server.loseNextReply();
    expect(await a.workspace.synchronize()).toBe(false);
    const pending = (await a.local.read(scope))!.pending;
    expect(pending).not.toBeNull(); a.write('二度目'); await a.workspace.persist();
    expect((await a.local.read(scope))!.pending).toEqual(pending);
    expect(await a.workspace.synchronize()).toBe(true);
    expect(a.server.writes).toBe(2); expect((await a.server.remote.read(scope))?.payload?.title).toBe('二度目');
  });
  it('does not replace the live runtime when reading back its own lost acknowledgement', async () => {
    const a = fixture(); await a.workspace.open(); a.write('同じ内容'); await a.workspace.persist();
    a.server.loseNextReply(); expect(await a.workspace.synchronize()).toBe(false);
    a.installed.mockClear(); expect(await a.workspace.synchronize()).toBe(true);
    expect(a.installed).not.toHaveBeenCalled(); expect(a.server.writes).toBe(1);
  });
  it('queues offline edits durably and sends them only on reconnect', async () => {
    const a = fixture(); await a.workspace.open(); a.setOnline(false); a.write('オフライン'); await a.workspace.persist();
    expect(await a.workspace.synchronize()).toBe(false); expect(a.workspace.view.status).toBe('offline');
    expect(a.server.writes).toBe(0); expect((await a.local.read(scope))?.working?.title).toBe('オフライン');
    a.setOnline(true); expect(await a.workspace.synchronize()).toBe(true); expect(a.server.writes).toBe(1);
  });
  it('does not install remote content while a turn or actual-save operation owns the runtime', async () => {
    const a = fixture(); await a.workspace.open(); a.write('元'); await a.workspace.persist(); await a.workspace.synchronize();
    const b = fixture(a.server); await b.workspace.open(); await b.workspace.synchronize(); b.installed.mockClear();
    a.write('別端末の更新'); await a.workspace.persist(); await a.workspace.synchronize();
    b.setBusy(true); expect(await b.workspace.synchronize()).toBe(false); expect(b.installed).not.toHaveBeenCalled();
    b.setBusy(false); await b.workspace.synchronize(); expect(b.installed).toHaveBeenCalledTimes(1);
  });
  it('never uploads an unresolved actual-save attempt and does not manufacture success', async () => {
    const a = fixture(); await a.workspace.open(); const value = JSON.parse(syncTestPayload(scope, '実績').ui);
    value.actualSaveAttempt = { attemptedAt: SYNC_TEST_NOW, records: [{ id: 'actual', minutes: 60 }] };
    a.workspace.storage.setItem(`${prefix}.ui`, JSON.stringify(value)); await a.workspace.persist();
    expect(await a.workspace.synchronize()).toBe(false); expect(a.server.writes).toBe(0);
    expect(JSON.parse((await a.local.read(scope))!.working!.ui).actualSaveAttempt).toEqual(value.actualSaveAttempt);
  });
});
