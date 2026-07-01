export function formatHourTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function parseHour(segment: string): number | undefined {
  const match = segment.match(/(\d{1,2})\s*\u6642/);

  if (!match) {
    return undefined;
  }

  const hour = Number(match[1]);
  return hour >= 0 && hour <= 24 ? hour : undefined;
}

export function parseClockTime(segment: string): string | undefined {
  const hour = parseHour(segment);
  return hour === undefined ? undefined : formatHourTime(hour);
}