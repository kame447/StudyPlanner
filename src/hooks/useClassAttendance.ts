import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AttendanceStatus, ClassAttendance } from '../domain/classAttendance';
import type { ClassAttendanceRepository } from '../repositories/classAttendanceRepository';

// A detail may be closed while its admitted write is still settling. Keep only
// those pending operations, never history, so a reopened detail reads afterward.
const pendingSaves = new WeakMap<ClassAttendanceRepository, Map<string, Set<Promise<void>>>>();
const saveScope = (userId: string, templateId: string) => JSON.stringify([userId, templateId]);

function beginSave(repository: ClassAttendanceRepository, userId: string, templateId: string) {
  let scopes = pendingSaves.get(repository);
  if (!scopes) pendingSaves.set(repository, scopes = new Map());
  const key = saveScope(userId, templateId);
  let saves = scopes.get(key);
  if (!saves) scopes.set(key, saves = new Set());
  let settle!: () => void;
  const pending = new Promise<void>(resolve => { settle = resolve; });
  saves.add(pending);
  return () => {
    saves.delete(pending);
    if (saves.size === 0) scopes.delete(key);
    if (scopes.size === 0) pendingSaves.delete(repository);
    settle();
  };
}

type LoadState =
  | { kind: 'loading'; records: ClassAttendance[] }
  | { kind: 'ready'; records: ClassAttendance[] }
  | { kind: 'error'; records: ClassAttendance[]; message: string };

export function useClassAttendance(userId: string, templateId: string, repository: ClassAttendanceRepository) {
  const [state, setState] = useState<LoadState>({ kind: 'loading', records: [] });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const lifetime = useRef(0);
  const pending = useRef(false);
  // Retire delayed reads at commit, before a save continuation can run ahead of
  // passive cleanup. Loading itself remains in the passive effect below.
  useLayoutEffect(() => () => { lifetime.current += 1; }, [userId, templateId, repository]);
  useEffect(() => {
    const revision = ++lifetime.current;
    setState({ kind: 'loading', records: [] });
    setSaveError(null);
    void (async () => {
      try {
        let saves: Set<Promise<void>> | undefined;
        while ((saves = pendingSaves.get(repository)?.get(saveScope(userId, templateId)))?.size) {
          await Promise.all(saves);
          if (revision !== lifetime.current) return;
        }
        if (revision !== lifetime.current) return;
        const records = await repository.list(userId, templateId);
        if (revision === lifetime.current) setState({ kind: 'ready', records });
      } catch {
        if (revision === lifetime.current) setState({ kind: 'error', records: [], message: '出欠を読み込めませんでした。' });
      }
    })();
    return () => { lifetime.current += 1; };
  }, [userId, templateId, repository, loadRevision]);

  const save = useCallback(async (date: string, status: AttendanceStatus): Promise<boolean> => {
    if (pending.current || state.kind !== 'ready') return false;
    pending.current = true;
    const revision = lifetime.current;
    setSaving(true);
    setSaveError(null);
    const finishSave = beginSave(repository, userId, templateId);
    try {
      const record = await repository.save({ userId, templateId, date, status });
      if (revision !== lifetime.current) return false;
      setState(current => ({ kind: 'ready', records: [...current.records.filter(row => row.date !== record.date), record]
        .sort((a, b) => b.date.localeCompare(a.date)) }));
      return true;
    } catch (error) {
      if (revision === lifetime.current) setSaveError(error instanceof Error ? error.message : '出欠を保存できませんでした。');
      return false;
    } finally {
      finishSave();
      pending.current = false;
      if (revision === lifetime.current) setSaving(false);
    }
  }, [userId, templateId, repository, state.kind]);
  return { ...state, saving, saveError, save, retry: () => setLoadRevision(value => value + 1) };
}
