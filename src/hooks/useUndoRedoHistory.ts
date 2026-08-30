import { useCallback, useRef, useState } from 'react';

export interface UndoRedoHistoryEntry<TKey, TValue> {
  key: TKey;
  before: TValue;
  after: TValue;
}

interface UndoRedoHistoryOptions {
  limit?: number;
}

export function useUndoRedoHistory<TKey, TValue>(
  options: UndoRedoHistoryOptions = {},
) {
  const limit = Math.max(1, Math.round(options.limit ?? 40));
  const undoStackRef = useRef<Array<UndoRedoHistoryEntry<TKey, TValue>>>([]);
  const redoStackRef = useRef<Array<UndoRedoHistoryEntry<TKey, TValue>>>([]);
  const busyRef = useRef(false);
  const [isBusy, setIsBusy] = useState(false);
  const [, forceRender] = useState(0);

  const refresh = useCallback(() => {
    forceRender((current) => current + 1);
  }, []);

  const record = useCallback(
    (entry: UndoRedoHistoryEntry<TKey, TValue>) => {
      undoStackRef.current = [...undoStackRef.current, entry].slice(-limit);
      redoStackRef.current = [];
      refresh();
    },
    [limit, refresh],
  );

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    refresh();
  }, [refresh]);

  const undo = useCallback(
    async (
      apply: (
        entry: UndoRedoHistoryEntry<TKey, TValue>,
        target: TValue,
      ) => void | Promise<void>,
    ) => {
      if (busyRef.current) return false;
      const entry = undoStackRef.current[undoStackRef.current.length - 1];
      if (!entry) return false;

      busyRef.current = true;
      setIsBusy(true);
      try {
        await apply(entry, entry.before);
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        redoStackRef.current = [...redoStackRef.current, entry].slice(-limit);
        refresh();
        return true;
      } finally {
        busyRef.current = false;
        setIsBusy(false);
      }
    },
    [limit, refresh],
  );

  const redo = useCallback(
    async (
      apply: (
        entry: UndoRedoHistoryEntry<TKey, TValue>,
        target: TValue,
      ) => void | Promise<void>,
    ) => {
      if (busyRef.current) return false;
      const entry = redoStackRef.current[redoStackRef.current.length - 1];
      if (!entry) return false;

      busyRef.current = true;
      setIsBusy(true);
      try {
        await apply(entry, entry.after);
        redoStackRef.current = redoStackRef.current.slice(0, -1);
        undoStackRef.current = [...undoStackRef.current, entry].slice(-limit);
        refresh();
        return true;
      } finally {
        busyRef.current = false;
        setIsBusy(false);
      }
    },
    [limit, refresh],
  );

  return {
    record,
    clear,
    undo,
    redo,
    isBusy,
    hasHistory: undoStackRef.current.length > 0 || redoStackRef.current.length > 0,
    canUndo: undoStackRef.current.length > 0 && !isBusy,
    canRedo: redoStackRef.current.length > 0 && !isBusy,
  };
}
