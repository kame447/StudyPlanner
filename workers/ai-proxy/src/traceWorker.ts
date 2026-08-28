import {
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_HEADERS,
  WEEKLY_PLANNING_TRACE_WORKER_REVISION,
} from '../../../shared/weeklyPlanningTraceContract';
import {
  isObservableAiProxyPath,
  observeAiProxyRequest,
  type AiProxyRequestObserverEnv,
} from './aiProxyRequestObserver';
import {
  isAiRequestObservabilityConfigured,
  scheduleAiRequestMetric,
} from './aiRequestObservability';
import worker from './worker';
import { AiQuotaDurableObject } from './aiQuotaDurableObject';
import {
  ProductObservabilityActiveUserSnapshotService,
  type ProductObservabilityActiveUserSnapshotEnv,
} from './productObservabilityActiveUserSnapshot';
import {
  handleProductObservabilityAdminApi,
  isProductObservabilityAdminPath,
} from './productObservabilityAdminApi';
import {
  handleProductObservabilityApi,
  isProductObservabilityPath,
  type ProductObservabilityApiEnv,
} from './productObservabilityApi';
import {
  ProductObservabilityRetentionService,
  type ProductObservabilityRetentionEnv,
} from './productObservabilityRetention';
import {
  ProductObservabilityRollupEngine,
  type ProductObservabilityRollupEnv,
} from './productObservabilityRollup';
import { handleWeeklyPlanningTraceAdminArchive } from './weeklyPlanningTraceAdminArchive';
import { handleWeeklyPlanningTraceAdminEntriesPage } from './weeklyPlanningTraceAdminEntriesPage';
import { isWeeklyPlanningTracePath } from './weeklyPlanningTraceApi';

export { AiQuotaDurableObject };

const ADMIN_ARCHIVE_PATH = '/weekly-planning-trace/admin/archive';
const ADMIN_ENTRIES_PATH = '/weekly-planning-trace/admin/entries';
const ADMIN_ENTRY_PAGE_PATH = '/weekly-planning-trace/admin/entries/page';
const MAX_ROLLUP_BATCHES_PER_SCHEDULE = 10;
const ROLLUP_BATCH_SIZE = 50;
const MAX_RETENTION_BATCHES_PER_SCHEDULE = 2;
const RETENTION_BATCH_SIZE = 100;

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

async function runScheduledObservabilityRollup(env: Record<string, unknown>): Promise<string[]> {
  const engine = new ProductObservabilityRollupEngine(
    env as unknown as ProductObservabilityRollupEnv,
  );
  const changedActorDates = new Set<string>();
  for (let index = 0; index < MAX_ROLLUP_BATCHES_PER_SCHEDULE; index += 1) {
    const result = await engine.runBatch(ROLLUP_BATCH_SIZE);
    result.changedActorDates.forEach((localDate) => changedActorDates.add(localDate));
    if (!result.hasMore) break;
  }
  return [...changedActorDates].sort();
}

async function runScheduledActiveUserSnapshots(
  env: Record<string, unknown>,
  changedActorDates: readonly string[],
): Promise<void> {
  const snapshots = new ProductObservabilityActiveUserSnapshotService(
    env as unknown as ProductObservabilityActiveUserSnapshotEnv,
  );
  await snapshots.refreshAffected(changedActorDates);
}

async function runScheduledObservabilityRetention(env: Record<string, unknown>): Promise<void> {
  const retention = new ProductObservabilityRetentionService(
    env as unknown as ProductObservabilityRetentionEnv,
  );
  for (let index = 0; index < MAX_RETENTION_BATCHES_PER_SCHEDULE; index += 1) {
    const result = await retention.runBatch(RETENTION_BATCH_SIZE);
    if (!result.hasMore) return;
  }
}

async function runScheduledObservabilityMaintenance(env: Record<string, unknown>): Promise<void> {
  let changedActorDates: string[] | null = null;
  try {
    changedActorDates = await runScheduledObservabilityRollup(env);
  } catch (error) {
    console.error('[Product Observability] scheduled rollup failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (changedActorDates) {
    try {
      await runScheduledActiveUserSnapshots(env, changedActorDates);
    } catch (error) {
      console.error('[Product Observability] active-user snapshot refresh failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await runScheduledObservabilityRetention(env);
}

export default {
  async fetch(
    request: Request,
    env: Record<string, unknown>,
    executionContext?: ExecutionContext,
  ): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (isProductObservabilityAdminPath(pathname)) {
      return await handleProductObservabilityAdminApi(request, env);
    }
    if (isProductObservabilityPath(pathname)) {
      return await handleProductObservabilityApi(
        request,
        env as unknown as ProductObservabilityApiEnv,
      );
    }

    const observerEnv = env as unknown as AiProxyRequestObserverEnv;
    const shouldObserveAiRequest = request.method === 'POST'
      && isObservableAiProxyPath(pathname)
      && isAiRequestObservabilityConfigured(observerEnv);
    const observerRequest = shouldObserveAiRequest ? request.clone() : null;
    const startedAtMs = shouldObserveAiRequest ? Date.now() : 0;
    const occurredAt = shouldObserveAiRequest ? new Date(startedAtMs).toISOString() : '';

    const response = pathname === ADMIN_ENTRY_PAGE_PATH || pathname === ADMIN_ENTRIES_PATH
      ? await handleWeeklyPlanningTraceAdminEntriesPage(request, env)
      : pathname === ADMIN_ARCHIVE_PATH
        ? await handleWeeklyPlanningTraceAdminArchive(request, env)
        : await worker.fetch(request, env as never);

    if (observerRequest) {
      scheduleAiRequestMetric(
        executionContext,
        observeAiProxyRequest({
          request: observerRequest,
          response: response.clone(),
          env: observerEnv,
          startedAtMs,
          occurredAt,
          onError: (error) => console.warn('[AI Proxy] observability metric write failed', {
            message: error instanceof Error ? error.message : String(error),
          }),
        }),
      );
    }

    if (!isWeeklyPlanningTracePath(pathname)) return response;

    const headers = new Headers(response.headers);
    Object.entries(traceHeaders(request, env)).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
  async scheduled(
    _controller: unknown,
    env: Record<string, unknown>,
    executionContext: ExecutionContext,
  ): Promise<void> {
    executionContext.waitUntil(
      runScheduledObservabilityMaintenance(env).catch((error) => {
        console.error('[Product Observability] scheduled retention failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }),
    );
  },
};
