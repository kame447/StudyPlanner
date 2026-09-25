import type { ObservabilityActiveUserDirtySource } from '../../../shared/productObservabilityReadModel';
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
import { AiQuotaDurableObject } from './aiQuotaDurableObject';
import {
  handleMaterialMetadataApi,
  isMaterialMetadataPath,
  type MaterialMetadataApiEnv,
} from './materialMetadataApi';
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
  ProductObservabilityProfileRegistrationBackfillService,
  type ProductObservabilityProfileRegistrationBackfillEnv,
} from './productObservabilityProfileRegistrationBackfill';
import {
  ProductObservabilityRetentionService,
  type ProductObservabilityRetentionEnv,
} from './productObservabilityRetention';
import {
  ProductObservabilityRollupEngine,
  type ProductObservabilityRollupEnv,
} from './productObservabilityRollup';
import {
  FirestoreServiceAccountClient,
  FirestoreServiceAccountTokenProvider,
  type FirestoreServiceAccountEnv,
  type FirestoreTokenProvider,
} from './firestoreServiceAccountClient';
import { isWeeklyPlanningTracePath } from './weeklyPlanningTraceApi';
import { WorkerSubrequestBudget } from './workerSubrequestBudget';
import worker from './worker';

export { AiQuotaDurableObject };

const MAX_ROLLUP_BATCHES_PER_SCHEDULE = 10;
const ROLLUP_BATCH_SIZE = 50;
const MAX_PROFILE_REGISTRATION_BACKFILL_BATCHES_PER_SCHEDULE = 2;
const PROFILE_REGISTRATION_BACKFILL_BATCH_SIZE = 100;
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

async function runScheduledObservabilityRollup(
  env: Record<string, unknown>,
  firestore: FirestoreServiceAccountClient,
): Promise<{
  engine: ProductObservabilityRollupEngine;
  dirtySources: ObservabilityActiveUserDirtySource[];
}> {
  const engine = new ProductObservabilityRollupEngine(
    env as unknown as ProductObservabilityRollupEnv,
    firestore,
  );
  let dirtySources: ObservabilityActiveUserDirtySource[] = [];
  for (let index = 0; index < MAX_ROLLUP_BATCHES_PER_SCHEDULE; index += 1) {
    const result = await engine.runBatch(ROLLUP_BATCH_SIZE);
    dirtySources = result.checkpoint.activeUserDirtySources;
    if (!result.hasMore) break;
  }
  return { engine, dirtySources };
}

async function runScheduledActiveUserSnapshots(
  env: Record<string, unknown>,
  dirtySources: readonly ObservabilityActiveUserDirtySource[],
  firestore: FirestoreServiceAccountClient,
): Promise<void> {
  const snapshots = new ProductObservabilityActiveUserSnapshotService(
    env as unknown as ProductObservabilityActiveUserSnapshotEnv,
    firestore,
  );
  await snapshots.refreshAffected(dirtySources);
}

async function runScheduledProfileRegistrationBackfill(
  env: Record<string, unknown>,
  firestore: FirestoreServiceAccountClient,
): Promise<void> {
  const backfill = new ProductObservabilityProfileRegistrationBackfillService(
    env as unknown as ProductObservabilityProfileRegistrationBackfillEnv,
    firestore,
  );
  for (
    let index = 0;
    index < MAX_PROFILE_REGISTRATION_BACKFILL_BATCHES_PER_SCHEDULE;
    index += 1
  ) {
    const checkpoint = await backfill.runBatch(PROFILE_REGISTRATION_BACKFILL_BATCH_SIZE);
    if (checkpoint.completed) return;
  }
}

async function runScheduledObservabilityRetention(
  env: Record<string, unknown>,
  firestore: FirestoreServiceAccountClient,
): Promise<void> {
  const retention = new ProductObservabilityRetentionService(
    env as unknown as ProductObservabilityRetentionEnv,
    firestore,
  );
  for (let index = 0; index < MAX_RETENTION_BATCHES_PER_SCHEDULE; index += 1) {
    const result = await retention.runBatch(RETENTION_BATCH_SIZE);
    if (!result.hasMore) return;
  }
}

async function runScheduledObservabilityMaintenance(
  env: Record<string, unknown>,
  tokenProvider: FirestoreTokenProvider,
): Promise<void> {
  const firestore = new FirestoreServiceAccountClient(
    env as unknown as FirestoreServiceAccountEnv,
    tokenProvider,
  );
  let rollup: Awaited<ReturnType<typeof runScheduledObservabilityRollup>> | null = null;
  try {
    rollup = await runScheduledObservabilityRollup(env, firestore);
  } catch (error) {
    console.error('[Product Observability] scheduled rollup failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (rollup) {
    try {
      await runScheduledActiveUserSnapshots(env, rollup.dirtySources, firestore);
      await rollup.engine.clearActiveUserDirtySources(rollup.dirtySources);
    } catch (error) {
      console.error('[Product Observability] active-user snapshot refresh failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await runScheduledProfileRegistrationBackfill(env, firestore);
  } catch (error) {
    console.error('[Product Observability] profile registration backfill failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await runScheduledObservabilityRetention(env, firestore);
}

export default {
  async fetch(
    request: Request,
    env: Record<string, unknown>,
    executionContext?: ExecutionContext,
  ): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const adminBudget = isProductObservabilityAdminPath(pathname)
      ? new WorkerSubrequestBudget('fetch', pathname)
      : null;
    const tokenProvider = new FirestoreServiceAccountTokenProvider(
      env as unknown as FirestoreServiceAccountEnv,
      undefined,
      undefined,
      adminBudget ?? undefined,
    );
    if (isProductObservabilityAdminPath(pathname)) {
      try {
        return await handleProductObservabilityAdminApi(request, env, tokenProvider);
      } finally {
        adminBudget?.logCompletion();
      }
    }
    if (isProductObservabilityPath(pathname)) {
      return await handleProductObservabilityApi(
        request,
        env as unknown as ProductObservabilityApiEnv,
        tokenProvider,
      );
    }
    if (isMaterialMetadataPath(pathname)) {
      return await handleMaterialMetadataApi(
        request,
        env as unknown as MaterialMetadataApiEnv,
        tokenProvider,
      );
    }

    const observerEnv = env as unknown as AiProxyRequestObserverEnv;
    const shouldObserveAiRequest = request.method === 'POST'
      && isObservableAiProxyPath(pathname)
      && isAiRequestObservabilityConfigured(observerEnv);
    const observerRequest = shouldObserveAiRequest ? request.clone() : null;
    const startedAtMs = shouldObserveAiRequest ? Date.now() : 0;
    const occurredAt = shouldObserveAiRequest ? new Date(startedAtMs).toISOString() : '';

    const response = await worker.fetch(request, env as never, tokenProvider);

    if (observerRequest) {
      scheduleAiRequestMetric(
        executionContext,
        observeAiProxyRequest({
          request: observerRequest,
          response: response.clone(),
          env: observerEnv,
          firestoreTokenProvider: tokenProvider,
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
    const tokenProvider = new FirestoreServiceAccountTokenProvider(
      env as unknown as FirestoreServiceAccountEnv,
    );
    executionContext.waitUntil(
      runScheduledObservabilityMaintenance(env, tokenProvider).catch((error) => {
        console.error('[Product Observability] scheduled retention failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }),
    );
  },
};
