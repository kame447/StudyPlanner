import { Bell } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useAnnouncementsNavigation } from '../hooks/useAnnouncementsNavigation';
import { useAnnouncementUnread } from '../hooks/useAnnouncementUnread';
import '../styles/announcement-bell.css';
const AnnouncementsPage = lazy(() => import('./AnnouncementsPage').then((module) => ({ default: module.AnnouncementsPage })));
export function AnnouncementsButton({ userId }: { userId: string }) {
  const navigation = useAnnouncementsNavigation(userId);
  const unread = useAnnouncementUnread(userId, navigation.isOpen);
  return <>
    <button className="home-icon-button announcement-bell" type="button" aria-label="お知らせを開く" title="お知らせ" aria-describedby={unread.status === 'unread' ? 'announcement-bell-unread' : undefined} onClick={(event) => {
      // Touch browsers may not focus a tapped button; retain the non-input opener.
      event.currentTarget.focus({ preventScroll: true });
      navigation.open();
    }}><Bell aria-hidden="true" size={22} />{unread.status === 'unread' && <span className="announcement-bell-dot" role="img" aria-label="未読のお知らせあり" id="announcement-bell-unread" />}</button>
    {navigation.isOpen && <Suspense fallback={null}><AnnouncementsPage key={userId} userId={userId} detailId={navigation.detailId} onOpenDetail={navigation.open} onBack={navigation.back} loadPage={unread.loadPage} onReadAcknowledged={unread.acknowledge} /></Suspense>}
  </>;
}
