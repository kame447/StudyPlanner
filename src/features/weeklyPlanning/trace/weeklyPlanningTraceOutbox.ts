import type { WeeklyPlanningStableV5TraceInput } from './weeklyPlanningStableV5TraceRuntime';

const OUTBOX_VERSION = 'studyplanner-weekly-planning-trace-outbox-v1' as const;
const OUTBOX_KEY = 'studyplanner.weeklyPlanning.trace.outbox.v1';
const MAX_OUTBOX_ITEMS = 10;
const MAX_OUTBOX_ITEM_BYTES = 192 * 1024;
const MAX_OUTBOX_TOTAL_BYTES = 1024 * 1024;

export interface WeeklyPlanningTraceOutboxItem {
  version: typeof OUTBOX_VERSION;
  occurredAt: string;
  input: WeeklyPlanningStableV5TraceInput;
}

interface WeeklyPlanningTraceOutboxEnvelope {
  version: typeof OUTBOX_VERSION;
  items: WeeklyPlanningTraceOutboxItem[];
}

let memoryEnvelope: WeeklyPlanningTraceOutboxEnvelope = {
  version: OUTBOX_VERSION,
  items: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? 'null').byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function validInput(value: unknown): value is WeeklyPlanningStableV5TraceInput {
  if (!isRecord(value)) return false;
  return typeof value.userId === 'string'
    && typeof value.conversationId === 'string'
    && typeof value.requestId === 'string'
    && typeof value.userText === 'string'
    && typeof value.outcome === 'string'
    && typeof value.previewCount === 'number'
    && Number.isSafeInteger(value.previewCount)
    && value.previewCount >= 0
    && (value.assistantMessage === undefined || typeof value.assistantMessage === 'string')
    && (value.planningRangeStart === undefined || typeof value.planningRangeStart === 'string')
    && (value.planningRangeEnd === undefined || typeof value.planningRangeEnd === 'string')
    && (value.errorCode === undefined || typeof value.errorCode === 'string')
    && (value.debugTraceEvents === undefined || Array.isArray(value.debugTraceEvents));
}

function validItem(value: unknown): value is WeeklyPlanningTraceOutboxItem {
  return isRecord(value)
    && value.version === OUTBOX_VERSION
    && typeof value.occurredAt === 'string'
    && Number.isFinite(Date.parse(value.occurredAt))
    && validInput(value.input)
    && byteLength(value) <= MAX_OUTBOX_ITEM_BYTES;
}

function normalize(value: unknown): WeeklyPlanningTraceOutboxEnvelope {
  if (!isRecord(value) || value.version !== OUTBOX_VERSION || !Array.isArray(value.items)) {
    return { version: OUTBOX_VERSION, items: [] };
  }
  const items = value.items.filter(validItem).slice(-MAX_OUTBOX_ITEMS);
  while (items.length > 0 && byteLength({ version: OUTBOX_VERSION, items }) > MAX_OUTBOX_TOTAL_BYTES) {
    items.shift();
  }
  return { version: OUTBOX_VERSION, items };
}

function readEnvelope(): WeeklyPlanningTraceOutboxEnvelope {
  const target = storage();
  if (!target) return normalize(memoryEnvelope);
  try {
    const raw = target.getItem(OUTBOX_KEY);
    if (!raw) return { version: OUTBOX_VERSION, items: [] };
    return normalize(JSON.parse(raw));
  } catch {
    try { target.removeItem(OUTBOX_KEY); } catch { /* ignore */ }
    return { version: OUTBOX_VERSION, items: [] };
  }
}

function writeEnvelope(envelope: WeeklyPlanningTraceOutboxEnvelope): boolean {
  const normalized = normalize(envelope);
  memoryEnvelope = normalized;
  const target = storage();
  if (!target) return true;
  try {
    if (normalized.items.length === 0) target.removeItem(OUTBOX_KEY);
    else target.setItem(OUTBOX_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function listWeeklyPlanningTraceOutboxItems(params: {
  userId: string;
  conversationId: string;
}): WeeklyPlanningTraceOutboxItem[] {
  return readEnvelope().items
    .filter((item) => item.input.userId === params.userId
      && item.input.conversationId === params.conversationId)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

export function enqueueWeeklyPlanningTraceOutboxItem(item: WeeklyPlanningTraceOutboxItem): {
  saved: boolean;
  overflowed: boolean;
} {
  if (!validItem(item)) return { saved: false, overflowed: true };
  const envelope = readEnvelope();
  const withoutDuplicate = envelope.items.filter((existing) =>
    existing.input.requestId !== item.input.requestId
      || existing.input.userId !== item.input.userId
      || existing.input.conversationId !== item.input.conversationId);
  const items = [...withoutDuplicate, item];
  let overflowed = false;
  while (items.length > MAX_OUTBOX_ITEMS
    || byteLength({ version: OUTBOX_VERSION, items }) > MAX_OUTBOX_TOTAL_BYTES) {
    items.shift();
    overflowed = true;
  }
  return {
    saved: writeEnvelope({ version: OUTBOX_VERSION, items }),
    overflowed,
  };
}

export function removeWeeklyPlanningTraceOutboxItem(params: {
  userId: string;
  conversationId: string;
  requestId: string;
}): void {
  const envelope = readEnvelope();
  writeEnvelope({
    version: OUTBOX_VERSION,
    items: envelope.items.filter((item) => !(item.input.userId === params.userId
      && item.input.conversationId === params.conversationId
      && item.input.requestId === params.requestId)),
  });
}

export function clearWeeklyPlanningTraceOutboxForTest(): void {
  memoryEnvelope = { version: OUTBOX_VERSION, items: [] };
  const target = storage();
  if (!target) return;
  try { target.removeItem(OUTBOX_KEY); } catch { /* ignore */ }
}
