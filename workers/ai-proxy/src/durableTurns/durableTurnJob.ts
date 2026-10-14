/** Durable execution only. Semantic decisions and final plan saving belong to their existing owners. */
export const DURABLE_TURN_LIMITS = {
  inputBytes: 1024 * 1024,
  outputBytes: 1536 * 1024,
  responseBytes: 256 * 1024,
  journalBytes: 2 * 1024 * 1024,
  dispatches: 12,
  acceptanceAgeMs: 5 * 60_000,
  executionMs: 14 * 60_000,
  retentionMs: 24 * 60 * 60_000,
} as const;

export interface DurableTurnIdentity {
  ownerId: string;
  conversationId: string;
  requestId: string;
  baseRevision: number;
  startedAt: number;
}

export interface DurableTurnInput extends DurableTurnIdentity {
  /** Immutable, validated full-turn context, never credentials or browser functions. */
  payload: string;
  /** Server-derived quota scope, never trusted from the public payload. */
  sourceIp?: string;
}

type DispatchEntry = { fingerprint: string; status: 'started' }
  | { fingerprint: string; status: 'completed'; response: string };

export type DurableTurnFailure = 'execution_expired' | 'provider_completion_unknown'
  | 'provider_failure' | 'execution_failed' | 'execution_changed' | 'dispatch_limit'
  | 'result_too_large' | 'cancelled';

export interface DurableTurnRecord {
  identity: DurableTurnIdentity;
  fingerprint: string;
  acceptedAt: number;
  expiresAt: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'expired';
  payload?: string;
  sourceIp?: string;
  journal?: DispatchEntry[];
  result?: string;
  failure?: DurableTurnFailure;
}

export interface DurableTurnStorage {
  read(): Promise<DurableTurnRecord | undefined>;
  /** A complete snapshot is committed atomically. A thrown write may already have committed. */
  write(record: DurableTurnRecord, alarmAt?: number): Promise<void>;
  alarmAt(timestamp: number): Promise<void>;
}

export interface DurableTurnResult {
  identity: DurableTurnIdentity;
  status: DurableTurnRecord['status'];
  expiresAt: number;
  result?: string;
  failure?: DurableTurnFailure;
}

export class DurableTurnConflict extends Error {
  constructor(readonly code: 'owner_mismatch' | 'request_conflict' | 'revision_conflict'
    | 'turn_in_progress' | 'invalid_input' | 'expired_request') {
    super(code); this.name = 'DurableTurnConflict';
  }
}

class StorageFailure extends Error {
  constructor(readonly cause: unknown) { super('Durable turn storage operation failed.'); }
}

class ExecutionStop extends Error {
  constructor(readonly code: DurableTurnFailure) { super(code); }
}

export type DurableTurnExecute = (payload: string, dispatch: (
  request: string, send: () => Promise<string>,
) => Promise<string>, sourceIp?: string, deadlineAt?: number) => Promise<string>;

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
async function fingerprint(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function publicResult(record: DurableTurnRecord): DurableTurnResult {
  return { identity: { ...record.identity }, status: record.status, expiresAt: record.expiresAt,
    ...(record.status === 'completed' ? { result: record.result } : {}),
    ...(record.failure ? { failure: record.failure } : {}) };
}
function sameScope(a: DurableTurnIdentity, b: Pick<DurableTurnIdentity, 'ownerId' | 'conversationId'>) {
  return a.ownerId === b.ownerId && a.conversationId === b.conversationId;
}

function expiredRecord(record: DurableTurnRecord): DurableTurnRecord {
  const { payload: _payload, sourceIp: _sourceIp, journal: _journal, result: _result, failure: _failure, ...guard } = record;
  return { ...guard, status: 'expired' };
}

/** One instance per Durable Object. Its short mutation lock never covers network/provider work. */
export class DurableTurnJob {
  private mutation: Promise<unknown> = Promise.resolve();
  private executing: Promise<void> | undefined;
  private readonly storage: DurableTurnStorage;
  constructor(storage: DurableTurnStorage, private readonly now = Date.now) {
    const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
      try { return await work(); } catch (error) { throw new StorageFailure(error); }
    };
    this.storage = {
      read: () => guarded(() => storage.read()),
      write: (record, alarmAt) => guarded(() => storage.write(record, alarmAt)),
      alarmAt: (timestamp) => guarded(() => storage.alarmAt(timestamp)),
    };
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(work, work);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  accept(input: DurableTurnInput): Promise<DurableTurnResult> {
    return this.serialized(async () => {
      if (![input.ownerId, input.conversationId, input.requestId].every((id) =>
        typeof id === 'string' && id.length > 0 && id.length <= 256)
        || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0
        || !Number.isSafeInteger(input.startedAt) || typeof input.payload !== 'string'
        || bytes(input.payload) > DURABLE_TURN_LIMITS.inputBytes) throw new DurableTurnConflict('invalid_input');
      const { sourceIp: _sourceIp, ...acceptedInput } = input;
      const digest = await fingerprint(JSON.stringify(acceptedInput));
      let current = await this.storage.read();
      if (current && current.expiresAt <= this.now() && current.status !== 'expired') {
        current = expiredRecord(current);
        await this.storage.write(current);
      }
      if (current && !sameScope(current.identity, input)) throw new DurableTurnConflict('owner_mismatch');
      if (current?.identity.requestId === input.requestId) {
        if (current.fingerprint !== digest) throw new DurableTurnConflict('request_conflict');
        // Lost acceptance responses and repeated requests reuse the same job, including failures.
        if (current.status === 'queued') await this.storage.alarmAt(this.now());
        return publicResult(current);
      }
      if (input.startedAt > this.now() + 30_000
        || input.startedAt < this.now() - DURABLE_TURN_LIMITS.acceptanceAgeMs) throw new DurableTurnConflict('expired_request');
      if (current?.status === 'queued' || current?.status === 'running') throw new DurableTurnConflict('turn_in_progress');
      if (current && input.baseRevision < current.identity.baseRevision + 2) throw new DurableTurnConflict('revision_conflict');
      const record: DurableTurnRecord = {
        identity: { ownerId: input.ownerId, conversationId: input.conversationId,
          requestId: input.requestId, baseRevision: input.baseRevision, startedAt: input.startedAt },
        fingerprint: digest, acceptedAt: this.now(), expiresAt: this.now() + DURABLE_TURN_LIMITS.retentionMs,
        status: 'queued', payload: input.payload, journal: [], sourceIp: input.sourceIp,
      };
      // Acceptance and its wake are one atomic commit: no accepted but unscheduled job.
      await this.storage.write(record, this.now());
      return publicResult(record);
    });
  }

  cancel(identity: DurableTurnIdentity): Promise<DurableTurnResult | null> {
    return this.serialized(async () => {
      if (![identity.ownerId, identity.conversationId, identity.requestId].every((value) => typeof value === 'string' && value.length > 0 && value.length <= 256)
        || !Number.isSafeInteger(identity.baseRevision) || identity.baseRevision < 0 || !Number.isSafeInteger(identity.startedAt)) return null;
      const current = await this.storage.read();
      if (current && !sameScope(current.identity, identity)) return null;
      if (current?.identity.requestId === identity.requestId) {
        if (current.identity.baseRevision !== identity.baseRevision || current.identity.startedAt !== identity.startedAt) return null;
        if (!['queued', 'running'].includes(current.status)) return publicResult(current);
        const cancelled: DurableTurnRecord = { ...current, status: 'failed', failure: 'cancelled',
          payload: undefined, journal: undefined, sourceIp: undefined };
        await this.storage.write(cancelled, current.expiresAt);
        return publicResult(cancelled);
      }
      if (current && (['queued', 'running'].includes(current.status)
        || identity.baseRevision < current.identity.baseRevision + 2)) return null;
      if (identity.startedAt < this.now() - DURABLE_TURN_LIMITS.acceptanceAgeMs
        || identity.startedAt > this.now() + 30_000) return null;
      // Cancellation may beat an in-flight POST. Fence that exact identity before
      // acceptance so a delayed request cannot revive cancelled paid work.
      const cancelled: DurableTurnRecord = { identity: { ownerId: identity.ownerId, conversationId: identity.conversationId,
        requestId: identity.requestId, baseRevision: identity.baseRevision, startedAt: identity.startedAt }, fingerprint: 'cancelled-before-acceptance',
        acceptedAt: this.now(), expiresAt: this.now() + DURABLE_TURN_LIMITS.retentionMs,
        status: 'failed', failure: 'cancelled' };
      await this.storage.write(cancelled, cancelled.expiresAt);
      return publicResult(cancelled);
    });
  }

  async status(scope: Pick<DurableTurnIdentity, 'ownerId' | 'conversationId' | 'requestId'>): Promise<DurableTurnResult | null> {
    const record = await this.storage.read();
    if (!record || !sameScope(record.identity, scope) || record.identity.requestId !== scope.requestId) return null;
    if (record.expiresAt <= this.now() && record.status !== 'expired') {
      await this.expire(record.identity.requestId);
      return this.status(scope);
    }
    return publicResult(record);
  }

  private expire(requestId: string): Promise<void> {
    return this.serialized(async () => {
      const record = await this.storage.read();
      if (!record || record.identity.requestId !== requestId || record.expiresAt > this.now()) return;
      // No raw input, provider output, or generated result survives retention. The single compact
      // watermark fences old revisions/IDs; it is not an indefinitely growing request ledger.
      await this.storage.write(expiredRecord(record));
    });
  }

  run(execute: DurableTurnExecute): Promise<void> {
    if (this.executing) return this.executing;
    const work = this.execute(execute).finally(async () => {
      if (this.executing === work) this.executing = undefined;
      // An explicitly cancelled call can finish after a newer turn was accepted.
      await this.serialized(async () => {
        const latest = await this.storage.read();
        if (latest?.status === 'queued') await this.storage.alarmAt(this.now());
      });
    });
    this.executing = work;
    return work;
  }

  private async execute(execute: DurableTurnExecute): Promise<void> {
    const record = await this.serialized(async () => {
      const current = await this.storage.read();
      if (!current) return null;
      if (current.expiresAt <= this.now()) {
        await this.storage.write(expiredRecord(current)); return null;
      }
      if (current.status === 'completed' || current.status === 'failed' || current.status === 'expired') {
        if (current.status !== 'expired') await this.storage.alarmAt(current.expiresAt);
        return null;
      }
      const running: DurableTurnRecord = { ...current, status: 'running' };
      // Claim and watchdog are atomic, serialized with cancellation and acceptance.
      await this.storage.write(running, Math.min(current.acceptedAt + DURABLE_TURN_LIMITS.executionMs, current.expiresAt));
      return running;
    });
    if (!record) return;
    const ownsExecution = (latest: DurableTurnRecord) => sameScope(latest.identity, record.identity)
      && latest.identity.requestId === record.identity.requestId
      && latest.identity.baseRevision === record.identity.baseRevision
      && latest.identity.startedAt === record.identity.startedAt && latest.fingerprint === record.fingerprint;
    let step = 0;
    let stopped: DurableTurnFailure | undefined;
    const stillCurrent = async () => {
      const latest = await this.storage.read();
      if (!latest || !ownsExecution(latest) || latest.status !== 'running') throw new ExecutionStop('execution_changed');
      if (this.now() >= latest.acceptedAt + DURABLE_TURN_LIMITS.executionMs) throw new ExecutionStop('execution_expired');
      return latest;
    };
    try {
      const result = await execute(record.payload!, async (request, send) => {
        if (stopped) throw new ExecutionStop(stopped);
        const index = step++;
        let digest = '';
        const savedResponse = await this.serialized(async () => {
          digest = await fingerprint(request);
          const latest = await stillCurrent();
          const journal = [...(latest.journal ?? [])];
          const saved = journal[index];
          if (saved) {
            if (saved.fingerprint !== digest) throw new ExecutionStop(stopped = 'execution_changed');
            if (saved.status !== 'completed') throw new ExecutionStop(stopped = 'provider_completion_unknown');
            return { response: saved.response };
          }
          if (index >= DURABLE_TURN_LIMITS.dispatches) throw new ExecutionStop(stopped = 'dispatch_limit');
          journal[index] = { fingerprint: digest, status: 'started' };
          // Serialize only short state mutations; provider requests never hold this lock.
          await this.storage.write({ ...latest, journal });
          return null;
        });
        if (savedResponse) return savedResponse.response;
        let response: string;
        try { response = await send(); }
        catch { throw new ExecutionStop(stopped = 'provider_failure'); }
        if (bytes(response) > DURABLE_TURN_LIMITS.responseBytes) throw new ExecutionStop(stopped = 'result_too_large');
        await this.serialized(async () => {
          const latest = await stillCurrent();
          const journal = [...(latest.journal ?? [])];
          journal[index] = { fingerprint: digest, status: 'completed', response };
          if (bytes(JSON.stringify(journal)) > DURABLE_TURN_LIMITS.journalBytes) throw new ExecutionStop(stopped = 'result_too_large');
          await this.storage.write({ ...latest, journal });
        });
        return response;
      }, record.sourceIp, record.acceptedAt + DURABLE_TURN_LIMITS.executionMs);
      if (stopped) throw new ExecutionStop(stopped);
      await this.serialized(async () => {
        const latest = await stillCurrent();
        if (step !== latest.journal?.length) throw new ExecutionStop('execution_changed');
        if (bytes(result) > DURABLE_TURN_LIMITS.outputBytes) throw new ExecutionStop('result_too_large');
        // Output and status are atomic and cannot overwrite cancellation or a newer turn.
        await this.storage.write({ ...latest, status: 'completed', result, payload: undefined, journal: undefined }, latest.expiresAt);
      });
    } catch (error) {
      // Unknown storage errors deliberately escape. An alarm retry reads the actual committed state;
      // a guessed failure must never overwrite a result from a commit-then-throw storage write.
      if (error instanceof StorageFailure) throw error;
      const failure = error instanceof ExecutionStop ? error.code : 'execution_failed';
      await this.serialized(async () => {
        const latest = await this.storage.read();
        if (!latest || !ownsExecution(latest) || latest.status !== 'running') return;
        await this.storage.write({ ...latest, status: 'failed', failure, payload: undefined, journal: undefined }, latest.expiresAt);
      });
    }
  }
}
