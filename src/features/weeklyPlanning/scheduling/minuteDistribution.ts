export function roundToPlanningQuantum(minutes: number, quantumMinutes = 5): number {
  return Math.round(minutes / quantumMinutes) * quantumMinutes;
}

export function distributeMinutesAcrossBuckets(
  totalMinutes: number,
  bucketCount: number,
  quantumMinutes = 5,
): number[] {
  const safeBucketCount = Math.max(1, bucketCount);
  const roundedAverage = roundToPlanningQuantum(totalMinutes / safeBucketCount, quantumMinutes);
  const buckets = Array.from({ length: safeBucketCount }, () => roundedAverage);
  let deltaMinutes = totalMinutes - buckets.reduce((sum, minutes) => sum + minutes, 0);
  let cursor = 0;

  while (Math.abs(deltaMinutes) >= quantumMinutes && buckets.length > 0) {
    const step = deltaMinutes > 0 ? quantumMinutes : -quantumMinutes;
    buckets[cursor] += step;
    deltaMinutes -= step;
    cursor = (cursor + 1) % buckets.length;
  }

  if (deltaMinutes !== 0 && buckets.length > 0) {
    buckets[buckets.length - 1] += deltaMinutes;
  }

  return buckets.sort((left, right) => right - left);
}
