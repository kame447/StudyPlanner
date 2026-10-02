// Preserve timetable form conversion: non-finite components fall back to midnight.
// This is not strict HH:mm validation and does not treat an end time of 00:00 as 24:00.
export function timetableTimeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}
