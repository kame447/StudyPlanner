import type { ConversationSyncUi } from '../../application/weeklyPlanningConversationSyncContract';
import { useEffect, useMemo, useState } from 'react';
import type { ConversationWorkspace, ConversationWorkspaceLocal, ConversationWorkspaceRemote } from './weeklyPlanningConversationWorkspace';
import { CONVERSATION_SYNC_POLICY, conversationSyncPreferenceKey } from './weeklyPlanningConversationSyncPolicy';

export interface ConversationSyncDependencies {
  local: ConversationWorkspaceLocal;
  remote: ConversationWorkspaceRemote;
  keys(): string[];
  online(): boolean;
  acquire(): Promise<() => void>;
}

export function useWeeklyPlanningConversationSync(ownerId: string, services: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now(): string;
  conversationSync?: (owner: string, alive: () => boolean) => Promise<ConversationSyncDependencies | null>;
}) {
  const [, redraw] = useState(0);
  const controller = useMemo(() => {
    let alive = true;
    let generation = 0;
    let backend: ConversationSyncDependencies | null = null;
    let workspace: ConversationWorkspace | null = null;
    let release: (() => void) | undefined;
    let unwatch: (() => void) | undefined;
    let mode: 'checking' | 'disabled' | 'loading' | 'locked' | 'error' | 'sync' = services.conversationSync ? 'checking' : 'disabled';
    let message = '';
    let available = Boolean(services.conversationSync);
    let epoch = 0;
    let bound: { busy(): boolean } = { busy: () => false };
    let opening: Promise<void> | null = null;
    let enableWhenIdle = false;
    let observation = false;
    const notify = () => { if (alive) redraw(value => value + 1); };
    const hasMarker = () => {
      try { return services.storage.getItem(conversationSyncPreferenceKey(ownerId)) === CONVERSATION_SYNC_POLICY; }
      catch { return true; }
    };
    const valid = (ticket: number) => alive && ticket === generation;
    const load = async (ticket: number) => {
      if (!backend) {
        const next = await services.conversationSync?.(ownerId, () => valid(ticket)) ?? null;
        if (!valid(ticket)) { void next?.local.close(); return null; }
        backend = next;
      }
      if (!backend) { available = false; mode = 'disabled'; notify(); }
      return backend;
    };
    async function install(ticket: number) {
      if (!backend || !valid(ticket)) return;
      if (bound.busy()) { enableWhenIdle = true; return; }
      mode = 'loading'; notify();
      const acquired = await backend.acquire();
      if (!valid(ticket)) { acquired(); return; }
      release = acquired;
      const { createConversationWorkspace } = await import('./weeklyPlanningConversationWorkspace');
      if (!valid(ticket)) return;
      const next = createConversationWorkspace({ ownerId, local: backend.local, remote: backend.remote,
        legacy: services.storage, legacyKeys: backend.keys, active: () => valid(ticket), busy: () => bound.busy(),
        online: backend.online, now: services.now, changed: notify,
        installed: () => { if (valid(ticket)) { mode = 'loading'; epoch++; notify(); } },
      });
      await next.open();
      if (!valid(ticket)) return;
      workspace = next; epoch++; notify();
    }
    const fail = (error: unknown) => {
      if (!alive) return;
      if (!workspace && release) { release(); release = undefined; }
      mode = error instanceof Error && error.message === 'conversation-open-in-another-tab' ? 'locked' : 'error';
      message = mode === 'locked' ? '別のタブで会話を開いています。そのタブを閉じてから再試行してください。'
        : '同期の準備ができませんでした。保存済みの内容は変更していません。';
      notify();
    };
    async function bootstrap(explicitEnable = false) {
      if (opening || !alive || workspace) return;
      const ticket = generation;
      const task = (async () => {
        const dependencies = await load(ticket); if (!dependencies || !valid(ticket)) return;
        const cached = hasMarker();
        if (cached && !explicitEnable) { await install(ticket); return; }
        if (explicitEnable) await dependencies.remote.enable();
        const enabled = explicitEnable || await dependencies.remote.consent();
        if (!valid(ticket)) return;
        if (!enabled) { mode = 'disabled'; notify(); return; }
        services.storage.setItem(conversationSyncPreferenceKey(ownerId), CONVERSATION_SYNC_POLICY);
        await install(ticket);
      })().catch(error => { if (valid(ticket)) fail(error); }).finally(() => { if (opening === task) opening = null; });
      opening = task; await task;
    }
    async function observe() {
      if (!alive) return;
      if (enableWhenIdle && !bound.busy()) { enableWhenIdle = false; await bootstrap(); }
      if (!workspace || bound.busy() || observation || mode !== 'sync' || !workspace.hasWork) return;
      observation = true;
      try { await workspace.persist(); await workspace.synchronize(); }
      catch { /* Workspace publishes the recoverable error and retains the bytes. */ }
      finally { observation = false; notify(); }
    }
    const transcript = (raw?: string) => {
      if (!raw) return '';
      try { return JSON.parse(raw).payload.state.messages.map((row: { role: string; content: string }) =>
        `${row.role === 'user' ? 'あなた' : 'AI'}: ${row.content}`).join('\n'); } catch { return ''; }
    };
    return {
      get storage() { return workspace?.storage; },
      get epoch() { return epoch; },
      get ui(): ConversationSyncUi | undefined {
        if (!available) return undefined;
        const view = workspace?.view;
        return { status: mode === 'sync' ? view!.status : mode,
          message: mode === 'sync' ? view!.message || message : message,
          unpersisted: workspace?.hasUnpersisted ?? false,
          remoteDeleted: view?.conflict?.conflict?.deleted ?? false,
          localText: transcript(view?.conflict?.working?.ui), remoteText: transcript(view?.conflict?.conflict?.payload?.ui),
          enable: () => bootstrap(true),
          retry: async () => { if (workspace) { mode = 'sync'; message = ''; await workspace.synchronize(); notify(); } else await bootstrap(); },
          resolve: async choice => { if (workspace) { await workspace.resolve(choice); notify(); } },
        };
      },
      permitsEditing: () => !workspace?.installing && !(mode === 'checking' && hasMarker()) && mode !== 'loading' && mode !== 'locked'
        && !(mode === 'error' && hasMarker()) && workspace?.view.status !== 'conflict',
      get unpersisted() { return workspace?.hasUnpersisted ?? false; },
      bind(ports: { busy(): boolean }, currentStorage: typeof services.storage) {
        bound = ports;
        if (workspace && mode === 'loading' && currentStorage === workspace.storage) {
          mode = 'sync'; notify();
          if (!unwatch) unwatch = backend?.remote.watch?.(() => { if (!bound.busy()) void workspace?.synchronize(); },
            () => { message = '同期接続を確認できません。再試行してください。'; notify(); });
          void workspace.synchronize();
        }
      },
      observe,
      async persist() { if (workspace) await workspace.persist(); },
      async beforeApproval(): Promise<boolean> {
        if (!workspace) return mode === 'disabled' || mode === 'checking';
        if (bound.busy() || !backend?.online()) return false;
        return workspace.synchronize();
      },
      deleted(chatId: string) { if (workspace) void workspace.deleteChat(chatId).catch(() => notify()); },
      start: () => bootstrap(),
      async refresh() { if (workspace) { if (!bound.busy()) await workspace.synchronize(); } else await bootstrap(); },
      activate() { alive = true; generation++; },
      close() {
        alive = false; generation++; opening = null;
        unwatch?.(); unwatch = undefined; release?.(); release = undefined;
        void backend?.local.close(); backend = null; workspace = null;
      },
    };
  }, [ownerId, services]);
  useEffect(() => {
    controller.activate();
    if (!services.conversationSync) return () => controller.close();
    void controller.start();
    const refresh = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void controller.refresh(); };
    if (typeof window !== 'undefined') {
      window.addEventListener?.('online', refresh); window.addEventListener?.('focus', refresh);
      if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', refresh);
    }
    return () => {
      if (typeof window !== 'undefined') { window.removeEventListener?.('online', refresh); window.removeEventListener?.('focus', refresh); }
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', refresh);
      controller.close();
    };
  }, [controller, services.conversationSync]);
  return controller;
}
