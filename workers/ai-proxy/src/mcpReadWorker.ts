import { ScheduleRangeReadError, type ReadScheduleRange } from '../../../src/features/mcp/readScheduleRange';
import { ScheduleEventPrepareError, type PrepareScheduleEvent } from '../../../src/features/mcp/prepareScheduleEvent';
import { ScheduleEventCommitError, type CommitScheduleEvent } from '../../../src/features/mcp/commitScheduleEvent';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const READ_SCOPE = 'schedule:read';
const PREPARE_SCOPE = 'schedule:prepare';
const COMMIT_SCOPE = 'schedule:commit';
export interface McpReadPrincipal { ownerId: string; scopes: readonly string[] }
export interface McpReadEnvironment { MCP_READ_ENABLED?: string; MCP_COMMIT_ENABLED?: string }
export interface McpReadDependencies {
  /** Must validate credentials; resolving a bearer string to itself is not authentication. */
  authenticate?: (request: Request) => Promise<McpReadPrincipal | null>;
  /** Composition must admit canonical authority before resolving an owner-bound read capability. */
  readScheduleRange?: ReadScheduleRange;
  /** Unsaved confirmation only; this capability cannot approve or persist an event. */
  prepareScheduleEvent?: PrepareScheduleEvent;
  /** Persists one event; only reachable with its own scope and MCP_COMMIT_ENABLED=true. */
  commitScheduleEvent?: CommitScheduleEvent;
  allowedOrigins?: readonly string[];
}

const READ_TOOL = { name: 'read_schedule_range', title: 'Read my schedule',
  description: 'Read the authenticated owner’s schedule for inclusive calendar dates in their calendar time zone.',
  inputSchema: { type: 'object', properties: { startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' }, timeZone: { type: 'string', description: 'The owner calendar IANA time zone.' } },
  required: ['startDate', 'endDate', 'timeZone'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
const POINT_SCHEMA = { type: 'object', properties: {
  date: { type: 'string', format: 'date' }, time: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
}, required: ['date', 'time'], additionalProperties: false };
const PREPARE_TOOL = { name: 'prepare_schedule_event', title: 'Preview one schedule event',
  description: 'Return an unsaved single general-event preview and overlapping events. Never approves or saves. Use explicit owner-local date/time endpoints; title and end time must be supplied, not guessed.',
  inputSchema: { type: 'object', properties: { title: { type: 'string', minLength: 1 },
    start: POINT_SCHEMA, end: POINT_SCHEMA, timeZone: { type: 'string', description: 'The owner calendar IANA time zone.' } },
  required: ['title', 'start', 'end', 'timeZone'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
const COMMIT_TOOL = { name: 'commit_schedule_event', title: 'Save one schedule event',
  description: 'Save one general event after the user has approved the prepared preview. Re-checks duplicates and overlaps against the owner’s current schedule. Reuse the same idempotencyKey to retry; never generate a new key for a retry.',
  inputSchema: { type: 'object', properties: { ...PREPARE_TOOL.inputSchema.properties,
    idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$', description: 'Stable per user request; resend with the same value.' },
    acceptOverlaps: { type: 'boolean', description: 'Only true when the user explicitly accepted the listed overlaps. Duplicates are never saved.' } },
  required: [...PREPARE_TOOL.inputSchema.required, 'idempotencyKey'], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
type RpcId = string | number;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const rpcError = (id: RpcId | null, code: number, message: string, status = 200) =>
  json({ jsonrpc: '2.0', id, error: { code, message } }, status);

/** Separate, unpublished Worker entry. Stateless JSON Streamable HTTP; no OAuth or persistence composition yet. */
export function createMcpReadWorker(dependencies: McpReadDependencies = {}) {
  return { async fetch(request: Request, environment: McpReadEnvironment): Promise<Response> {
    if (new URL(request.url).pathname !== '/mcp' || environment.MCP_READ_ENABLED !== 'true') {
      return new Response('Not found', { status: 404 });
    }
    const origin = request.headers.get('Origin');
    if (origin !== null && !dependencies.allowedOrigins?.includes(origin)) return new Response('Forbidden origin', { status: 403 });
    let principal: McpReadPrincipal | null;
    try { principal = await dependencies.authenticate?.(request) ?? null; }
    catch { return new Response('Authentication unavailable', { status: 503 }); }
    if (!principal?.ownerId.trim()) return new Response('Unauthorized', { status: 401,
      headers: { 'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store' } });
    if (!principal.scopes.includes(READ_SCOPE)) return new Response('Forbidden', { status: 403 });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return new Response('JSON required', { status: 415 });
    }
    const accept = (request.headers.get('Accept') ?? '').split(',').map(value => value.split(';')[0].trim().toLowerCase());
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return new Response('Not acceptable', { status: 406 });
    let message: unknown;
    try { message = await request.json(); }
    catch { return rpcError(null, -32700, 'Parse error', 400); }
    if (!record(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return rpcError(null, -32600, 'Invalid request', 400);
    }
    const version = request.headers.get('MCP-Protocol-Version') ?? '2025-03-26';
    if (message.method !== 'initialize' && !VERSIONS.includes(version)) return new Response('Unsupported protocol version', { status: 400 });
    if (!('id' in message)) {
      return new Response(null, { status: message.method === 'notifications/initialized' ? 202 : 400 });
    }
    if (typeof message.id !== 'string' && !(typeof message.id === 'number' && Number.isFinite(message.id))) {
      return rpcError(null, -32600, 'Invalid request', 400);
    }
    const id = message.id;
    const result = (value: unknown) => json({ jsonrpc: '2.0', id, result: value });
    if (message.method === 'initialize') {
      const params = message.params;
      if (!record(params) || typeof params.protocolVersion !== 'string' || !record(params.capabilities)
        || !record(params.clientInfo) || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
        return rpcError(id, -32602, 'Invalid initialization parameters');
      }
      return result({ protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} }, serverInfo: { name: 'laplance-schedule-read', version: '0.1.0' } });
    }
    if (message.method === 'ping') return result({});
    const commitEnabled = environment.MCP_COMMIT_ENABLED === 'true' && principal.scopes.includes(COMMIT_SCOPE);
    if (message.method === 'tools/list') return result({ tools: [READ_TOOL,
      ...(principal.scopes.includes(PREPARE_SCOPE) ? [PREPARE_TOOL] : []), ...(commitEnabled ? [COMMIT_TOOL] : [])] });
    if (message.method !== 'tools/call') return rpcError(id, -32601, 'Method not found');
    if (!record(message.params) || ![READ_TOOL.name, PREPARE_TOOL.name, COMMIT_TOOL.name].includes(message.params.name as string)) {
      return rpcError(id, -32602, 'Unknown tool');
    }
    const prepare = message.params.name === PREPARE_TOOL.name;
    const commit = message.params.name === COMMIT_TOOL.name;
    if (prepare && !principal.scopes.includes(PREPARE_SCOPE)) return rpcError(id, -32001, 'Forbidden', 403);
    if (commit && !principal.scopes.includes(COMMIT_SCOPE)) return rpcError(id, -32001, 'Forbidden', 403);
    if (commit && environment.MCP_COMMIT_ENABLED !== 'true') return rpcError(id, -32602, 'Unknown tool');
    try {
      const operation = commit ? dependencies.commitScheduleEvent : prepare ? dependencies.prepareScheduleEvent : dependencies.readScheduleRange;
      if (!operation) throw new Error('Unconfigured schedule capability');
      const data = await operation(principal.ownerId, message.params.arguments);
      return result({ structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] });
    } catch (error) {
      if (error instanceof ScheduleEventPrepareError) return rpcError(id, -32602, error.code);
      if (error instanceof ScheduleEventCommitError) {
        // An unknown outcome is not a failure the client may treat as "not saved" nor a success.
        if (error.code === 'save_outcome_unknown') return result({ isError: true, content: [{ type: 'text',
          text: 'Save outcome unknown. It is not confirmed saved; retry with the same idempotencyKey.' }] });
        return rpcError(id, -32602, error.code);
      }
      if (error instanceof ScheduleRangeReadError) {
        if (error.code === 'owner_mismatch') return rpcError(id, -32001, 'Forbidden', 403);
        if (error.code !== 'source_unavailable') return rpcError(id, -32602, error.code);
      }
      // A failed read is distinct from an empty calendar; never return repository error details or partial data.
      return result({ isError: true, content: [{ type: 'text', text: commit ? 'Schedule save unavailable. Not confirmed saved; retry with the same idempotencyKey.' : prepare ? 'Schedule preview unavailable.' : 'Schedule read unavailable.' }] });
    }
  } };
}

export default createMcpReadWorker();
