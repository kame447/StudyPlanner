import { Bell } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useAnnouncementsNavigation } from '../hooks/useAnnouncementsNavigation';
const AnnouncementsPage = lazy(() => import('./AnnouncementsPage').then((module) => ({ default: module.AnnouncementsPage })));
export function AnnouncementsButton({ userId }: { userId: string }) {
  const navigation = useAnnouncementsNavigation(userId);
  return <>
    <button className="home-icon-button" type="button" aria-label="お知らせを開く" title="お知らせ" onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); navigation.open(); }}><Bell aria-hidden="true" size={22} /></button>
    {navigation.isOpen && <Suspense fallback={<p role="status">お知らせを開いています</p>}><AnnouncementsPage key={userId} userId={userId} detailId={navigation.detailId} onOpenDetail={navigation.open} onBack={navigation.back} /></Suspense>}
  </>;
}
