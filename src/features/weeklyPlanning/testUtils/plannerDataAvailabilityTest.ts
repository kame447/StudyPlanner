import type { PlannerDataAvailability } from '../../../domain/plannerDataReadAuthority';

export function createReadyPlannerDataAvailability(
  ownerId: string,
): PlannerDataAvailability {
  const observedAt = '2026-08-31T00:00:00.000Z';
  return {
    status: 'ready',
    ownerId,
    observedAt,
    lastSuccessfulAt: observedAt,
  };
}
