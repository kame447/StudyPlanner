export const WEEKLY_PLANNING_TRACE_EVENT_TYPES = [
  'user_turn_received',
  'interpreter_started',
  'interpreter_completed',
  'dialogue_planned',
  'preview_generated',
  'preview_rejected_stale',
  'preview_gate_evaluated',
  'approval_started',
  'approval_completed',
  'approval_failed',
  'save_started',
  'save_completed',
  'save_failed',
  'fallback_used',
  'failure',
  'stale_async_result_discarded',
  'stable_v5_debug_stage',
] as const;

export type WeeklyPlanningTraceEventTypeContract =
  typeof WEEKLY_PLANNING_TRACE_EVENT_TYPES[number];

export const WEEKLY_PLANNING_TRACE_CONTRACT_VERSION = '2026-07-29-v4' as const;
export const WEEKLY_PLANNING_TRACE_WORKER_REVISION =
  'weekly-planning-trace-20260729-005' as const;

export const WEEKLY_PLANNING_TRACE_HEADERS = {
  contractVersion: 'X-StudyPlanner-Trace-Contract-Version',
  workerRevision: 'X-StudyPlanner-Trace-Worker-Revision',
  correlationId: 'X-StudyPlanner-Trace-Correlation-Id',
} as const;

export const WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING = {
  defaultPageSize: 20,
  maxPageSize: 20,
  maxEntryCount: 100_000,
  maxPages: 25,
  maxAutoCollectedEntries: 500,
  maxResponseBytes: 256 * 1024,
} as const;

export const WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS = {
  maxRequestBodyBytes: 512 * 1024,
  maxEntriesPerRequest: 100,
  maxDocumentBytes: 64 * 1024,
  clientDocumentTargetBytes: 48 * 1024,
  clientBatchTargetBytes: 384 * 1024,
} as const;

export function getWeeklyPlanningTraceUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function measureWeeklyPlanningTraceJsonBytes(value: unknown): number {
  return getWeeklyPlanningTraceUtf8ByteLength(JSON.stringify(value));
}
