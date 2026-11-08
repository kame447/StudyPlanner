import { createMcpReadWorker, type McpReadEnvironment } from './mcpReadWorker';
import { createGatedCommit, createMcpOwnerCommitGateClass, type McpOwnerCommitGateNamespace } from './mcpOwnerCommitGate';

/**
 * Separate MCP-only entry (wrangler.mcp.jsonc). It is not the production entry (traceWorker.ts) and is never deployed
 * by the existing scripts. Authentication and the authority composition (service-account credentials) are owner
 * decisions and are deliberately absent: without `authenticate` every request is 401, and the gate refuses to compose.
 */
interface McpWorkerEnvironment extends McpReadEnvironment { MCP_OWNER_COMMIT_GATE?: McpOwnerCommitGateNamespace }

export class McpOwnerCommitGate extends createMcpOwnerCommitGateClass<McpWorkerEnvironment>(() => {
  throw new Error('Authority composition is not configured');
}) {}

export default {
  fetch(request: Request, environment: McpWorkerEnvironment) {
    const gate = environment.MCP_OWNER_COMMIT_GATE;
    return createMcpReadWorker({ commitScheduleEvent: gate ? createGatedCommit(gate) : undefined }).fetch(request, environment);
  },
};
