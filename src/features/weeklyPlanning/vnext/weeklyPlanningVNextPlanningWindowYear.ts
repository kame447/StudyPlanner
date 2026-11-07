import type { VNextBoundPlanningYearBasis, VNextPlanningWindowFact, VNextPlanningWindowYearBasis,
  VNextPlanningYearBasis, VNextTurnContext } from './weeklyPlanningVNextTypes';

export const VNEXT_YEAR_ORIGINS = ['explicit', 'context', 'inferred'] as const;
export const VNEXT_YEAR_SOURCES = ['user_text', 'current_date', 'planning_horizon'] as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function validEndpoint(value: unknown, bound: boolean): boolean {
  if (!record(value)) return false;
  const keys = ['origin', 'source', 'reference', ...(bound ? ['year', 'verified'] : [])];
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
    && VNEXT_YEAR_ORIGINS.includes(value.origin as VNextPlanningYearBasis['origin'])
    && VNEXT_YEAR_SOURCES.includes(value.source as VNextPlanningYearBasis['source'])
    && (value.reference === null || typeof value.reference === 'string')
    && (!bound || (Number.isInteger(value.year) && typeof value.verified === 'boolean'));
}

export function isVNextPlanningWindowYearBasis(value: unknown, bound = false): boolean {
  return value === null || (record(value) && Object.keys(value).length === 2
    && validEndpoint(value.start, bound) && validEndpoint(value.end, bound));
}

/** Check references, not Japanese meaning. The origin classification remains semantic evidence. */
export function bindVNextPlanningWindowYearBasis(
  value: VNextPlanningWindowYearBasis | null | undefined,
  window: { start: string; end: string },
  context: Pick<VNextTurnContext, 'sourceText' | 'acceptedDate' | 'planningHorizon'> & { planningHorizonVerified: boolean },
): VNextPlanningWindowFact['yearBasis'] {
  if (!value || !isVNextPlanningWindowYearBasis(value)) return null;
  const bind = (basis: VNextPlanningYearBasis, date: string): VNextBoundPlanningYearBasis => {
    const year = Number(date.slice(0, 4));
    const reference = basis.reference;
    let verified = false;
    if (reference?.trim()) {
      if (basis.source === 'user_text') verified = context.sourceText.includes(reference);
      else if (basis.origin === 'context' && basis.source === 'current_date') {
        verified = reference === context.acceptedDate && year === Number(context.acceptedDate.slice(0, 4));
      } else if (basis.origin === 'context' && basis.source === 'planning_horizon') {
        const { startDate, endDate } = context.planningHorizon;
        verified = context.planningHorizonVerified && reference === `${startDate}/${endDate}`
          && [startDate, endDate].some(day => Number(day.slice(0, 4)) === year);
      }
    }
    return { ...basis, year, verified: verified && basis.origin !== 'inferred' };
  };
  return { start: bind(value.start, window.start), end: bind(value.end, window.end) };
}

export function vnextPlanningWindowYearBasisVerified(window: VNextPlanningWindowFact): boolean {
  if (!window.start || !window.end) return false;
  return (['start', 'end'] as const).every(endpoint => {
    const basis = window.yearBasis?.[endpoint];
    return basis?.verified === true && basis.origin !== 'inferred' && basis.year === Number(window[endpoint]!.slice(0, 4));
  });
}

/** No duration threshold: an unproven year crossing is a required planning-window question. */
export function vnextPlanningWindowNeedsYearConfirmation(window: VNextPlanningWindowFact): boolean {
  return !!window.start && !!window.end && window.start.slice(0, 4) !== window.end.slice(0, 4)
    && !vnextPlanningWindowYearBasisVerified(window);
}
