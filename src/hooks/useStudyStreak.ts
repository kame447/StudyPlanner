import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildStudyStreakModel, nextAutomaticStudyRestDate } from '../lib/studyStreak';
import type { StudyHistoryHint, StudyStreakHistory, StudyStreakRepository } from '../repositories/studyStreakRepository';

type HistoryState = {
  userId: string;
  repository: StudyStreakRepository;
  hint?: StudyHistoryHint;
  history: StudyStreakHistory | null;
  refreshing: boolean;
  readError: string | null;
};

export function useStudyStreak(userId: string, today: string, repository: StudyStreakRepository, hint?: StudyHistoryHint, active = true) {
  const [state, setState] = useState<HistoryState>(() => ({ userId, repository, hint,
    history: repository.peek?.(userId, hint) ?? null, refreshing: true, readError: null }));
  const [request, setRequest] = useState({ revision: 0, force: false });
  const confirmedRetry = useRef<typeof request | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lifetime = useRef(0);
  const pendingController = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const committed = useRef({ userId, today, repository, hint, active });
  useLayoutEffect(() => { committed.current = { userId, today, repository, hint, active }; });
  // Revoke automatic writes at commit, before a pending read/transaction can
  // resume in the gap before passive cleanup. Reads still start passively.
  useLayoutEffect(() => () => {
    lifetime.current += 1;
    pendingController.current?.abort();
  }, [userId, today, repository, hint?.plans, hint?.actuals, hint?.monthEvents, request, active]);
  const matches = (previous: HistoryState) => previous.userId === userId && previous.repository === repository
    && previous.hint?.plans === hint?.plans && previous.hint?.actuals === hint?.actuals && previous.hint?.monthEvents === hint?.monthEvents;
  const matchesInput = matches(state);
  const history = matchesInput ? state.history : null;
  const model = useMemo(() => history ? buildStudyStreakModel({ ...history, today }) : null, [history, today]);

  useEffect(() => {
    const epoch = ++lifetime.current;
    if (!active) {
      busy.current = false;
      setSaving(false);
      setState(previous => ({ ...previous, refreshing: false }));
      return;
    }
    const controller = new AbortController();
    pendingController.current = controller;
    busy.current = true;
    const current = () => committed.current.active && epoch === lifetime.current && !controller.signal.aborted
      && committed.current.userId === userId && committed.current.repository === repository
      && committed.current.today === today && committed.current.hint?.plans === hint?.plans
      && committed.current.hint?.actuals === hint?.actuals && committed.current.hint?.monthEvents === hint?.monthEvents;
    setState(previous => ({ userId, repository, hint,
      history: matches(previous) ? previous.history : repository.peek?.(userId, hint) ?? null,
      refreshing: true, readError: null }));
    setSaving(false);
    setSaveError(null);
    void (async () => {
      let accepted: StudyStreakHistory;
      try {
        accepted = await repository.read(userId, { hint, today, refresh: request.force && confirmedRetry.current !== request });
        if (!current()) return;
        if (accepted.userId !== userId || !accepted.historyComplete || !Array.isArray(accepted.monthEvents)) throw new Error('学習履歴を確認できませんでした。');
        // A successful explicit confirmation satisfies this retry only. Later
        // input changes use normal owner/day/generation validation again.
        if (request.force) confirmedRetry.current = request;
        setState({ userId, repository, hint, history: accepted, refreshing: true, readError: null });
      } catch (error) {
        if (current()) setState(previous => ({ ...previous, refreshing: false,
          readError: error instanceof Error ? error.message : '学習履歴を読み込めませんでした。' }));
        return;
      }
      try {
        if (!repository.canUseRestDays && nextAutomaticStudyRestDate({ ...accepted, today })) {
          throw new Error('このブラウザーではお休みチケットを安全に保存できません。');
        }
        if (repository.canUseRestDays) {
          let date: string | null;
          while (current() && (date = nextAutomaticStudyRestDate({ ...accepted, today }))) {
            setSaving(true);
            const next = await repository.useRestDay(accepted, date, today, { signal: controller.signal });
            if (!current()) return;
            if (next.userId !== userId || !next.historyComplete || !Array.isArray(next.monthEvents) || !next.restDays.some(day => day.date === date)) {
              throw new Error('お休みチケットの保存を確認できませんでした。');
            }
            accepted = next;
            setState({ userId, repository, hint, history: accepted, refreshing: true, readError: null });
          }
        }
      } catch (error) {
        if (current()) setSaveError(error instanceof Error ? error.message : 'お休みチケットを保存できませんでした。');
      } finally {
        if (current()) {
          setSaving(false);
          setState(previous => ({ ...previous, refreshing: false }));
        }
      }
    })().finally(() => { if (epoch === lifetime.current) busy.current = false; });
    return () => {
      controller.abort();
      if (pendingController.current === controller) pendingController.current = null;
      lifetime.current += 1;
      busy.current = false;
    };
  }, [userId, today, repository, hint?.plans, hint?.actuals, hint?.monthEvents, request, active]);

  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof document === 'undefined'
      || !window.addEventListener || !document.addEventListener) return;
    const resume = () => {
      if (document.visibilityState !== 'hidden' && !busy.current) {
        setRequest(previous => ({ revision: previous.revision + 1, force: false }));
      }
    };
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [active]);
  const retry = useCallback(() => setRequest(previous => ({ revision: previous.revision + 1, force: true })), []);
  return {
    status: history ? 'ready' as const : matchesInput && state.readError ? 'error' as const : 'loading' as const,
    model, refreshing: active && (!matchesInput || state.refreshing), saving: matchesInput && saving,
    readError: matchesInput ? state.readError : null, saveError: matchesInput ? saveError : null, retry,
  };
}

export type StudyStreakController = ReturnType<typeof useStudyStreak>;
