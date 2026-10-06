import { useCallback, useLayoutEffect, useRef } from 'react';

// A requested write may finish after closing an editor. Only its original,
// still-mounted editor may react to the result; never affect a later session.
export function useEditorMutation() {
  const session = useRef<object | null>(null);
  const pending = useRef<object | null>(null);
  useLayoutEffect(() => {
    session.current = {};
    return () => { session.current = null; pending.current = null; };
  }, []);
  return useCallback(() => {
    const owner = session.current;
    if (!owner || pending.current) return null;
    const operation = {};
    pending.current = operation;
    const isCurrent = () => session.current === owner && pending.current === operation;
    return {
      isCurrent,
      finish() {
        if (!isCurrent()) return false;
        pending.current = null;
        return true;
      },
    };
  }, []);
}
