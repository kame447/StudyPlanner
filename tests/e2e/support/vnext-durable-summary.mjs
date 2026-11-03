// Pure summary of a durable turn response body (no browser import; unit-tested against a real Worker-executed turn).
/** Pure: one durable response body -> counts and schema names, or null when it is not a completed turn. */
export function summarizeDurableTurnBody(text) {
  let state;
  try { state = JSON.parse(text); } catch { return null; }
  if (state?.status !== 'completed' || typeof state.result !== 'string') return null;
  let completed;
  try { completed = JSON.parse(state.result); } catch { return null; }
  const events = completed?.result?.debugTraceEvents;
  const requests = Array.isArray(events) ? events.filter(event => event?.stage === 'semantic_provider_request') : [];
  return {
    requestId: typeof state.identity?.requestId === 'string' ? state.identity.requestId : null,
    core: completed?.core ?? null,
    traceAvailable: Array.isArray(events),
    // The collector replaces everything with one notice when the result exceeds the durable output cap.
    traceTruncated: Array.isArray(events) && events.some(event => event?.stage === 'trace_collector_truncated'),
    schemas: requests.map(event => event?.data?.request?.responseFormat?.json_schema?.name ?? 'none'),
    // Absent for a system-authored reply; always V5's dialogue renderer by construction (durableVNextTurn.ts).
    rendererCalls: completed?.result?.dialogueRendererTrace?.request ? 1 : 0,
  };
}
