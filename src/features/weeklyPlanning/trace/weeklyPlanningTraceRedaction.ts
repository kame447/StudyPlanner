const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_VALUE = '[TRUNCATED]';
const CIRCULAR_VALUE = '[CIRCULAR]';

const FORBIDDEN_KEYS = new Set([
  'prompt',
  'rawprompt',
  'systemprompt',
  'secret',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'token',
  'authorization',
  'password',
  'privateid',
  'cookie',
]);

export interface WeeklyPlanningTraceSanitizeOptions {
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
  maxSerializedBytes?: number;
}

export interface WeeklyPlanningTraceSanitizeResult {
  value: unknown;
  truncated: boolean;
  serializedBytes: number;
}

const DEFAULT_OPTIONS: Required<WeeklyPlanningTraceSanitizeOptions> = {
  maxDepth: 8,
  maxArrayItems: 100,
  maxObjectKeys: 100,
  maxStringLength: 4_000,
  maxSerializedBytes: 48_000,
};

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isForbiddenWeeklyPlanningTraceKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(normalizedKey(key));
}

function serializedByteLength(value: unknown): number {
  const serialized = JSON.stringify(value) ?? '';
  return new TextEncoder().encode(serialized).byteLength;
}

export function sanitizeWeeklyPlanningTraceValue(
  input: unknown,
  options: WeeklyPlanningTraceSanitizeOptions = {},
): WeeklyPlanningTraceSanitizeResult {
  const limits = { ...DEFAULT_OPTIONS, ...options };
  const seen = new WeakSet<object>();
  let truncated = false;

  function visit(value: unknown, depth: number): unknown {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      if (value.length <= limits.maxStringLength) return value;
      truncated = true;
      return `${value.slice(0, limits.maxStringLength)}${TRUNCATED_VALUE}`;
    }

    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
      return undefined;
    }

    if (depth >= limits.maxDepth) {
      truncated = true;
      return TRUNCATED_VALUE;
    }

    if (Array.isArray(value)) {
      const items = value.slice(0, limits.maxArrayItems).map((item) => visit(item, depth + 1));
      if (value.length > limits.maxArrayItems) {
        truncated = true;
        items.push(TRUNCATED_VALUE);
      }
      return items;
    }

    if (value instanceof Date) return value.toISOString();

    if (typeof value === 'object') {
      if (seen.has(value)) {
        truncated = true;
        return CIRCULAR_VALUE;
      }
      seen.add(value);

      const entries = Object.entries(value as Record<string, unknown>);
      const result: Record<string, unknown> = {};
      for (const [index, [key, entryValue]] of entries.entries()) {
        if (index >= limits.maxObjectKeys) {
          truncated = true;
          result.__truncated__ = TRUNCATED_VALUE;
          break;
        }
        if (isForbiddenWeeklyPlanningTraceKey(key)) {
          result[key] = REDACTED_VALUE;
          continue;
        }
        const sanitized = visit(entryValue, depth + 1);
        if (sanitized !== undefined) result[key] = sanitized;
      }
      return result;
    }

    return String(value);
  }

  let value = visit(input, 0);
  let serializedBytes = serializedByteLength(value);
  if (serializedBytes > limits.maxSerializedBytes) {
    truncated = true;
    value = {
      __truncated__: TRUNCATED_VALUE,
      originalSerializedBytes: serializedBytes,
    };
    serializedBytes = serializedByteLength(value);
  }

  return { value, truncated, serializedBytes };
}

export function containsForbiddenWeeklyPlanningTraceKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenWeeklyPlanningTraceKey);
  }
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, entryValue]) => isForbiddenWeeklyPlanningTraceKey(key)
      || containsForbiddenWeeklyPlanningTraceKey(entryValue),
  );
}
