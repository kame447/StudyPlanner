export const WEEKLY_PLANNING_STABLE_V5_DEBUG_TRACE_SCHEMA_VERSION = 1;

export type WeeklyPlanningStableV5DebugTraceSeverity =
  | 'debug'
  | 'info'
  | 'warn'
  | 'error';

export interface WeeklyPlanningStableV5DebugTraceEvent {
  schemaVersion: typeof WEEKLY_PLANNING_STABLE_V5_DEBUG_TRACE_SCHEMA_VERSION;
  sequence: number;
  stage: string;
  occurredAt: string;
  severity: WeeklyPlanningStableV5DebugTraceSeverity;
  data: unknown;
}

interface ActiveWeeklyPlanningStableV5DebugTrace {
  nextSequence: number;
  events: WeeklyPlanningStableV5DebugTraceEvent[];
}

const MAX_ACTIVE_REQUESTS = 128;
const activeTraces = new Map<string, ActiveWeeklyPlanningStableV5DebugTrace>();

function cloneTraceData(value: unknown): unknown {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to the JSON-safe clone below.
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function cloneEvents(
  events: WeeklyPlanningStableV5DebugTraceEvent[] | undefined,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  return events?.map(
    (event) => cloneTraceData(event) as WeeklyPlanningStableV5DebugTraceEvent,
  ) ?? [];
}

function trimOldestTraceIfNeeded(): void {
  while (activeTraces.size > MAX_ACTIVE_REQUESTS) {
    const oldestRequestId = activeTraces.keys().next().value;
    if (typeof oldestRequestId !== 'string') return;
    activeTraces.delete(oldestRequestId);
  }
}

function ensureTrace(requestId: string): ActiveWeeklyPlanningStableV5DebugTrace {
  const existing = activeTraces.get(requestId);
  if (existing) return existing;

  const created: ActiveWeeklyPlanningStableV5DebugTrace = {
    nextSequence: 0,
    events: [],
  };
  activeTraces.set(requestId, created);
  trimOldestTraceIfNeeded();
  return created;
}

export function beginWeeklyPlanningStableV5DebugTrace(requestId: string): void {
  activeTraces.set(requestId, {
    nextSequence: 0,
    events: [],
  });
  trimOldestTraceIfNeeded();
}

export function recordWeeklyPlanningStableV5DebugTrace(params: {
  requestId?: string;
  stage: string;
  data: unknown;
  severity?: WeeklyPlanningStableV5DebugTraceSeverity;
}): void {
  if (!params.requestId) return;
  const active = ensureTrace(params.requestId);
  const event: WeeklyPlanningStableV5DebugTraceEvent = {
    schemaVersion: WEEKLY_PLANNING_STABLE_V5_DEBUG_TRACE_SCHEMA_VERSION,
    sequence: active.nextSequence,
    stage: params.stage,
    occurredAt: new Date().toISOString(),
    severity: params.severity ?? 'debug',
    data: cloneTraceData(params.data),
  };
  active.nextSequence += 1;
  active.events.push(event);
}

export function readWeeklyPlanningStableV5DebugTrace(
  requestId: string,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  return cloneEvents(activeTraces.get(requestId)?.events);
}

export function clearWeeklyPlanningStableV5DebugTrace(requestId: string): void {
  activeTraces.delete(requestId);
}

export function takeWeeklyPlanningStableV5DebugTrace(
  requestId: string,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  const events = readWeeklyPlanningStableV5DebugTrace(requestId);
  clearWeeklyPlanningStableV5DebugTrace(requestId);
  return events;
}

export function peekWeeklyPlanningStableV5DebugTraceForTest(
  requestId: string,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  return readWeeklyPlanningStableV5DebugTrace(requestId);
}

export function resetWeeklyPlanningStableV5DebugTraceForTest(): void {
  activeTraces.clear();
}
