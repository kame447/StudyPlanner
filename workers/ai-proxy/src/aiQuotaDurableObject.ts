import { DurableObject } from 'cloudflare:workers';

export interface AiQuotaWindowRule {
  name: string;
  limit: number;
  windowId: string;
  resetAt: number;
}

interface AiQuotaBucketState {
  windowId: string;
  count: number;
  resetAt: number;
}

type AiQuotaState = Record<string, AiQuotaBucketState>;

export interface AiQuotaCheckRequest {
  rules: AiQuotaWindowRule[];
}

export interface AiQuotaCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  exceededRule?: string;
  limit?: number;
  remaining?: number;
}

export const TELEMETRY_ADMISSION_LIMITS = { minute: 1_200, day: 20_000 } as const;

/** Separate telemetry buckets reuse the quota DO, with Japan-time daily reset. */
export function buildTelemetryQuotaRules(now = Date.now()): AiQuotaWindowRule[] {
  const minuteStart = Math.floor(now / 60_000) * 60_000;
  const offset = 9 * 60 * 60 * 1000;
  const dayStart = Math.floor((now + offset) / 86_400_000) * 86_400_000;
  return [
    { name: 'telemetry:uid:minute', limit: TELEMETRY_ADMISSION_LIMITS.minute,
      windowId: String(minuteStart), resetAt: minuteStart + 60_000 },
    { name: 'telemetry:uid:day', limit: TELEMETRY_ADMISSION_LIMITS.day,
      windowId: new Date(dayStart).toISOString().slice(0, 10), resetAt: dayStart + 86_400_000 - offset },
  ];
}

const MINIMUM_RULE_LIMITS: Record<string, number> = {
  'telemetry:uid:minute': TELEMETRY_ADMISSION_LIMITS.minute,
  'telemetry:uid:day': TELEMETRY_ADMISSION_LIMITS.day,
  'ip:minute': 120,
  'chat:uid:minute': 30,
  'chat:uid:day': 1000,
  'ocr:uid:minute': 10,
  'ocr:uid:day': 100,
  'attachment:uid:minute': 10,
  'attachment:uid:day': 100,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQuotaWindowRule(value: unknown): value is AiQuotaWindowRule {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string'
    && value.name.trim().length > 0
    && typeof value.windowId === 'string'
    && value.windowId.trim().length > 0
    && typeof value.limit === 'number'
    && Number.isFinite(value.limit)
    && value.limit > 0
    && typeof value.resetAt === 'number'
    && Number.isFinite(value.resetAt)
  );
}

export function normalizeAiQuotaRuleLimit(rule: AiQuotaWindowRule): number {
  return Math.max(rule.limit, MINIMUM_RULE_LIMITS[rule.name] ?? rule.limit);
}

export class AiQuotaDurableObject extends DurableObject<Record<string, unknown>> {
  async checkAndConsume(request: AiQuotaCheckRequest): Promise<AiQuotaCheckResult> {
    const rules = Array.isArray(request.rules)
      ? request.rules
          .filter(isQuotaWindowRule)
          .map((rule) => ({ ...rule, limit: normalizeAiQuotaRuleLimit(rule) }))
      : [];

    if (rules.length === 0) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: 0,
      };
    }

    const now = Date.now();
    const state = (await this.ctx.storage.get<AiQuotaState>('quota-state')) ?? {};

    for (const rule of rules) {
      const current = state[rule.name];
      const count = current && current.windowId === rule.windowId ? current.count : 0;
      if (count >= rule.limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((rule.resetAt - now) / 1000)),
          exceededRule: rule.name,
          limit: rule.limit,
          remaining: 0,
        };
      }
    }

    let lowestRemaining = Number.POSITIVE_INFINITY;
    for (const rule of rules) {
      const current = state[rule.name];
      const count = current && current.windowId === rule.windowId ? current.count : 0;
      const nextCount = count + 1;
      state[rule.name] = {
        windowId: rule.windowId,
        count: nextCount,
        resetAt: rule.resetAt,
      };
      lowestRemaining = Math.min(lowestRemaining, rule.limit - nextCount);
    }

    await this.ctx.storage.put('quota-state', state);
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, lowestRemaining),
    };
  }
}
