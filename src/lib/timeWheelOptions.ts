export type TimePickerRole = 'start' | 'end';

export const MINUTES_PER_DAY = 24 * 60;
const MINUTE_STEP = 5;

export function clampPickerMinutes(
  minutes: number,
  role: TimePickerRole,
  minMinutes = 0,
): number {
  const maxMinutes = role === 'end' ? MINUTES_PER_DAY : MINUTES_PER_DAY - 1;
  return Math.min(Math.max(minutes, minMinutes), maxMinutes);
}

export function buildHourOptions(role: TimePickerRole, minMinutes = 0): number[] {
  const maxHour = role === 'end' ? 24 : 23;
  const minHour = role === 'end' ? Math.floor(minMinutes / 60) : 0;

  const hours = Array.from(
    { length: maxHour - minHour + 1 },
    (_, index) => minHour + index,
  );

  if (role === 'start') {
    return hours;
  }

  return hours.filter(
    (hour) => buildMinuteOptions(hour, role, minMinutes).length > 0,
  );
}

export function buildMinuteOptions(
  hour: number,
  role: TimePickerRole,
  minMinutes = 0,
): number[] {
  if (role === 'end' && hour === 24) {
    return [0];
  }

  const hourStartMinutes = hour * 60;
  const minMinute =
    role === 'end' && Math.floor(minMinutes / 60) === hour
      ? Math.ceil((minMinutes - hourStartMinutes) / MINUTE_STEP) * MINUTE_STEP
      : 0;

  if (minMinute >= 60) {
    return [];
  }

  return Array.from(
    { length: Math.floor((60 - minMinute - 1) / MINUTE_STEP) + 1 },
    (_, index) => minMinute + index * MINUTE_STEP,
  );
}

export function normalizeToWheelMinutes(
  minutes: number,
  role: TimePickerRole,
  normalizedMinMinutes: number,
): number {
  const clampedMinutes = clampPickerMinutes(
    minutes,
    role,
    normalizedMinMinutes,
  );
  const hours = buildHourOptions(role, normalizedMinMinutes);
  const rawHour = Math.floor(clampedMinutes / 60);
  const nextHour = hours.includes(rawHour)
    ? rawHour
    : hours.find((hour) => hour > rawHour) ?? hours[hours.length - 1];
  const minuteOptionsForHour = buildMinuteOptions(
    nextHour,
    role,
    normalizedMinMinutes,
  );
  const rawMinute = nextHour === rawHour ? clampedMinutes % 60 : 0;
  const nextMinute = minuteOptionsForHour.includes(rawMinute)
    ? rawMinute
    : minuteOptionsForHour.find((minute) => minute > rawMinute) ??
      minuteOptionsForHour[0];

  return clampPickerMinutes(
    nextHour * 60 + nextMinute,
    role,
    normalizedMinMinutes,
  );
}
