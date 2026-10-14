import { requireFirebaseSession, enforceDurableTurnAdmission, type AiProxyWorkerEnv } from '../worker';
import { DURABLE_TURN_LIMITS } from './durableTurnJob';
import { decodeDurableTurnInput } from './durableTurnInput';
import type { WeeklyPlanningTurnDurableObject } from './weeklyPlanningTurnDurableObject';

export interface DurableTurnApiEnv extends AiProxyWorkerEnv {
  AI_TURNS?: DurableObjectNamespace<WeeklyPlanningTurnDurableObject>;
  DURABLE_WEEKLY_TURNS?: string;
}
export const isDurableTurnPath = (path: string) => path === '/weekly-planning/turns';

export async function handleDurableTurnApi(request: Request, env: DurableTurnApiEnv): Promise<Response> {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGIN ?? '').split(',').map((item) => item.trim());
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin && allowed.includes(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' });
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !allowed.includes(origin)) return respond(403, { error: 'Origin is not allowed.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return respond(405, { error: 'Method not allowed.' });
  const session = await requireFirebaseSession(request, env);
  if (session instanceof Response) return session;
  // Stop new acceptance without stranding authenticated recovery/cancellation.
  // Already accepted alarms keep running; this flag is not a provider kill switch.
  if (!env.AI_TURNS || (request.method === 'POST' && env.DURABLE_WEEKLY_TURNS !== 'enabled')) {
    return respond(503, { error: 'durable_turns_unavailable' });
  }
  try {
    if (request.method === 'DELETE') {
      const query = new URL(request.url).searchParams;
      const conversationId = query.get('conversationId'); const requestId = query.get('requestId');
      const baseRevision = Number(query.get('baseRevision')); const startedAt = Number(query.get('startedAt'));
      if (!conversationId || conversationId.length > 256 || !requestId || requestId.length > 256
        || !query.has('baseRevision') || !query.has('startedAt') || !Number.isSafeInteger(baseRevision) || baseRevision < 0
        || !Number.isSafeInteger(startedAt)) return respond(400, { error: 'invalid_input' });
      const quota = await enforceDurableTurnAdmission(request, env, session.uid); if (quota) return quota;
      const result = await env.AI_TURNS.getByName(JSON.stringify([session.uid, conversationId]))
        .cancel({ ownerId: session.uid, conversationId, requestId, baseRevision, startedAt });
      return result ? respond(200, result) : respond(404, { error: 'turn_not_found' });
    }
    if (request.method === 'POST') {
      const declared = Number(request.headers.get('Content-Length'));
      if (declared > DURABLE_TURN_LIMITS.inputBytes) return respond(413, { error: 'input_too_large' });
      const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (!reader) return respond(400, { error: 'invalid_input' });
      while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > DURABLE_TURN_LIMITS.inputBytes) { await reader.cancel(); return respond(413, { error: 'input_too_large' }); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let decoded: unknown; try { decoded = JSON.parse(new TextDecoder().decode(bytes)); } catch { return respond(400, { error: 'invalid_input' }); }
      const input = decodeDurableTurnInput(decoded, session.uid);
      if (!input) return respond(400, { error: 'invalid_input' });
      input.sourceIp = request.headers.get('CF-Connecting-IP')?.trim()
        || request.headers.get('True-Client-IP')?.trim()
        || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
      // Bound new acceptance/storage load with independent spam counters. GET never consumes quota.
      const quota = await enforceDurableTurnAdmission(request, env, session.uid); if (quota) return quota;
      const stub = env.AI_TURNS.getByName(JSON.stringify([session.uid, input.conversationId]));
      const accepted = await stub.accept(input);
      return accepted.accepted ? respond(202, accepted.value) : respond(409, { error: accepted.error });
    }
    const query = new URL(request.url).searchParams;
    const conversationId = query.get('conversationId'); const requestId = query.get('requestId');
    if (!conversationId || conversationId.length > 256 || !requestId || requestId.length > 256) return respond(400, { error: 'invalid_input' });
    const stub = env.AI_TURNS.getByName(JSON.stringify([session.uid, conversationId]));
    const result = await stub.status({ ownerId: session.uid, conversationId, requestId });
    return result ? respond(200, result) : respond(404, { error: 'turn_not_found' });
  } catch {
    return respond(500, { error: 'turn_storage_unavailable' });
  }
}
