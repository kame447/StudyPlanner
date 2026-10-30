import { afterEach, expect, it, vi } from 'vitest';
import { pauseAccountClientWrites, accountClientWritesPaused, resumeAccountClientWrites } from './accountDeletionClientState';
import { createRemoteProductTelemetrySink } from '../features/productObservability/productTelemetryRemoteSink';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from '../features/weeklyPlanning/trace/weeklyPlanningTraceRepository';

let restoreStorage = () => {};
afterEach(() => { resumeAccountClientWrites('delete-A'); resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined); vi.unstubAllGlobals(); vi.unstubAllEnvs(); restoreStorage(); });
it('stops telemetry and trace outbox/append for A while B remains active', async () => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
  const appendEntries = vi.fn().mockResolvedValue(undefined);
  setWeeklyPlanningTraceRepositoryForTests({ upsertSession: async () => {}, appendEntries,
    listSessions: async () => [], listSessionsForAdmin: async () => [], archiveSessionForAdmin: async () => {},
    getSession: async () => null, listEntries: async () => [] });
  pauseAccountClientWrites('delete-A');
  const event = { schemaVersion: 1 as const, eventId: 'activity-delete-test', eventType: 'product_activity' as const,
    occurredAt: new Date().toISOString(), appVersion: 'test', source: 'web_app' as const, payload: { action: 'app_active' as const } };
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  const sink = (uid: string) => createRemoteProductTelemetrySink({ endpoint: 'https://worker.test/events',
    getIdToken: async () => 'token', fetcher, canWrite: () => !accountClientWritesPaused(uid) });
  await sink('delete-A').write(event); await sink('delete-B').write(event);
  expect(fetcher).toHaveBeenCalledOnce();
  const input = { conversationId: 'deletion-test', requestId: 'deletion-test', userText: 'synthetic', outcome: 'ready', previewCount: 0 };
  await recordWeeklyPlanningStableV5TurnTrace({ ...input, userId: 'delete-A' });
  expect(appendEntries).not.toHaveBeenCalled();
  await recordWeeklyPlanningStableV5TurnTrace({ ...input, userId: 'delete-B' });
  expect(appendEntries).toHaveBeenCalledOnce();
  expect(appendEntries.mock.calls[0][0].session.userId).toBe('delete-B');
});
