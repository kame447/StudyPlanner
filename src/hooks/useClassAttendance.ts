import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttendanceStatus, ClassAttendance } from '../domain/classAttendance';
import type { ClassAttendanceRepository } from '../repositories/classAttendanceRepository';

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
  useEffect(() => {
    const revision = ++lifetime.current;
    setState({ kind: 'loading', records: [] });
    setSaveError(null);
    void repository.list(userId, templateId).then(records => {
      if (revision === lifetime.current) setState({ kind: 'ready', records });
    }, () => {
      if (revision === lifetime.current) setState({ kind: 'error', records: [], message: '出欠を読み込めませんでした。' });
    });
    return () => { lifetime.current += 1; };
  }, [userId, templateId, repository, loadRevision]);

  const save = useCallback(async (date: string, status: AttendanceStatus): Promise<boolean> => {
    if (pending.current || state.kind !== 'ready') return false;
    pending.current = true;
    const revision = lifetime.current;
    setSaving(true);
    setSaveError(null);
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
      pending.current = false;
      if (revision === lifetime.current) setSaving(false);
    }
  }, [userId, templateId, repository, state.kind]);
  return { ...state, saving, saveError, save, retry: () => setLoadRevision(value => value + 1) };
}
