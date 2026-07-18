import { createContext, useContext, type ReactNode } from 'react';
import type { WeeklyPlanningWeekStartsOn } from './weeklyPlanningWeek';
import type { WeeklyPlanningPersonalizationProfile } from './weeklyPlanningPersonalizationTypes';

interface WeeklyPlanningPersonalizationContextValue {
  profile: WeeklyPlanningPersonalizationProfile | null;
  weekStartsOn: WeeklyPlanningWeekStartsOn;
  setWeekStartsOn(value: WeeklyPlanningWeekStartsOn): Promise<boolean>;
  resetProfile(): Promise<boolean>;
}

const DEFAULT_VALUE: WeeklyPlanningPersonalizationContextValue = {
  profile: null,
  weekStartsOn: 'monday',
  async setWeekStartsOn() {
    return false;
  },
  async resetProfile() {
    return false;
  },
};

const WeeklyPlanningPersonalizationContext = createContext(DEFAULT_VALUE);

export function WeeklyPlanningPersonalizationProvider({
  profile,
  setWeekStartsOn,
  resetProfile,
  children,
}: {
  profile: WeeklyPlanningPersonalizationProfile;
  setWeekStartsOn(value: WeeklyPlanningWeekStartsOn): Promise<boolean>;
  resetProfile(): Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <WeeklyPlanningPersonalizationContext.Provider
      value={{
        profile,
        weekStartsOn: profile.weekStartsOn?.value ?? 'monday',
        setWeekStartsOn,
        resetProfile,
      }}
    >
      {children}
    </WeeklyPlanningPersonalizationContext.Provider>
  );
}

export function useWeeklyPlanningPersonalization(): WeeklyPlanningPersonalizationContextValue {
  return useContext(WeeklyPlanningPersonalizationContext);
}
