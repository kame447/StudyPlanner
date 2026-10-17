import { Bell } from 'lucide-react';
import { Component, lazy, Suspense, useId, useLayoutEffect, useRef, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { useAnnouncementsNavigation } from '../hooks/useAnnouncementsNavigation';
import { useAnnouncementUnread } from '../hooks/useAnnouncementUnread';
import { useDialogFocus } from '../hooks/useDialogFocus';
import '../styles/announcement-bell.css';
const AnnouncementsPage = lazy(() => import('./AnnouncementsPage').then((module) => ({ default: module.AnnouncementsPage })));

interface FailureNavigation { detailId: string | null; onBack: () => void }

function AnnouncementLoadFailure({ detailId, onBack }: FailureNavigation) {
  const titleId = useId();
  const { dialogRef: dialog } = useDialogFocus<HTMLDialogElement>(true, onBack);
  const back = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    back.current?.focus({ preventScroll: true });
    return () => { element?.close(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="modal-card announcement-load-failure" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onBack(); }}>
    <h1 id={titleId}>お知らせ</h1>
    <p role="alert">お知らせを読み込めませんでした。</p>
    <button ref={back} type="button" className="ghost-button" onClick={onBack}>
      {detailId ? 'お知らせ一覧へ戻る' : 'ホームへ戻る'}
    </button>
  </dialog>, document.body);
}

class AnnouncementLoadBoundary extends Component<PropsWithChildren<FailureNavigation>, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <AnnouncementLoadFailure detailId={this.props.detailId} onBack={this.props.onBack} /> : this.props.children;
  }
}

export function AnnouncementsButton({ userId }: { userId: string }) {
  const navigation = useAnnouncementsNavigation(userId);
  const unread = useAnnouncementUnread(userId, navigation.isOpen);
  return <>
    <button className="home-icon-button announcement-bell" type="button" aria-label="お知らせを開く" title="お知らせ" aria-describedby={unread.status === 'unread' ? 'announcement-bell-unread' : undefined} onClick={(event) => {
      // Touch browsers may not focus a tapped button; retain the non-input opener.
      event.currentTarget.focus({ preventScroll: true });
      navigation.open();
    }}><Bell aria-hidden="true" size={22} />{unread.status === 'unread' && <span className="announcement-bell-dot" role="img" aria-label="未読のお知らせあり" id="announcement-bell-unread" />}</button>
    {navigation.isOpen && <AnnouncementLoadBoundary key={userId} detailId={navigation.detailId} onBack={navigation.back}>
      <Suspense fallback={null}><AnnouncementsPage key={userId} userId={userId} detailId={navigation.detailId} onOpenDetail={navigation.open} onBack={navigation.back} loadPage={unread.loadPage} onReadAcknowledged={unread.acknowledge} /></Suspense>
    </AnnouncementLoadBoundary>}
  </>;
}
