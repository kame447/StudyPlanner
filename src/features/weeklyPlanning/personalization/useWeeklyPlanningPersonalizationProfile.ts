import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WeeklyPlanningWeekStartsOn } from './weeklyPlanningWeek';
import {
  getWeeklyPlanningPersonalizationRepository,
  type WeeklyPlanningPersonalizationRepository,
} from './weeklyPlanningPersonalizationRepository';
import type { WeeklyPlanningPersonalizationProfile } from './weeklyPlanningPersonalizationTypes';

// Match consent-read recovery UX, not a network SLO or an SDK request timeout.
export const PERSONALIZATION_READ_TIMEOUT_MS = 15_000;

export interface WeeklyPlanningPersonalizationProfileState {
  loading: boolean;
  profile: WeeklyPlanningPersonalizationProfile | null;
  error: string;
  readFailed: boolean;
  refresh(): Promise<void>;
  setWeekStartsOn(value: WeeklyPlanningWeekStartsOn): Promise<boolean>;
  resetProfile(): Promise<boolean>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : '学習設定を確認できませんでした。';
}

async function readProfile(
  repository: WeeklyPlanningPersonalizationRepository,
  userId: string,
  signal: AbortSignal,
) {
  if (signal.aborted) throw signal.reason;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    timeout = setTimeout(() => reject(new Error(
      '学習設定の確認に時間がかかっています。通信状態を確認して、もう一度読み込んでください。',
    )), PERSONALIZATION_READ_TIMEOUT_MS);
  });
  try {
    // Firestore getDoc cannot be aborted. Bound only this consumer's wait;
    // Promise.race also observes late rejection without publishing late results.
    return await Promise.race([repository.getProfile(userId), deadline]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
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
  const scope = useMemo(() => ({
    active: false,
    read: null as AbortController | null,
    readConfirmed: false,
    writing: false,
  }), [repository, userId]);
  const [state, setState] = useState({
    scope, loading: true, profile: null as WeeklyPlanningPersonalizationProfile | null,
    error: '', readFailed: false,
  });

  const refresh = useCallback(async () => {
    if (!scope.active || scope.writing) return;
    scope.read?.abort();
    const request = new AbortController();
    scope.read = request;
    scope.readConfirmed = false;
    const isCurrent = () => scope.active && scope.read === request && !request.signal.aborted;
    setState({ scope, loading: true, profile: null, error: '', readFailed: false });
    try {
      const profile = await readProfile(repository, userId, request.signal);
      if (!isCurrent()) return;
      scope.readConfirmed = true;
      setState({ scope, loading: false, profile, error: '', readFailed: false });
    } catch (caught) {
      if (!isCurrent()) return;
      setState({ scope, loading: false, profile: null, error: errorMessage(caught), readFailed: true });
    } finally {
      if (scope.read === request) scope.read = null;
    }
  }, [repository, scope, userId]);

  useEffect(() => {
    scope.active = true;
    void refresh();
    return () => {
      scope.active = false;
      scope.readConfirmed = false;
      scope.read?.abort();
      scope.read = null;
    };
  }, [refresh, scope]);

  const mutate = useCallback(async (operation: () => Promise<WeeklyPlanningPersonalizationProfile | null>) => {
    // A failed/unfinished read is not permission to overwrite an unknown profile.
    if (!scope.active || !scope.readConfirmed || scope.read || scope.writing) return false;
    scope.writing = true;
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const profile = await operation();
      if (!scope.active) return false;
      setState({ scope, loading: false, profile, error: '', readFailed: false });
      return true;
    } catch (caught) {
      if (!scope.active) return false;
      setState(previous => ({ ...previous, loading: false, error: errorMessage(caught) }));
      return false;
    } finally {
      scope.writing = false;
    }
  }, [scope]);

  const setWeekStartsOn = useCallback((value: WeeklyPlanningWeekStartsOn) => (
    mutate(() => repository.setWeekStartsOn(userId, value))
  ), [mutate, repository, userId]);

  const resetProfile = useCallback(() => mutate(async () => {
    await repository.resetProfile(userId);
    return null;
  }), [mutate, repository, userId]);

  // Never expose a prior owner's settings during the render before effect cleanup.
  const current = state.scope === scope ? state : {
    loading: true, profile: null, error: '', readFailed: false,
  };
  return { loading: current.loading, profile: current.profile, error: current.error,
    readFailed: current.readFailed, refresh, setWeekStartsOn, resetProfile };
}
