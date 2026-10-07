import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';

/**
 * One AI dispatch pool per turn, shared by every stage that calls the provider
 * (focused contextual/authorization routes, generic semantic call, repair, completeness
 * and dense-audit retries, and the dialogue renderer). Stages no longer own independent
 * retry allowances that stack up; the turn as a whole gets this many dispatches.
 *
 * Arithmetic of the limit (check any new stage against it). Semantic stages may use
 * limit - reserve = 7:
 *   valid path:   focused contextual 2 + focused authorization 1 + initial 1
 *                 + no-op completeness (focused side contribution 1 + generic 2) = 7
 *   dense path:   contextual 2 + authorization 1 + initial 1 + audit 1 + retry 1 = 6
 *   invalid path: contextual 2 + authorization 1 + initial 1
 *                 + (one focused repair 1 | generic repair 1 + no-op completeness 3)
 *                 (a dispatched focused repair always returns a result, so generic repair
 *                 never follows one)
 * Enforcement belongs to the interaction architecture only; the legacy architecture keeps its
 * historical retry control flow and the pool merely counts (the measurement uses the count).
 * Exhaustion is reachable only in the no-op completeness and dense audit/retry stages;
 * both keep the already valid document. Renderer: reserve 1, deterministic fallback.
 *
 * The renderer keeps a reserve so a turn whose semantic stages used the pool can still be
 * verbalized. Renderer exhaustion is harmless (deterministic fallback text exists); semantic
 * exhaustion fails the stage without changing authoritative state.
 *
 * Outage gate (enforced pool only): when the turn's latest provider dispatch failed, the
 * renderer is not dispatched; the same provider has just failed, so the deterministic
 * emergency wording is used instead of waiting on another failing call. A later successful
 * dispatch in the same turn reopens it. Semantic stages are never gated by it.
 */
export const WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT = 8;
export const WEEKLY_PLANNING_TURN_AI_RENDERER_RESERVE = 1;

export type WeeklyPlanningTurnDispatchStage = 'semantic' | 'renderer';

export class WeeklyPlanningTurnDispatchBudgetExceededError extends Error {
  constructor(readonly stage: WeeklyPlanningTurnDispatchStage, readonly limit: number) {
    super(`Weekly planning turn AI dispatch budget exhausted (stage=${stage}, limit=${limit}).`);
    this.name = 'WeeklyPlanningTurnDispatchBudgetExceededError';
  }
}

export function isWeeklyPlanningTurnDispatchBudgetExceeded(error: unknown): boolean {
  return error instanceof WeeklyPlanningTurnDispatchBudgetExceededError;
}

/** The renderer was not dispatched because the turn's latest provider dispatch failed. */
export class WeeklyPlanningTurnProviderOutageError extends Error {
  constructor() {
    super('Weekly planning turn: the latest provider dispatch failed; the renderer is not dispatched.');
    this.name = 'WeeklyPlanningTurnProviderOutageError';
  }
}

/** The pool refused the dispatch (exhausted, or renderer gated by an outage): nothing was sent. */
export function isWeeklyPlanningTurnDispatchRefusal(error: unknown): boolean {
  return error instanceof WeeklyPlanningTurnDispatchBudgetExceededError
    || error instanceof WeeklyPlanningTurnProviderOutageError;
}

/** What one turn actually dispatched to the AI provider; identical for every architecture. */
export interface WeeklyPlanningTurnDispatchUsage {
  total: number;
  semantic: number;
  renderer: number;
  limit: number;
  /** The pool was enforced (interaction architecture); legacy only counts. */
  enforced: boolean;
  /** Dispatches the enforced pool refused (always 0 when not enforced). */
  refused: number;
}

export interface WeeklyPlanningTurnDispatchBudget {
  readonly limit: number;
  readonly used: number;
  readonly enforced: boolean;
  /**
   * Counts one dispatch for the stage; called immediately before the request. When the pool
   * is enforced it throws instead once the stage's ceiling is reached, or (renderer only)
   * while the turn's latest provider dispatch has failed. Counting is independent of
   * enforcement so both architectures are measured the same way.
   */
  consume(stage: WeeklyPlanningTurnDispatchStage): void;
  /** How the latest dispatched request ended (failed = the provider call threw). */
  settle(outcome: 'succeeded' | 'failed'): void;
  usage(): WeeklyPlanningTurnDispatchUsage;
}

export function createWeeklyPlanningTurnDispatchBudget(
  limit: number = WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT,
  options: { enforce?: boolean } = {},
): WeeklyPlanningTurnDispatchBudget {
  const enforced = options.enforce ?? true;
  let used = 0;
  let refused = 0;
  let latestDispatchFailed = false;
  const byStage: Record<WeeklyPlanningTurnDispatchStage, number> = { semantic: 0, renderer: 0 };
  return {
    limit,
    enforced,
    get used() { return used; },
    consume(stage) {
      const ceiling = stage === 'renderer' ? limit : limit - WEEKLY_PLANNING_TURN_AI_RENDERER_RESERVE;
      if (enforced && used >= ceiling) {
        refused += 1;
        throw new WeeklyPlanningTurnDispatchBudgetExceededError(stage, limit);
      }
      if (enforced && stage === 'renderer' && latestDispatchFailed) {
        refused += 1;
        throw new WeeklyPlanningTurnProviderOutageError();
      }
      used += 1;
      byStage[stage] += 1;
    },
    settle(outcome) {
      latestDispatchFailed = outcome === 'failed';
    },
    usage() {
      return { total: used, ...byStage, limit, enforced, refused };
    },
  };
}

const MAX_TRACKED_TURNS = 64;
const budgets = new Map<string, WeeklyPlanningTurnDispatchBudget>();
const finishedUsage = new Map<string, WeeklyPlanningTurnDispatchUsage>();

function trimOldest<T>(map: Map<string, T>): void {
  while (map.size > MAX_TRACKED_TURNS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** Starts a fresh pool for the turn (called once at turn ingress). */
export function beginWeeklyPlanningTurnDispatchBudget(
  turnId: string,
  options: { enforce?: boolean } = {},
): WeeklyPlanningTurnDispatchBudget {
  const budget = createWeeklyPlanningTurnDispatchBudget(undefined, options);
  budgets.set(turnId, budget);
  finishedUsage.delete(turnId);
  trimOldest(budgets);
  return budget;
}

/** The turn's pool; created on demand (enforced) for callers that enter below turn ingress. */
export function getWeeklyPlanningTurnDispatchBudget(turnId: string): WeeklyPlanningTurnDispatchBudget {
  return budgets.get(turnId) ?? beginWeeklyPlanningTurnDispatchBudget(turnId);
}

/** Closes the turn's pool and keeps its final usage until the measurement collector takes it. */
export function endWeeklyPlanningTurnDispatchBudget(turnId: string): void {
  const budget = budgets.get(turnId);
  if (!budget) return;
  finishedUsage.set(turnId, budget.usage());
  trimOldest(finishedUsage);
  budgets.delete(turnId);
}

/**
 * Final dispatch usage of the turn (closing a still-open pool), or null when the turn never
 * reached a provider-capable stage. Taking removes the record.
 */
export function takeWeeklyPlanningTurnDispatchUsage(
  turnId: string,
): WeeklyPlanningTurnDispatchUsage | null {
  endWeeklyPlanningTurnDispatchBudget(turnId);
  const usage = finishedUsage.get(turnId) ?? null;
  finishedUsage.delete(turnId);
  return usage;
}

/** Wraps the provider client so every dispatch of the turn is counted (and, if enforced, pooled). */
export function withWeeklyPlanningTurnDispatchBudget(
  client: OpenAiCompatibleClient,
  budget: WeeklyPlanningTurnDispatchBudget,
  stage: WeeklyPlanningTurnDispatchStage,
): OpenAiCompatibleClient {
  return {
    ...client,
    async createChatCompletion(input) {
      budget.consume(stage);
      try {
        const response = await client.createChatCompletion(input);
        budget.settle('succeeded');
        return response;
      } catch (error) {
        budget.settle('failed');
        throw error;
      }
    },
  };
}
