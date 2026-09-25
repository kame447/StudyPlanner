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
import {
  WorkerSubrequestBudget,
  WorkerSubrequestBudgetExceededError,
} from './workerSubrequestBudget';
import worker from './worker';

export { AiQuotaDurableObject };

const MAX_ROLLUP_BATCHES_PER_SCHEDULE = 5;
const ROLLUP_BATCH_SIZE = 20;
const MAX_PROFILE_REGISTRATION_BACKFILL_BATCHES_PER_SCHEDULE = 2;
const PROFILE_REGISTRATION_BACKFILL_BATCH_SIZE = 100;
const MAX_RETENTION_BATCHES_PER_SCHEDULE = 2;
const RETENTION_BATCH_SIZE = 100;
export const SCHEDULED_INVOCATIONS_PER_DAY = 24 * 60;

export type ScheduledObservabilityPhase =
  | 'rollup'
  | 'active_user_snapshot'
  | 'profile_registration_backfill'
  | 'retention'
  | 'no_op';

export function scheduledObservabilityPhase(scheduledTime: number): ScheduledObservabilityPhase {
  if (!Number.isFinite(scheduledTime)) return 'no_op';
  const minute = new Date(scheduledTime).getUTCMinutes();
  switch (minute % 5) {
    case 0: return 'rollup';
    case 1: return 'active_user_snapshot';
    case 2: return 'profile_registration_backfill';
    case 3: return 'retention';
    default: return 'no_op';
  }
}

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
): Promise<void> {
  const engine = new ProductObservabilityRollupEngine(
    env as unknown as ProductObservabilityRollupEnv,
    firestore,
  );
  for (let index = 0; index < MAX_ROLLUP_BATCHES_PER_SCHEDULE; index += 1) {
    const result = await engine.runBatch(ROLLUP_BATCH_SIZE);
    if (!result.hasMore) break;
  }
}

async function runScheduledActiveUserSnapshots(
  env: Record<string, unknown>,
  firestore: FirestoreServiceAccountClient,
): Promise<void> {
  const rollup = new ProductObservabilityRollupEngine(
    env as unknown as ProductObservabilityRollupEnv,
    firestore,
  );
  const checkpoint = await rollup.currentCheckpoint();
  const snapshots = new ProductObservabilityActiveUserSnapshotService(
    env as unknown as ProductObservabilityActiveUserSnapshotEnv,
    firestore,
  );
  const result = await snapshots.runBatch(checkpoint.activeUserDirtySources);
  if (result.completedSource) {
    await rollup.clearActiveUserDirtySources([result.completedSource]);
  }
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
  phase: Exclude<ScheduledObservabilityPhase, 'no_op'>,
  tokenProvider: FirestoreTokenProvider,
): Promise<void> {
  const firestore = new FirestoreServiceAccountClient(
    env as unknown as FirestoreServiceAccountEnv,
    tokenProvider,
  );
  switch (phase) {
    case 'rollup':
      await runScheduledObservabilityRollup(env, firestore);
      return;
    case 'active_user_snapshot':
      await runScheduledActiveUserSnapshots(env, firestore);
      return;
    case 'profile_registration_backfill':
      await runScheduledProfileRegistrationBackfill(env, firestore);
      return;
    case 'retention':
      await runScheduledObservabilityRetention(env, firestore);
  }
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
    controller: { scheduledTime?: number },
    env: Record<string, unknown>,
    executionContext: ExecutionContext,
  ): Promise<void> {
    const phase = scheduledObservabilityPhase(controller.scheduledTime ?? Number.NaN);
    const budget = new WorkerSubrequestBudget('scheduled', phase);
    if (phase === 'no_op') {
      budget.logCompletion();
      return;
    }
    const tokenProvider = new FirestoreServiceAccountTokenProvider(
      env as unknown as FirestoreServiceAccountEnv,
      undefined,
      undefined,
      budget,
    );
    executionContext.waitUntil(
      runScheduledObservabilityMaintenance(env, phase, tokenProvider)
        .catch((error) => {
          if (error instanceof WorkerSubrequestBudgetExceededError) {
            console.info('[Product Observability] scheduled work deferred by subrequest budget', {
              phase,
            });
            return;
          }
          console.error('[Product Observability] scheduled maintenance failed', {
            phase,
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => budget.logCompletion()),
    );
  },
};
