import { DurableObject } from 'cloudflare:workers';
import { ScheduleEventCommitError, type CommitScheduleEvent, type ScheduleEventCommitErrorCode } from '../../../src/features/mcp/commitScheduleEvent';
import { ScheduleEventPrepareError } from '../../../src/features/mcp/prepareScheduleEvent';
import { ScheduleRangeReadError } from '../../../src/features/mcp/readScheduleRange';

/**
 * One Durable Object per owner runs that owner's commits, so the in-isolate per-owner queue of
 * `createScheduleEventCommitter` becomes the only writer for the owner across all isolates.
 * The gate adds no rules of its own: it delegates to the existing committer unchanged.
 * Authority composition (credentials) is injected and is intentionally not implemented here.
 */
export type ComposeOwnerCommitter<Env> = (environment: Env, ownerId: string) => CommitScheduleEvent;

type GateReply =
  | { ok: true; result: Awaited<ReturnType<CommitScheduleEvent>> }
  | { ok: false; kind: 'commit'; code: ScheduleEventCommitErrorCode; detail?: string }
  | { ok: false; kind: 'prepare' | 'range'; code: string };

const PATH = '/commit';
const messageDetail = (error: ScheduleEventCommitError) => error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : undefined;

export function createMcpOwnerCommitGateClass<Env>(compose: ComposeOwnerCommitter<Env>) {
  return class McpOwnerCommitGate extends DurableObject<Env> {
    private committer?: { ownerId: string; commit: CommitScheduleEvent };
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'POST' || new URL(request.url).pathname !== PATH) return new Response('Not found', { status: 404 });
      let body: { ownerId?: unknown; input?: unknown };
      try { body = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
      if (typeof body.ownerId !== 'string' || !body.ownerId.trim()) return new Response('Bad request', { status: 400 });
      const ownerId = body.ownerId;
      const reply = (value: GateReply) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
      try {
        // An object serves one owner only; a mismatch is refused before any read or write.
        if (this.committer && this.committer.ownerId !== ownerId) throw new ScheduleRangeReadError('owner_mismatch');
        this.committer ??= { ownerId, commit: compose(this.env, ownerId) };
        return reply({ ok: true, result: await this.committer.commit(ownerId, body.input) });
      } catch (error) {
        if (error instanceof ScheduleEventCommitError) return reply({ ok: false, kind: 'commit', code: error.code, detail: messageDetail(error) });
        if (error instanceof ScheduleEventPrepareError) return reply({ ok: false, kind: 'prepare', code: error.code });
        if (error instanceof ScheduleRangeReadError) return reply({ ok: false, kind: 'range', code: error.code });
        // Unexpected failures carry no detail across the boundary; the caller treats them as "not confirmed saved".
        return new Response('Gate failure', { status: 500 });
      }
    }
  };
}

export interface McpOwnerCommitGateNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

/** Worker-side `CommitScheduleEvent`: forwards to the owner's gate and rethrows the committer's typed errors. */
export function createGatedCommit(namespace: McpOwnerCommitGateNamespace): CommitScheduleEvent {
  return async (actorOwnerId, input) => {
    if (!actorOwnerId) throw new ScheduleRangeReadError('owner_mismatch');
    // Any transport or gate failure rejects with a plain error: the Worker reports "not confirmed saved", never "saved".
    const response = await namespace.get(namespace.idFromName(actorOwnerId)).fetch(new Request(`https://mcp-owner-commit-gate${PATH}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId: actorOwnerId, input }) }));
    if (!response.ok) throw new Error(`commit gate unavailable (${response.status})`);
    const reply = await response.json() as GateReply;
    if (reply.ok) return reply.result;
    if (reply.kind === 'commit') throw new ScheduleEventCommitError(reply.code, reply.detail);
    if (reply.kind === 'prepare') throw new ScheduleEventPrepareError(reply.code as 'invalid_event' | 'out_of_range');
    throw new ScheduleRangeReadError(reply.code as ConstructorParameters<typeof ScheduleRangeReadError>[0]);
  };
}
