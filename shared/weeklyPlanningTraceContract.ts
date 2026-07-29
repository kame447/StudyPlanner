export const WEEKLY_PLANNING_TRACE_EVENT_TYPES = [
  'user_turn_received',
  'interpreter_started',
  'interpreter_completed',
  'candidate_accepted',
  'candidate_rejected',
  'assumption_proposed',
  'assumption_accepted',
  'assumption_rejected',
  'assumption_superseded',
  'correction_applied',
  'correction_rejected',
  'relative_constraint_resolved',
  'relative_constraint_rejected',
  'readiness_evaluated',
  'feasibility_evaluated',
  'dialogue_planned',
  'fallback_used',
  'preview_gate_evaluated',
  'preview_generated',
  'preview_rejected_stale',
  'preview_rejected_pending_assumption',
  'draft_promoted',
  'approval_started',
  'approval_item_saved',
  'approval_item_failed',
  'approval_completed',
  'request_cancelled',
  'stale_async_result_discarded',
  // Legacy schema v1 only. New Stable V5 writes use turn_diagnostic documents.
  'stable_v5_debug_stage',
  'trace_write_failed',
] as const;

export type WeeklyPlanningTraceEventTypeContract =
  typeof WEEKLY_PLANNING_TRACE_EVENT_TYPES[number];

export const WEEKLY_PLANNING_TRACE_CONTRACT_VERSION = '2026-07-29-v3' as const;
export const WEEKLY_PLANNING_TRACE_WORKER_REVISION =
  'weekly-planning-trace-20260729-004' as const;

export const WEEKLY_PLANNING_TRACE_HEADERS = {
  contractVersion: 'X-StudyPlanner-Trace-Contract-Version',
  workerRevision: 'X-StudyPlanner-Trace-Worker-Revision',
  correlationId: 'X-StudyPlanner-Trace-Correlation-Id',
} as const;

export const WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING = {
  defaultPageSize: 20,
  maxPageSize: 20,
  maxEntryCount: 500,
  maxPages: 25,
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
