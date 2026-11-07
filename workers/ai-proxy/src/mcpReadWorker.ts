import { ScheduleRangeReadError, type ReadScheduleRange } from '../../../src/features/mcp/readScheduleRange';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const READ_SCOPE = 'schedule:read';
export interface McpReadPrincipal { ownerId: string; scopes: readonly string[] }
export interface McpReadEnvironment { MCP_READ_ENABLED?: string }
export interface McpReadDependencies {
  /** Must validate credentials; resolving a bearer string to itself is not authentication. */
  authenticate?: (request: Request) => Promise<McpReadPrincipal | null>;
  /** Composition must admit canonical authority before resolving an owner-bound read capability. */
  readScheduleRange?: ReadScheduleRange;
  allowedOrigins?: readonly string[];
}

const TOOL = { name: 'read_schedule_range', title: 'Read my schedule',
  description: 'Read the authenticated owner’s schedule for inclusive calendar dates in their calendar time zone.',
  inputSchema: { type: 'object', properties: { startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' }, timeZone: { type: 'string', description: 'The owner calendar IANA time zone.' } },
  required: ['startDate', 'endDate', 'timeZone'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
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
    if (message.method === 'tools/list') return result({ tools: [TOOL] });
    if (message.method !== 'tools/call') return rpcError(id, -32601, 'Method not found');
    if (!record(message.params) || message.params.name !== TOOL.name) return rpcError(id, -32602, 'Unknown tool');
    try {
      if (!dependencies.readScheduleRange) throw new Error('Unconfigured reader');
      const data = await dependencies.readScheduleRange(principal.ownerId, message.params.arguments);
      return result({ structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] });
    } catch (error) {
      if (error instanceof ScheduleRangeReadError) {
        if (error.code === 'owner_mismatch') return rpcError(id, -32001, 'Forbidden', 403);
        if (error.code !== 'source_unavailable') return rpcError(id, -32602, error.code);
      }
      // A failed read is distinct from an empty calendar; never return repository error details or partial data.
      return result({ isError: true, content: [{ type: 'text', text: 'Schedule read unavailable.' }] });
    }
  } };
}

export default createMcpReadWorker();
