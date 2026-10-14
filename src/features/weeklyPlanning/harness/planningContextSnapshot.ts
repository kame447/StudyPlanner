import type { WeeklyPlanningTurnExecutionInput } from '../weeklyPlanningTurnExecutionTypes';

/** Immutable JSON-like application data, not a new persistence or authority layer. */
export function snapshotContextValue<T>(value: T): T {
  const copy = structuredClone(value);
  const visited = new WeakSet<object>();
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== 'object' || visited.has(item)) return;
    visited.add(item);
    for (const nested of Object.values(item)) freeze(nested);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

/**
 * Codex TurnContext/StepContext boundary adapted to the existing planner DTO.
 * Capture data before asynchronous work; keep live cancellation/telemetry
 * capabilities separately, bound to the originating controller request.
 */
export function capturePlanningTurnContext<T extends WeeklyPlanningTurnExecutionInput>(input: T): T {
  const { isCurrentTurn, semanticObservation, ...data } = input;
  return Object.freeze({
    ...snapshotContextValue(data),
    ...(isCurrentTurn ? { isCurrentTurn } : {}),
    ...(semanticObservation ? { semanticObservation } : {}),
  }) as T;
}
