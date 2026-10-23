import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeAppHistory } from '../lib/appHistory';
const KEY = 'laplanceAnnouncements';
interface Entry { owner: string; detailId: string | null }
function current(owner: string): Entry | null {
  const entry = typeof window === 'undefined' ? null : window.history?.state?.[KEY];
  return entry?.owner === owner && (entry.detailId === null || typeof entry.detailId === 'string') ? entry : null;
}
export function useAnnouncementsNavigation(owner: string) {
  const [entry, setEntry] = useState<Entry | null>(() => current(owner));
  const closing = useRef(false);
  useEffect(() => {
    const sync = () => { closing.current = false; setEntry(current(owner)); };
    sync(); return subscribeAppHistory(sync);
  }, [owner]);
  const open = useCallback((detailId: string | null = null) => {
    if (current(owner)?.detailId === detailId) return;
    const next = { owner, detailId };
    window.history.pushState({ ...window.history.state, [KEY]: next }, '');
    closing.current = false; setEntry(next);
  }, [owner]);
  const back = useCallback(() => {
    if (!current(owner)) { setEntry(null); return; }
    if (closing.current) return;
    if (window.history.length > 1) { closing.current = true; window.history.back(); }
    else { const state = { ...window.history.state }; delete state[KEY]; window.history.replaceState(state, ''); setEntry(null); }
  }, [owner]);
  return { isOpen: entry?.owner === owner, detailId: entry?.owner === owner ? entry.detailId : null, open, back };
}
