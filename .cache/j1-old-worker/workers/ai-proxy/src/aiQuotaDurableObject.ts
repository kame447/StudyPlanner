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

const MINIMUM_RULE_LIMITS: Record<string, number> = {
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
