import {
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_HEADERS,
  WEEKLY_PLANNING_TRACE_WORKER_REVISION,
} from '../../../shared/weeklyPlanningTraceContract';
import worker from './worker';
import { AiQuotaDurableObject } from './aiQuotaDurableObject';
import {
  handleProductObservabilityApi,
  isProductObservabilityPath,
  type ProductObservabilityApiEnv,
} from './productObservabilityApi';
import { handleWeeklyPlanningTraceAdminArchive } from './weeklyPlanningTraceAdminArchive';
import { handleWeeklyPlanningTraceAdminEntriesPage } from './weeklyPlanningTraceAdminEntriesPage';
import { isWeeklyPlanningTracePath } from './weeklyPlanningTraceApi';

export { AiQuotaDurableObject };

const ADMIN_ARCHIVE_PATH = '/weekly-planning-trace/admin/archive';
const ADMIN_ENTRIES_PATH = '/weekly-planning-trace/admin/entries';
const ADMIN_ENTRY_PAGE_PATH = '/weekly-planning-trace/admin/entries/page';

function traceHeaders(request: Request, env: Record<string, unknown>): Record<string, string> {
  const correlationId = request.headers.get(WEEKLY_PLANNING_TRACE_HEADERS.correlationId)?.trim();
  const configuredRevision = typeof env.WEEKLY_PLANNING_TRACE_WORKER_REVISION === 'string'
    ? env.WEEKLY_PLANNING_TRACE_WORKER_REVISION.trim()
    : '';
  return {
    [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]: WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
    [WEEKLY_PLANNING_TRACE_HEADERS.workerRevision]:
      configuredRevision || WEEKLY_PLANNING_TRACE_WORKER_REVISION,
    ...(correlationId ? { [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: correlationId } : {}),
    'Access-Control-Allow-Headers': [
      'Authorization',
      'Content-Type',
      WEEKLY_PLANNING_TRACE_HEADERS.contractVersion,
      WEEKLY_PLANNING_TRACE_HEADERS.correlationId,
    ].join(', '),
    'Access-Control-Expose-Headers': [
      WEEKLY_PLANNING_TRACE_HEADERS.contractVersion,
      WEEKLY_PLANNING_TRACE_HEADERS.workerRevision,
      WEEKLY_PLANNING_TRACE_HEADERS.correlationId,
      'X-StudyPlanner-Proxy-Version',
    ].join(', '),
  };
}

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (isProductObservabilityPath(pathname)) {
      return await handleProductObservabilityApi(
        request,
        env as unknown as ProductObservabilityApiEnv,
      );
    }

    const response = pathname === ADMIN_ENTRY_PAGE_PATH || pathname === ADMIN_ENTRIES_PATH
      ? await handleWeeklyPlanningTraceAdminEntriesPage(request, env)
      : pathname === ADMIN_ARCHIVE_PATH
        ? await handleWeeklyPlanningTraceAdminArchive(request, env)
        : await worker.fetch(request, env as never);
    if (!isWeeklyPlanningTracePath(pathname)) return response;

    const headers = new Headers(response.headers);
    Object.entries(traceHeaders(request, env)).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
