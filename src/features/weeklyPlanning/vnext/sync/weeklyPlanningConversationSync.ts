export interface ConversationScope {
  ownerId: string;
  chatId: string;
  weekStartDate: string;
  conversationId: string;
}

export interface ConversationPayload {
  core: string | null;
  ui: string;
  title: string;
}

export interface ConversationSnapshot {
  scope: ConversationScope;
  revision: number;
  operationId: string;
  deleted: boolean;
  payload: ConversationPayload | null;
}

export interface ConversationOperation {
  scope: ConversationScope;
  operationId: string;
  baseRevision: number;
  payload: ConversationPayload | null;
}

export interface ConversationLocalRecord {
  version: 1;
  scope: ConversationScope;
  generation: number;
  confirmed: ConversationSnapshot | null;
  working: ConversationPayload | null;
  dirty: boolean;
  pending: ConversationOperation | null;
  blocked: 'conflict' | null;
  conflict: ConversationSnapshot | null;
}

/** update executes its synchronous callback inside one durable local transaction. */
export interface ConversationLocalStore {
  read(scope: ConversationScope): Promise<ConversationLocalRecord | null>;
  update(scope: ConversationScope, change: (record: ConversationLocalRecord | null) => ConversationLocalRecord): Promise<ConversationLocalRecord>;
}

export interface ConversationRemoteStore {
  read(scope: ConversationScope): Promise<ConversationSnapshot | null>;
  commit(operation: ConversationOperation): Promise<
    | { status: 'accepted'; snapshot: ConversationSnapshot }
    | { status: 'conflict'; snapshot: ConversationSnapshot | null }
  >;
}

export type ConversationSyncResult = { status: 'synced' | 'pending' | 'conflict'; record: ConversationLocalRecord };

export function conversationScopeKey(scope: ConversationScope): string {
  return JSON.stringify([scope.ownerId, scope.chatId, scope.weekStartDate, scope.conversationId]);
}

export function sameConversationScope(left: ConversationScope, right: ConversationScope): boolean {
  return conversationScopeKey(left) === conversationScopeKey(right);
}

function samePayload(left: ConversationPayload | null, right: ConversationPayload | null): boolean {
  return left === right || (left !== null && right !== null && left.core === right.core && left.ui === right.ui && left.title === right.title);
}

function initial(scope: ConversationScope): ConversationLocalRecord {
  return { version: 1, scope, generation: 0, confirmed: null, working: null, dirty: false,
    pending: null, blocked: null, conflict: null };
}

/** Shared revision is independent from the UI and fact-graph revisions. No timestamp wins. */
export function createConversationSync(ports: {
  ownerId: string;
  active(): boolean;
  local: ConversationLocalStore;
  remote: ConversationRemoteStore;
  operationId(): string;
  validatePayload(scope: ConversationScope, payload: ConversationPayload): boolean;
}) {
  const inflight = new Map<string, Promise<ConversationSyncResult>>();
  function guard(scope: ConversationScope) {
    if (scope.ownerId !== ports.ownerId || !ports.active()) throw new Error('owner-changed');
  }
  function local(record: ConversationLocalRecord | null, scope: ConversationScope): ConversationLocalRecord {
    guard(scope);
    if (record && (record.version !== 1 || !sameConversationScope(record.scope, scope)
      || !Number.isSafeInteger(record.generation) || record.generation < 0)) throw new Error('local-state-unreadable');
    if (record) {
      if (typeof record.dirty !== 'boolean' || (record.blocked !== null && record.blocked !== 'conflict')
        || (record.working !== null && !ports.validatePayload(scope, record.working))) throw new Error('local-state-unreadable');
      remote(record.confirmed, scope); remote(record.conflict, scope);
      const pending = record.pending;
      if (pending && (!sameConversationScope(pending.scope, scope) || !pending.operationId || pending.operationId.length > 128
        || !Number.isSafeInteger(pending.baseRevision) || pending.baseRevision < 0
        || (pending.payload !== null && !ports.validatePayload(scope, pending.payload)))) throw new Error('local-state-unreadable');
    }
    return record ?? initial(scope);
  }
  function remote(snapshot: ConversationSnapshot | null, scope: ConversationScope) {
    if (snapshot && (!sameConversationScope(snapshot.scope, scope)
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
      || !snapshot.operationId || snapshot.deleted !== (snapshot.payload === null)
      || (snapshot.payload !== null && !ports.validatePayload(scope, snapshot.payload)))) throw new Error('remote-state-unreadable');
  }
  function accept(record: ConversationLocalRecord, snapshot: ConversationSnapshot): ConversationLocalRecord {
    const pending = record.pending;
    if (!pending || pending.operationId !== snapshot.operationId
      || snapshot.revision !== pending.baseRevision + 1 || !samePayload(pending.payload, snapshot.payload)) {
      throw new Error('commit-receipt-mismatch');
    }
    return { ...record, generation: record.generation + 1, confirmed: snapshot,
      pending: null, dirty: !samePayload(record.working, pending.payload), blocked: null, conflict: null };
  }
  const status = (record: ConversationLocalRecord): ConversationSyncResult => ({
    status: record.blocked ? 'conflict' : record.dirty || record.pending ? 'pending' : 'synced', record,
  });

  async function stage(scope: ConversationScope, payload: ConversationPayload | null, expectedGeneration: number) {
    guard(scope);
    if (payload !== null && !ports.validatePayload(scope, payload)) throw new Error('invalid-conversation-payload');
    return ports.local.update(scope, existing => {
      const record = local(existing, scope);
      if (record.generation !== expectedGeneration) throw new Error('local-revision-conflict');
      if (record.confirmed?.deleted) throw new Error('conversation-deleted');
      if (samePayload(record.working, payload) && (record.confirmed || record.dirty)) return record;
      // Pending bytes are immutable even when the user continues editing during an upload.
      return { ...record, generation: record.generation + 1, working: payload,
        dirty: record.pending !== null || !samePayload(record.confirmed?.payload ?? null, payload) || !record.confirmed };
    });
  }

  async function refresh(scope: ConversationScope) {
    guard(scope);
    const snapshot = await ports.remote.read(scope);
    guard(scope); remote(snapshot, scope);
    return ports.local.update(scope, existing => {
      const record = local(existing, scope);
      if (!snapshot) {
        if (record.confirmed) throw new Error('remote-state-missing');
        return record;
      }
      if (record.pending?.operationId === snapshot.operationId) return accept(record, snapshot);
      const confirmed = record.confirmed;
      if (confirmed && snapshot.revision < confirmed.revision) throw new Error('remote-revision-regressed');
      if (confirmed && snapshot.revision === confirmed.revision) {
        if (snapshot.operationId !== confirmed.operationId || !samePayload(snapshot.payload, confirmed.payload)) throw new Error('remote-revision-mismatch');
        return record;
      }
      if (record.dirty || record.pending || record.blocked) return {
        ...record, generation: record.generation + 1, blocked: 'conflict', conflict: snapshot,
      };
      return { ...record, generation: record.generation + 1, confirmed: snapshot, working: snapshot.payload,
        dirty: false, pending: null, blocked: null, conflict: null };
    });
  }

  async function commitPending(scope: ConversationScope): Promise<ConversationSyncResult> {
    const record = await ports.local.update(scope, existing => {
      const value = local(existing, scope);
      if (value.blocked || value.pending || !value.dirty) return value;
      const operationId = ports.operationId();
      if (!operationId || operationId.length > 128) throw new Error('invalid-operation-id');
      return { ...value, pending: { scope, operationId, baseRevision: value.confirmed?.revision ?? 0, payload: value.working } };
    });
    guard(scope);
    if (record.blocked || !record.pending) return status(record);
    // Persist the immutable outbox before sending. A rejected/lost response leaves it recoverable.
    const outcome = await ports.remote.commit(record.pending);
    guard(scope); remote(outcome.snapshot, scope);
    const reconciled = await ports.local.update(scope, existing => {
      const latest = local(existing, scope);
      if (latest.pending?.operationId !== record.pending!.operationId) return latest;
      if (outcome.status === 'conflict') return {
        ...latest, generation: latest.generation + 1, blocked: 'conflict', conflict: outcome.snapshot,
      };
      return accept(latest, outcome.snapshot);
    });
    return status(reconciled);
  }

  function flush(scope: ConversationScope): Promise<ConversationSyncResult> {
    try { guard(scope); } catch (error) { return Promise.reject(error); }
    const key = conversationScopeKey(scope);
    const existing = inflight.get(key);
    if (existing) return existing;
    const request = commitPending(scope).finally(() => { if (inflight.get(key) === request) inflight.delete(key); });
    inflight.set(key, request);
    return request;
  }

  return { stage, refresh, flush };
}
