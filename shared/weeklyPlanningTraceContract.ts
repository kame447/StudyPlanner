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
  'stable_v5_debug_stage',
  'trace_write_failed',
] as const;

export type WeeklyPlanningTraceEventTypeContract =
  typeof WEEKLY_PLANNING_TRACE_EVENT_TYPES[number];

export const WEEKLY_PLANNING_TRACE_DEBUG_CHUNK_ENCODING =
  'base64-utf8-json-dotted-20' as const;

export const WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS = {
  maxRequestBodyBytes: 512 * 1024,
  maxEntriesPerRequest: 100,
  maxDocumentBytes: 64 * 1024,
  clientDocumentTargetBytes: 48 * 1024,
  clientBatchTargetBytes: 384 * 1024,
  // Base64 expansion plus separators remains below the Worker 4,000-character string cap.
  debugRawChunkBytes: 2_700,
  // Runs shorter than the Worker token-redaction threshold preserve the encoded chunk.
  debugBase64RunCharacters: 20,
} as const;

export function getWeeklyPlanningTraceUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function measureWeeklyPlanningTraceJsonBytes(value: unknown): number {
  return getWeeklyPlanningTraceUtf8ByteLength(JSON.stringify(value));
}

export function encodeWeeklyPlanningTraceDebugChunkBase64(
  base64: string,
): string {
  const width = WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.debugBase64RunCharacters;
  const segments: string[] = [];
  for (let index = 0; index < base64.length; index += width) {
    segments.push(base64.slice(index, index + width));
  }
  return segments.join('.');
}

export function decodeWeeklyPlanningTraceDebugChunkBase64(
  encoded: string,
): string {
  return encoded.replace(/\./g, '');
}