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
 * Exhaustion is reachable only in the no-op completeness and dense audit/retry stages;
 * both keep the already valid document. Renderer: reserve 1, deterministic fallback.
 *
 * The renderer keeps a reserve so a turn whose semantic stages used the pool can still be
 * verbalized. Renderer exhaustion is harmless (deterministic fallback text exists); semantic
 * exhaustion fails the stage without changing authoritative state.
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

export interface WeeklyPlanningTurnDispatchBudget {
  readonly limit: number;
  readonly used: number;
  /** Reserves one dispatch for the stage or throws; called immediately before the request. */
  consume(stage: WeeklyPlanningTurnDispatchStage): void;
}

export function createWeeklyPlanningTurnDispatchBudget(
  limit: number = WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT,
): WeeklyPlanningTurnDispatchBudget {
  let used = 0;
  return {
    limit,
    get used() { return used; },
    consume(stage) {
      const ceiling = stage === 'renderer' ? limit : limit - WEEKLY_PLANNING_TURN_AI_RENDERER_RESERVE;
      if (used >= ceiling) throw new WeeklyPlanningTurnDispatchBudgetExceededError(stage, limit);
      used += 1;
    },
  };
}

const MAX_TRACKED_TURNS = 64;
const budgets = new Map<string, WeeklyPlanningTurnDispatchBudget>();

/** Starts a fresh pool for the turn (called once at turn ingress). */
export function beginWeeklyPlanningTurnDispatchBudget(turnId: string): WeeklyPlanningTurnDispatchBudget {
  const budget = createWeeklyPlanningTurnDispatchBudget();
  budgets.set(turnId, budget);
  while (budgets.size > MAX_TRACKED_TURNS) {
    const oldest = budgets.keys().next().value;
    if (oldest === undefined) break;
    budgets.delete(oldest);
  }
  return budget;
}

/** The turn's pool; created on demand for callers that enter below turn ingress. */
export function getWeeklyPlanningTurnDispatchBudget(turnId: string): WeeklyPlanningTurnDispatchBudget {
  return budgets.get(turnId) ?? beginWeeklyPlanningTurnDispatchBudget(turnId);
}

export function endWeeklyPlanningTurnDispatchBudget(turnId: string): void {
  budgets.delete(turnId);
}

/** Wraps the provider client so every dispatch of the turn draws from one pool. */
export function withWeeklyPlanningTurnDispatchBudget(
  client: OpenAiCompatibleClient,
  budget: WeeklyPlanningTurnDispatchBudget,
  stage: WeeklyPlanningTurnDispatchStage,
): OpenAiCompatibleClient {
  return {
    ...client,
    async createChatCompletion(input) {
      budget.consume(stage);
      return client.createChatCompletion(input);
    },
  };
}
