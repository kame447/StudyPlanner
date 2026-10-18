import { createContext, useContext, type ReactNode } from 'react';
import type { WeeklyPlanningWeekStartsOn } from './weeklyPlanningWeek';
import type { WeeklyPlanningPersonalizationProfile } from './weeklyPlanningPersonalizationTypes';

interface WeeklyPlanningPersonalizationContextValue {
  profile: WeeklyPlanningPersonalizationProfile | null;
  weekStartsOn: WeeklyPlanningWeekStartsOn;
  saving: boolean;
  error: string;
  setWeekStartsOn(value: WeeklyPlanningWeekStartsOn): Promise<boolean>;
  resetProfile(): Promise<boolean>;
}

const DEFAULT_VALUE: WeeklyPlanningPersonalizationContextValue = {
  profile: null,
  weekStartsOn: 'monday',
  saving: false,
  error: '',
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
  saving = false,
  error = '',
  setWeekStartsOn,
  resetProfile,
  children,
}: {
  profile: WeeklyPlanningPersonalizationProfile;
  saving?: boolean;
  error?: string;
  setWeekStartsOn(value: WeeklyPlanningWeekStartsOn): Promise<boolean>;
  resetProfile(): Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <WeeklyPlanningPersonalizationContext.Provider
      value={{
        profile,
        weekStartsOn: profile.weekStartsOn?.value ?? 'monday',
        saving,
        error,
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
