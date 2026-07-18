import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WeeklyPlanningWeekStartsOn } from './weeklyPlanningWeek';
import {
  getWeeklyPlanningPersonalizationRepository,
  type WeeklyPlanningPersonalizationRepository,
} from './weeklyPlanningPersonalizationRepository';
import type { WeeklyPlanningPersonalizationProfile } from './weeklyPlanningPersonalizationTypes';

export interface WeeklyPlanningPersonalizationProfileState {
  loading: boolean;
  profile: WeeklyPlanningPersonalizationProfile | null;
  error: string;
  refresh(): Promise<void>;
  setWeekStartsOn(value: WeeklyPlanningWeekStartsOn): Promise<boolean>;
  resetProfile(): Promise<boolean>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : '学習設定を確認できませんでした。';
}

export function useWeeklyPlanningPersonalizationProfile(
  userId: string,
  injectedRepository?: WeeklyPlanningPersonalizationRepository,
): WeeklyPlanningPersonalizationProfileState {
  const defaultRepository = useMemo(
    () => getWeeklyPlanningPersonalizationRepository(),
    [],
  );
  const repository = injectedRepository ?? defaultRepository;
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<WeeklyPlanningPersonalizationProfile | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProfile(await repository.getProfile(userId));
    } catch (caught) {
      setProfile(null);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [repository, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setWeekStartsOn = useCallback(async (value: WeeklyPlanningWeekStartsOn) => {
    setLoading(true);
    setError('');
    try {
      setProfile(await repository.setWeekStartsOn(userId, value));
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setLoading(false);
    }
  }, [repository, userId]);

  const resetProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await repository.resetProfile(userId);
      setProfile(null);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setLoading(false);
    }
  }, [repository, userId]);

  return { loading, profile, error, refresh, setWeekStartsOn, resetProfile };
}
