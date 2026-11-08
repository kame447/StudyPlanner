import { createContext, useContext, type ReactNode } from 'react';
import type { WeeklyPlanningWeekStartsOn } from './weeklyPlanningWeek';
import type { DefaultStudyMode, WeeklyPlanningPersonalizationProfile } from './weeklyPlanningPersonalizationTypes';

interface WeeklyPlanningPersonalizationContextValue {
  profile: WeeklyPlanningPersonalizationProfile | null;
  weekStartsOn: WeeklyPlanningWeekStartsOn;
  /** The saved default study mode; the normal timer when nothing is saved. */
  defaultStudyMode: DefaultStudyMode;
  saving: boolean;
  error: string;
  setWeekStartsOn(value: WeeklyPlanningWeekStartsOn): Promise<boolean>;
  setDefaultStudyMode(value: DefaultStudyMode): Promise<boolean>;
  resetProfile(): Promise<boolean>;
}

export const NORMAL_DEFAULT_STUDY_MODE: DefaultStudyMode = { mode: 'normal', pomodoro: { preset: '25-5' } };

const DEFAULT_VALUE: WeeklyPlanningPersonalizationContextValue = {
  profile: null,
  weekStartsOn: 'monday',
  defaultStudyMode: NORMAL_DEFAULT_STUDY_MODE,
  saving: false,
  error: '',
  async setWeekStartsOn() {
    return false;
  },
  async setDefaultStudyMode() {
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
  setDefaultStudyMode,
  resetProfile,
  children,
}: {
  profile: WeeklyPlanningPersonalizationProfile;
  saving?: boolean;
  error?: string;
  setWeekStartsOn(value: WeeklyPlanningWeekStartsOn): Promise<boolean>;
  setDefaultStudyMode(value: DefaultStudyMode): Promise<boolean>;
  resetProfile(): Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <WeeklyPlanningPersonalizationContext.Provider
      value={{
        profile,
        weekStartsOn: profile.weekStartsOn?.value ?? 'monday',
        defaultStudyMode: profile.defaultStudyMode?.value ?? NORMAL_DEFAULT_STUDY_MODE,
        saving,
        error,
        setWeekStartsOn,
        setDefaultStudyMode,
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
