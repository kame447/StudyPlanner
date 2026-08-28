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
  normalizeUserPlanningContextDateInputV1,
  userPlanningContextDateEditorTextV1,
} from './userPlanningContextDateExpression';
import {
  createUserConfirmedPlanningContextRecordV1,
  hydrateUserPlanningContextSnapshotV1,
  isUserPlanningContextVisibleV1,
  loadUserPlanningContextSnapshotV1,
} from './userPlanningContextSpace';
import {
  interpretUserPlanningContextNaturalLanguageV2,
  userPlanningContextExternalOwnerMessageV2,
} from './userPlanningContextNaturalLanguageV2';
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

export interface UserPlanningContextNaturalLanguageInputV2 {
  existingRecordId?: string | null;
  text: string;
}

export interface UserPlanningContextContextValueV1 {
  snapshot: UserPlanningContextSnapshotV1;
  records: UserPlanningContextRecordV1[];
  loading: boolean;
  syncing: boolean;
  shared: boolean;
  error: string | null;
  saveRecord(input: UserPlanningContextEditorInputV1): Promise<void>;
  saveNaturalLanguage(input: UserPlanningContextNaturalLanguageInputV2): Promise<void>;
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

function reportSyncFailure(error: unknown, action: string): string {
  console.error(`[UserPlanningContext] ${action}`, error);
  return 'AIが覚えている情報を同期できませんでした。';
}

export function userPlanningContextDateTextV1(record: UserPlanningContextRecordV1): string {
  return userPlanningContextDateEditorTextV1(record.dateExpression);
}

export function normalizeUserPlanningContextDateTextV1(value: string): string | null {
  return normalizeUserPlanningContextDateInputV1(value);
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
    setSnapshot(loadUserPlanningContextSnapshotV1({
      ownerId: next.snapshot.ownerId,
      currentDate: currentDateInJapan(),
    }));
    setShared(next.shared);
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribeRemote: () => void = () => undefined;
    let unsubscribeCommitted: () => void = () => undefined;

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
            setError(reportSyncFailure(subscriptionError, 'subscription failed'));
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
              if (active) setError(reportSyncFailure(syncError, 'semantic context sync failed'));
            })
            .finally(() => {
              if (active) setSyncing(false);
            });
        });
      } catch (initializeError) {
        if (!active) return;
        setShared(false);
        setError(reportSyncFailure(initializeError, 'initialization failed'));
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
      const message = reportSyncFailure(saveError, 'legacy settings save failed');
      setError(message);
      throw new Error(message);
    } finally {
      setSyncing(false);
    }
  }, [applyRepositoryState, ownerId, repository, snapshot.records]);

  const saveNaturalLanguage = useCallback(async (input: UserPlanningContextNaturalLanguageInputV2) => {
    const existing = input.existingRecordId
      ? snapshot.records.find((record) => record.id === input.existingRecordId) ?? null
      : null;
    setSyncing(true);
    setError(null);
    try {
      const interpreted = await interpretUserPlanningContextNaturalLanguageV2({
        text: input.text,
        existingRecord: existing,
      });
      if (interpreted.targetDomain !== 'user_context') {
        throw new Error(userPlanningContextExternalOwnerMessageV2(interpreted.targetDomain));
      }
      if (!interpreted.kind || !interpreted.label) {
        throw new Error('AIが覚える内容を整理できませんでした。');
      }
      const record = createUserConfirmedPlanningContextRecordV1({
        ownerId,
        kind: interpreted.kind,
        label: interpreted.label,
        value: interpreted.value,
        dateExpression: interpreted.dateExpression,
        currentDate: currentDateInJapan(),
        sourceText: interpreted.displayText,
        existingId: existing?.id,
      });
      try {
        const next = await repository.saveUserConfirmedRecord(ownerId, record, existing?.id ?? null);
        applyRepositoryState(next);
      } catch (saveError) {
        const message = reportSyncFailure(saveError, 'natural-language settings save failed');
        setError(message);
        throw new Error(message);
      }
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
      const message = reportSyncFailure(removeError, 'forget failed');
      setError(message);
      throw new Error(message);
    } finally {
      setSyncing(false);
    }
  }, [applyRepositoryState, ownerId, repository]);

  const visibleRecords = useMemo(
    () => snapshot.records.filter(isUserPlanningContextVisibleV1),
    [snapshot.records],
  );

  const value = useMemo<UserPlanningContextContextValueV1>(() => ({
    snapshot,
    records: visibleRecords,
    loading,
    syncing,
    shared,
    error,
    saveRecord,
    saveNaturalLanguage,
    removeRecord,
  }), [error, loading, removeRecord, saveNaturalLanguage, saveRecord, shared, snapshot, syncing, visibleRecords]);

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
