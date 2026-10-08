import { useTimetableDisplayPreference } from './useTimetableDisplayPreference';

export function useMonthTimetablePreference(ownerId?: string) {
  return useTimetableDisplayPreference('month', ownerId);
}
