import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  compareAnnouncementTime, isAnnouncementUnread, mergeAnnouncementReadState,
  type Announcement, type AnnouncementCursor, type AnnouncementPage, type AnnouncementReadState,
} from '../features/announcements/announcement';

export interface AnnouncementPageSnapshot { page: AnnouncementPage<Announcement>; read: AnnouncementReadState }
type UnreadStatus = 'unknown' | 'unread' | 'read';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// This cache lives with the owner-bound Home bell. It never retains another account's data.
export function useAnnouncementUnread(owner: string, isOpen: boolean) {
  const session = useMemo(() => ({
    active: true, items: new Map<string, Announcement>(), read: { through: null, items: {} } as AnnouncementReadState,
    complete: false, checked: false, lastAttempt: -Infinity, cachedAt: -Infinity,
    cached: null as AnnouncementPageSnapshot | null, pending: null as Promise<AnnouncementPageSnapshot> | null,
  }), [owner]);
  const current = useRef(session); current.current = session;
  const opened = useRef(isOpen); opened.current = isOpen;
  const [result, setResult] = useState<{ session: typeof session; status: UnreadStatus }>({ session, status: 'unknown' });
  const live = useCallback(() => session.active && current.current === session, [session]);
  const update = useCallback(() => {
    if (!live()) return;
    const items = [...session.items.values()];
    const covered = session.read.through && items.every((item) => compareAnnouncementTime(item.publishedAt, session.read.through!) <= 0);
    const status = items.some((item) => isAnnouncementUnread(item, session.read)) ? 'unread'
      : session.checked && (session.complete || covered) ? 'read' : 'unknown';
    setResult({ session, status });
  }, [live, session]);
  const acknowledge = useCallback((read: AnnouncementReadState) => {
    if (!live()) return;
    session.read = mergeAnnouncementReadState(session.read, read); update();
  }, [live, session, update]);
  const loadPage = useCallback((cursor: AnnouncementCursor | null): Promise<AnnouncementPageSnapshot> => {
    if (!live()) return Promise.reject(new Error('ログイン状態が変わりました。'));
    if (!cursor && session.pending) return session.pending;
    if (!cursor && session.cached && Date.now() - session.cachedAt < REFRESH_INTERVAL_MS) {
      return Promise.resolve({ ...session.cached, read: session.read });
    }
    if (!cursor) session.lastAttempt = Date.now();
    const request = (async () => {
      const { listAnnouncements, getAnnouncementReadState } = await import('../services/announcementService');
      if (!live()) throw new Error('ログイン状態が変わりました。');
      const page = await listAnnouncements(owner, cursor);
      if (!live()) throw new Error('ログイン状態が変わりました。');
      const read = await getAnnouncementReadState(owner, page.items);
      if (!live()) throw new Error('ログイン状態が変わりました。');
      for (const item of page.items) {
        const previous = session.items.get(item.id);
        if (!previous || compareAnnouncementTime(item.publishedAt, previous.publishedAt) >= 0) session.items.set(item.id, item);
      }
      session.read = mergeAnnouncementReadState(session.read, read);
      session.checked = true; session.complete = page.nextCursor === null;
      const snapshot = { page, read: session.read };
      if (!cursor) { session.cached = snapshot; session.cachedAt = Date.now(); }
      update(); return snapshot;
    })();
    if (!cursor) {
      session.pending = request;
      void request.finally(() => { if (session.pending === request) session.pending = null; }).catch(() => {});
    }
    return request;
  }, [live, owner, session, update]);
  useEffect(() => {
    session.active = true;
    const refresh = () => {
      if (opened.current || document.visibilityState === 'hidden' || Date.now() - session.lastAttempt < REFRESH_INTERVAL_MS) return;
      void loadPage(null).catch(() => {}); // Failure cannot erase acknowledged or confirmed-unread evidence.
    };
    void loadPage(null).catch(() => {});
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => {
      session.active = false;
      window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadPage, session]);
  return { status: result.session === session ? result.status : 'unknown' as UnreadStatus, loadPage, acknowledge };
}
