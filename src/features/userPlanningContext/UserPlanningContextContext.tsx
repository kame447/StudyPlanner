import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  createUserConfirmedPlanningContextRecordV1,
  hydrateUserPlanningContextSnapshotV1,
  loadUserPlanningContextSnapshotV1,
} from './userPlanningContextSpace';
import { getUserPlanningContextRepositoryV1 } from './userPlanningContextRepository';
import { subscribeUserPlanningContextCommittedV1 } from './userPlanningContextSyncEvents';
import type {
  UserPlanningContextRecordV1,
  UserPlanningContextSemanticKindV1,
  UserPlanningContextSnapshotV1,
} from './userPlanningContextTypes';

export interface UserPlanningContextEditorInputV1 {
  existingRecordId?: string | null;
  kind: UserPlanningContextSemanticKindV1;
  label: string;
  value: string;
  dateText?: string | null;
}

export interface UserPlanningContextContextValueV1 {
  snapshot: UserPlanningContextSnapshotV1;
  records: UserPlanningContextRecordV1[];
  loading: boolean;
  syncing: boolean;
  shared: boolean;
  error: string | null;
  saveRecord(input: UserPlanningContextEditorInputV1): Promise<void>;
  removeRecord(recordId: string): Promise<void>;
}

const UserPlanningContextContext = createContext<UserPlanningContextContextValueV1 | null>(null);

function currentDateInJapan(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function userPlanningContextDateTextV1(record: UserPlanningContextRecordV1): string {
  if (!record.dateExpression) return '';
  return record.dateExpression.startsWith('custom:')
    ? record.dateExpression.slice('custom:'.length)
    : record.dateExpression;
}

export function normalizeUserPlanningContextDateTextV1(value: string): string | null {
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return normalized.startsWith('custom:') ? normalized : `custom:${normalized}`;
}

export function UserPlanningContextProvider({
  ownerId,
  children,
}: PropsWithChildren<{ ownerId: string }>) {
  const repository = useMemo(() => getUserPlanningContextRepositoryV1(), []);
  const [snapshot, setSnapshot] = useState<UserPlanningContextSnapshotV1>(() =>
    loadUserPlanningContextSnapshotV1({ ownerId, currentDate: currentDateInJapan() }));
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyRepositoryState = useCallback((next: {
    snapshot: UserPlanningContextSnapshotV1;
    shared: boolean;
  }) => {
    hydrateUserPlanningContextSnapshotV1(next.snapshot);
    setSnapshot(next.snapshot);
    setShared(next.shared);
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribeRemote = () => undefined;
    let unsubscribeCommitted = () => undefined;

    const initialize = async () => {
      const localSnapshot = loadUserPlanningContextSnapshotV1({
        ownerId,
        currentDate: currentDateInJapan(),
      });
      setSnapshot(localSnapshot);
      setLoading(true);
      try {
        const initial = await repository.initialize(ownerId, localSnapshot);
        if (!active) return;
        applyRepositoryState(initial);
        unsubscribeRemote = repository.subscribe(
          ownerId,
          (next) => {
            if (!active) return;
            applyRepositoryState(next);
          },
          (subscriptionError) => {
            if (!active) return;
            setError(subscriptionError.message);
          },
        );
        unsubscribeCommitted = subscribeUserPlanningContextCommittedV1((event) => {
          if (!active || event.ownerId !== ownerId || event.records.length === 0) return;
          setSyncing(true);
          void repository.upsertInferredRecords(ownerId, event.records)
            .then((next) => {
              if (active) applyRepositoryState(next);
            })
            .catch((syncError: unknown) => {
              if (active) {
                setError(syncError instanceof Error ? syncError.message : '長期記憶の同期に失敗しました。');
              }
            })
            .finally(() => {
              if (active) setSyncing(false);
            });
        });
      } catch (initializeError) {
        if (!active) return;
        setShared(false);
        setError(
          initializeError instanceof Error
            ? initializeError.message
            : '長期記憶の同期を開始できませんでした。',
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    void initialize();
    return () => {
      active = false;
      unsubscribeRemote();
      unsubscribeCommitted();
    };
  }, [applyRepositoryState, ownerId, repository]);

  const saveRecord = useCallback(async (input: UserPlanningContextEditorInputV1) => {
    const existing = input.existingRecordId
      ? snapshot.records.find((record) => record.id === input.existingRecordId) ?? null
      : null;
    const dateExpression = input.kind === 'goal_event'
      ? normalizeUserPlanningContextDateTextV1(input.dateText ?? '')
      : null;
    const record = createUserConfirmedPlanningContextRecordV1({
      ownerId,
      kind: input.kind,
      label: input.label,
      value: input.value.trim() || null,
      dateExpression,
      currentDate: currentDateInJapan(),
      existingId: existing?.id,
    });
    setSyncing(true);
    setError(null);
    try {
      const next = await repository.saveUserConfirmedRecord(ownerId, record, existing?.id ?? null);
      applyRepositoryState(next);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '長期記憶を保存できませんでした。';
      setError(message);
      throw new Error(message);
    } finally {
      setSyncing(false);
    }
  }, [applyRepositoryState, ownerId, repository, snapshot.records]);

  const removeRecord = useCallback(async (recordId: string) => {
    setSyncing(true);
    setError(null);
    try {
      const next = await repository.removeRecord(ownerId, recordId);
      applyRepositoryState(next);
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : '長期記憶を削除できませんでした。';
      setError(message);
      throw new Error(message);
    } finally {
      setSyncing(false);
    }
  }, [applyRepositoryState, ownerId, repository]);

  const value = useMemo<UserPlanningContextContextValueV1>(() => ({
    snapshot,
    records: snapshot.records,
    loading,
    syncing,
    shared,
    error,
    saveRecord,
    removeRecord,
  }), [error, loading, removeRecord, saveRecord, shared, snapshot, syncing]);

  if (loading) return null;

  return (
    <UserPlanningContextContext.Provider value={value}>
      {children}
    </UserPlanningContextContext.Provider>
  );
}

export function useUserPlanningContextV1(): UserPlanningContextContextValueV1 {
  const value = useContext(UserPlanningContextContext);
  if (!value) throw new Error('UserPlanningContextProvider is missing.');
  return value;
}

export function useOptionalUserPlanningContextV1(): UserPlanningContextContextValueV1 | null {
  return useContext(UserPlanningContextContext);
}
