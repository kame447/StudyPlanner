import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildStudyStreakModel, studyRestDayBlockReason } from '../lib/studyStreak';
import type { StudyHistoryHint, StudyStreakHistory, StudyStreakRepository } from '../repositories/studyStreakRepository';

type HistoryState = { hint?: StudyHistoryHint } & (
  | { status: 'loading'; userId: string; history: null }
  | { status: 'ready'; userId: string; history: StudyStreakHistory }
  | { status: 'error'; userId: string; history: null; message: string });

export function useStudyStreak(userId: string, today: string, repository: StudyStreakRepository, hint?: StudyHistoryHint) {
  const [state, setState] = useState<HistoryState>({ status: 'loading', userId, history: null, hint });
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lifetime = useRef(0);
  const mounted = useRef(false);
  const pending = useRef<number | null>(null);
  const hintRef = useRef(hint);
  hintRef.current = hint;
  useEffect(() => {
    const epoch = ++lifetime.current;
    mounted.current = true;
    const readHint = hintRef.current;
    setState({ status: 'loading', userId, history: null, hint: readHint });
    setSaving(false);
    setSaveError(null);
    pending.current = null;
    void repository.read(userId, { hint: readHint, refresh: revision > 0 }).then(history => {
      if (epoch === lifetime.current) {
        if (history.userId !== userId || !history.historyComplete) throw new Error('学習履歴を確認できませんでした。');
        setState({ status: 'ready', userId, history, hint: readHint });
      }
    }).catch(error => {
      if (epoch === lifetime.current) setState({ status: 'error', userId, history: null, hint: readHint,
        message: error instanceof Error ? error.message : '学習履歴を読み込めませんでした。' });
    });
    return () => { mounted.current = false; lifetime.current += 1; };
  }, [userId, repository, revision, hint?.plans, hint?.actuals]);
  const matchesInput = state.userId === userId && state.hint?.plans === hint?.plans && state.hint?.actuals === hint?.actuals;
  const history = matchesInput && state.status === 'ready' ? state.history : null;
  const committed = useRef({ userId, repository, history });
  useLayoutEffect(() => { committed.current = { userId, repository, history }; });
  const model = useMemo(() => history ? buildStudyStreakModel({ ...history, today }) : null, [history, today]);
  const useRestDay = useCallback(async (date: string): Promise<boolean> => {
    if (!mounted.current || !history || !repository.canUseRestDays || pending.current !== null
      || committed.current.userId !== userId || committed.current.repository !== repository
      || committed.current.history !== history) return false;
    const reason = studyRestDayBlockReason({ ...history, today }, date);
    if (reason) { setSaveError(reason); return false; }
    const epoch = lifetime.current;
    pending.current = epoch;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await repository.useRestDay(history, date, today);
      if (epoch !== lifetime.current || next.userId !== userId || committed.current.history !== history) return false;
      setState({ status: 'ready', userId, history: next, hint: hintRef.current });
      return true;
    } catch (error) {
      if (epoch === lifetime.current) setSaveError(error instanceof Error ? error.message : 'お休みチケットを保存できませんでした。');
      return false;
    } finally {
      if (epoch === lifetime.current) {
        pending.current = null;
        setSaving(false);
      }
    }
  }, [history, repository, today, userId]);
  return {
    status: matchesInput ? state.status : 'loading' as const,
    model, saving: matchesInput && saving,
    readError: matchesInput && state.status === 'error' ? state.message : null,
    saveError: matchesInput ? saveError : null,
    canUseRestDays: Boolean(history && repository.canUseRestDays),
    useRestDay,
    blockReason: (date: string) => history ? studyRestDayBlockReason({ ...history, today }, date) : '学習履歴を確認中です。',
    retry: () => setRevision(value => value + 1),
  };
}
