/** Only numeric projection overflow is recoverable by excluding a journal event. */
export class ObservabilityAggregateOverflowError extends Error {
  constructor() {
    super('observability_aggregate_counter_overflow');
    this.name = 'ObservabilityAggregateOverflowError';
  }
}

/** Projection documents contain counters, plus fractional latency measurements. */
export function assertObservabilityAggregateCounters(value: unknown, field = ''): void {
  if (typeof value === 'number') {
    const fractional = ['sumMs', 'minMs', 'maxMs'].includes(field);
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER
      || (!fractional && !Number.isSafeInteger(value))) {
      throw new ObservabilityAggregateOverflowError();
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => assertObservabilityAggregateCounters(item, field));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => assertObservabilityAggregateCounters(item, key));
  }
}
